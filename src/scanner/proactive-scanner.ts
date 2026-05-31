// ---------------------------------------------------------------------------
// Proactive scanner — runs on a schedule, populates the availability cache
// for all upcoming weekends across all catalog parks.
//
// Design:
//   - One HTTP fetch per unique (parkPageId × arrivalDate × nights)
//   - Parses ALL campgrounds from that one HTML response (no duplicate fetches)
//   - Skips entries that are still within TTL
//   - Writes to .campbrain/state/availability-cache.json
// ---------------------------------------------------------------------------

import dayjs from 'dayjs';
import { listCatalogParks } from '../catalog/catalog-store.js';
import { buildAvailabilityUrl } from '../providers/california-parks-provider.js';
import {
  parseAvailabilityHtml,
  evaluateCandidate,
} from '../providers/california-parks-parser.js';
import {
  findStaleKeys,
  upsertEntry,
  evictExpired,
} from '../cache/availability-cache.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import type { AvailabilityCacheEntry, CachedCampground } from '../cache/types.js';
import type { Target } from '../config/schemas.js';

const FETCH_CONCURRENCY = 5;
// Politeness delay between fetch batches (ms). Keeps us well below abusive rates.
const BATCH_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Date generation
// ---------------------------------------------------------------------------

/** Returns every date from tomorrow through daysAhead days out. */
export function upcomingArrivalDates(daysAhead = 180, today?: string): string[] {
  const base = today ? dayjs(today) : dayjs();
  const dates: string[] = [];
  for (let i = 1; i <= daysAhead; i++) {
    dates.push(base.add(i, 'day').format('YYYY-MM-DD'));
  }
  return dates;
}

/** Convenience: returns only Fri/Sat dates within a range. */
export function upcomingWeekendArrivalDates(weekCount = 12, today?: string): string[] {
  const base = today ? dayjs(today) : dayjs();
  const dates: string[] = [];
  let cursor = base.add(1, 'day');
  let weeksFound = 0;
  while (weeksFound < weekCount) {
    const dow = cursor.day();
    if (dow === 5) {
      dates.push(cursor.format('YYYY-MM-DD'));
      dates.push(cursor.add(1, 'day').format('YYYY-MM-DD'));
      weeksFound++;
      cursor = cursor.add(7, 'day');
    } else {
      cursor = cursor.add(1, 'day');
    }
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Scan options + result types
// ---------------------------------------------------------------------------

export interface ProactiveScanOptions {
  /** Data directory for catalog + cache. Defaults to process.cwd(). */
  dataDir?: string;
  /**
   * How many days ahead to scan. Default: 180 (6 months — full CA Parks booking window).
   * Every calendar day in this range is scanned, not just weekends.
   */
  daysAhead?: number;
  /** Which night counts to scan per arrival date. Default: [1, 2]. */
  nightsOptions?: number[];
  /** Only scan parks with pageIdVerified: true. Default: true. */
  verifiedOnly?: boolean;
  /** Force re-scan even if cache is still fresh. Default: false. */
  force?: boolean;
  /** For testing — override "today". */
  todayOverride?: string;
  logger?: (msg: string) => void;
}

export interface ProactiveScanSummary {
  totalCandidates: number;
  staleCount: number;
  fetchCount: number;
  fetchErrors: number;
  cacheWrites: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

export async function runProactiveScan(
  opts: ProactiveScanOptions = {}
): Promise<ProactiveScanSummary> {
  const startMs = Date.now();
  const log = opts.logger ?? (() => {});
  const daysAhead = opts.daysAhead ?? 180;
  const nightsOptions = opts.nightsOptions ?? [1, 2];
  const verifiedOnly = opts.verifiedOnly ?? true;

  // 1. Determine which parks to scan
  const allParks = listCatalogParks(opts.dataDir);
  const parks = allParks.filter((p) => {
    if (p.provider !== 'california-parks') return false; // only CA parks for now
    if (verifiedOnly && !p.pageIdVerified) return false;
    return p.campgrounds.some((c) => c.sites.length > 0);
  });

  if (parks.length === 0) {
    log('No eligible parks found (run catalog refresh first).');
    return { totalCandidates: 0, staleCount: 0, fetchCount: 0, fetchErrors: 0, cacheWrites: 0, durationMs: Date.now() - startMs };
  }

  // 2. Generate all (parkPageId, arrivalDate, nights) candidates
  const arrivalDates = upcomingArrivalDates(daysAhead, opts.todayOverride);
  const allCandidates = parks.flatMap((p) =>
    arrivalDates.flatMap((date) =>
      nightsOptions.map((nights) => ({
        parkPageId: p.parkPageId,
        arrivalDate: date,
        nights,
      }))
    )
  );
  const totalCandidates = allCandidates.length;

  // 3. Filter to only stale entries (unless force)
  const toScan = opts.force
    ? allCandidates
    : findStaleKeys(allCandidates, opts.dataDir);

  const staleCount = toScan.length;
  log(`Proactive scan: ${parks.length} parks, ${arrivalDates.length} dates (${daysAhead}d ahead), ${nightsOptions.length} night options`);
  log(`  ${totalCandidates} total candidates — ${staleCount} stale / missing`);

  if (staleCount === 0) {
    evictExpired(opts.dataDir);
    return { totalCandidates, staleCount: 0, fetchCount: 0, fetchErrors: 0, cacheWrites: 0, durationMs: Date.now() - startMs };
  }

  // 4. Deduplicate — group by (parkPageId, arrivalDate, nights) since one HTML
  //    response covers all campgrounds for that park+date+nights combo.
  //    The candidates are already unique at this level, so just build fetch tasks.
  const parkByPageId = new Map(parks.map((p) => [p.parkPageId, p]));

  let fetchCount = 0;
  let fetchErrors = 0;
  let cacheWrites = 0;

  // Build one task per stale candidate
  const fetchTasks = toScan.map(({ parkPageId, arrivalDate, nights }) => async () => {
    const park = parkByPageId.get(parkPageId);
    if (!park) return;

    const endDate = dayjs(arrivalDate).add(nights, 'day').format('YYYY-MM-DD');
    const candidate = { arrivalDate, nights, endDate };
    const sourceUrl = buildAvailabilityUrl(parkPageId, candidate);

    fetchCount++;

    let html: string;
    try {
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (err) {
      fetchErrors++;
      log(`  ✗ ${park.parkName} ${arrivalDate} ${nights}N — ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Parse each campground from this single HTML response
    const campgrounds: CachedCampground[] = [];

    for (const campground of park.campgrounds.filter((c) => c.sites.length > 0)) {
      const target: Target = {
        id: `proactive-${parkPageId}-${campground.id}`,
        name: `${park.parkName} – ${campground.name}`,
        provider: 'california-parks',
        parkName: park.parkName,
        parkPageId,
        campgroundName: campground.name,
        acceptableSites: campground.sites.map((s) => s.name),
        preferredSites: [],
        campingType: 'drive-to',
        people: 2,
        dateMode: 'exact_dates',
        exactStartDate: arrivalDate,
        exactEndDate: endDate,
        minNights: nights,
        maxNights: nights,
        weekendsOnly: false,
        bookingRule: campground.bookingRule ?? park.defaultBookingRule,
      };

      const parsed = parseAvailabilityHtml(html, target);
      const availableSites = parsed
        ? evaluateCandidate(candidate, parsed, target.acceptableSites).hits.map((h) => h.siteName)
        : [];

      campgrounds.push({
        id: campground.id,
        name: campground.name,
        availableSites,
        ...(campground.nightlyFee !== undefined ? { nightlyFee: campground.nightlyFee } : {}),
        ...(campground.bookingUrl ? { bookingUrl: campground.bookingUrl } : {}),
      });
    }

    const entry: AvailabilityCacheEntry = {
      parkPageId,
      parkName: park.parkName,
      arrivalDate,
      nights,
      departureDate: endDate,
      scannedAt: new Date().toISOString(),
      sourceUrl,
      campgrounds,
    };

    upsertEntry(entry, opts.dataDir);
    cacheWrites++;

    const available = campgrounds.filter((c) => c.availableSites.length > 0);
    if (available.length > 0) {
      log(`  ✓ ${park.parkName} ${arrivalDate} ${nights}N — ${available.length} campground(s) with availability`);
    }
  });

  // 5. Run with concurrency limit + a short delay between batches for politeness
  for (let i = 0; i < fetchTasks.length; i += FETCH_CONCURRENCY * 2) {
    const batch = fetchTasks.slice(i, i + FETCH_CONCURRENCY * 2);
    await runWithConcurrency(batch, FETCH_CONCURRENCY);
    if (i + batch.length < fetchTasks.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // 6. Evict past dates
  const evicted = evictExpired(opts.dataDir);
  if (evicted > 0) log(`  Evicted ${evicted} expired cache entries`);

  return {
    totalCandidates,
    staleCount,
    fetchCount,
    fetchErrors,
    cacheWrites,
    durationMs: Date.now() - startMs,
  };
}
