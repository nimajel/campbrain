// ---------------------------------------------------------------------------
// Proactive scanner — populates the availability cache with 14-day windows.
//
// Architecture (v2):
//   - One fetch per (parkPageId × windowStart): `length=14` returns 14 days
//     of per-site per-day availability in a single HTML response.
//   - parseAllAvailability extracts every campground/site/date from the page.
//   - The full daily grid is stored; 1N/2N/3N queries are answered at read time.
//   - 64 parks × 13 windows = ~832 fetches per full 180-day scan cycle
//     (vs 23,040 with the old per-date-per-nights approach).
// ---------------------------------------------------------------------------

import dayjs from 'dayjs';
import { listCatalogParks } from '../catalog/catalog-store.js';
import { buildAvailabilityUrl } from '../providers/california-parks-provider.js';
import { parseAllAvailability } from '../providers/california-parks-parser.js';
import {
  generateWindowStarts,
  windowEnd,
  findStaleWindows,
  upsertEntry,
  evictExpired,
} from '../cache/availability-cache.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import type { AvailabilityWindowEntry, CampgroundWindow } from '../cache/types.js';
import { WINDOW_DAYS } from '../cache/types.js';

const FETCH_CONCURRENCY = 5;
const BATCH_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Options + result types
// ---------------------------------------------------------------------------

export interface ProactiveScanOptions {
  dataDir?: string;
  /** Days ahead to cover. Default: 180 (full CA Parks booking window). */
  daysAhead?: number;
  /** Scan all parks with site data, not just pageIdVerified ones. Default: false. */
  verifiedOnly?: boolean;
  /** Force re-scan even when cache is still fresh. Default: false. */
  force?: boolean;
  todayOverride?: string;
  logger?: (msg: string) => void;
}

export interface ProactiveScanSummary {
  totalWindows: number;
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
  const verifiedOnly = opts.verifiedOnly ?? false;

  // 1. Eligible parks
  const parks = listCatalogParks(opts.dataDir).filter((p) => {
    if (p.provider !== 'california-parks') return false;
    if (verifiedOnly && !p.pageIdVerified) return false;
    return p.campgrounds.some((c) => c.sites.length > 0);
  });

  if (parks.length === 0) {
    log('No eligible parks found (run catalog refresh first).');
    return { totalWindows: 0, staleCount: 0, fetchCount: 0, fetchErrors: 0, cacheWrites: 0, durationMs: Date.now() - startMs };
  }

  // 2. Generate (park, windowStart) candidates
  const windowStarts = generateWindowStarts(daysAhead, opts.todayOverride);
  const allCandidates = parks.flatMap((p) =>
    windowStarts.map((ws) => ({ parkPageId: p.parkPageId, windowStart: ws }))
  );
  const totalWindows = allCandidates.length;

  // 3. Filter to stale/missing
  const toScan = opts.force
    ? allCandidates
    : findStaleWindows(allCandidates, opts.dataDir);
  const staleCount = toScan.length;

  log(`Proactive scan: ${parks.length} parks, ${windowStarts.length} windows (${daysAhead}d ahead)`);
  log(`  ${totalWindows} total — ${staleCount} stale / missing`);

  if (staleCount === 0) {
    evictExpired(opts.dataDir);
    return { totalWindows, staleCount: 0, fetchCount: 0, fetchErrors: 0, cacheWrites: 0, durationMs: Date.now() - startMs };
  }

  const parkByPageId = new Map(parks.map((p) => [p.parkPageId, p]));
  let fetchCount = 0;
  let fetchErrors = 0;
  let cacheWrites = 0;

  const fetchTasks = toScan.map(({ parkPageId, windowStart }) => async () => {
    const park = parkByPageId.get(parkPageId);
    if (!park) return;

    const wEnd = windowEnd(windowStart);
    const sourceUrl = buildAvailabilityUrl(parkPageId, {
      arrivalDate: windowStart,
      nights: WINDOW_DAYS,
      endDate: wEnd,
    });

    fetchCount++;

    let html: string;
    try {
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (err) {
      fetchErrors++;
      log(`  ✗ ${park.parkName} ${windowStart} — ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Parse the full page — all campgrounds, all sites, all date columns
    const parsed = parseAllAvailability(html);

    // Map catalog entries by name to pick up nightlyFee and bookingUrl
    const catalogCgByName = new Map(park.campgrounds.map((c) => [c.name, c]));

    const campgrounds: CampgroundWindow[] = parsed.map((pc) => {
      const catalogCg = catalogCgByName.get(pc.name);
      const result: CampgroundWindow = {
        id: catalogCg?.id ?? pc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: pc.name,
        sites: pc.sites,
      };
      const bookingUrl = pc.bookingUrl || catalogCg?.bookingUrl;
      if (bookingUrl) result.bookingUrl = bookingUrl;
      if (catalogCg?.nightlyFee !== undefined) result.nightlyFee = catalogCg.nightlyFee;
      return result;
    });

    const entry: AvailabilityWindowEntry = {
      parkPageId,
      parkName: park.parkName,
      windowStart,
      windowEnd: wEnd,
      scannedAt: new Date().toISOString(),
      sourceUrl,
      campgrounds,
    };

    upsertEntry(entry, opts.dataDir);
    cacheWrites++;

    const windowsWithAvail = campgrounds.filter((c) =>
      c.sites.some((s) => Object.values(s.dates).includes('available'))
    ).length;
    if (windowsWithAvail > 0) {
      log(`  ✓ ${park.parkName} ${windowStart} — ${windowsWithAvail} campground(s) with some availability`);
    }
  });

  // Run with concurrency + politeness delay between batches
  for (let i = 0; i < fetchTasks.length; i += FETCH_CONCURRENCY * 2) {
    const batch = fetchTasks.slice(i, i + FETCH_CONCURRENCY * 2);
    await runWithConcurrency(batch, FETCH_CONCURRENCY);
    if (i + batch.length < fetchTasks.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const evicted = evictExpired(opts.dataDir);
  if (evicted > 0) log(`  Evicted ${evicted} expired cache entries`);

  return { totalWindows, staleCount, fetchCount, fetchErrors, cacheWrites, durationMs: Date.now() - startMs };
}
