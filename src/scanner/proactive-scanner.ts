// ---------------------------------------------------------------------------
// Proactive scanner — populates the availability cache with 8-day windows.
//
// Architecture (v2):
//   - One cache entry per (parkPageId × windowStart).
//   - The parks.ca.gov API only returns a grid when arrival_date has ≥1 open site,
//     so we probe each day in the window (up to WINDOW_DAYS attempts) until we
//     get a hit or confirm the entire window is fully booked.
//   - parseAllAvailability extracts every campground/site/date from the page.
//   - The full daily grid is stored; 1N/2N/3N queries are answered at read time.
// ---------------------------------------------------------------------------

import dayjs from 'dayjs';
import { listCatalogParks } from '../catalog/catalog-store.js';
import { buildAvailabilityUrl } from '../providers/california-parks-provider.js';
import { parseAllAvailability, isNoAvailabilityPage } from '../providers/california-parks-parser.js';
import {
  generateWindowStarts,
  windowEnd,
  findStaleWindows,
  upsertEntry,
  evictExpired,
  refreshMaterializedView,
} from '../cache/availability-cache.js';
import { initDb } from '../cache/db.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import type { AvailabilityWindowEntry, CampgroundWindow } from '../cache/types.js';
import { WINDOW_DAYS } from '../cache/types.js';

const FETCH_CONCURRENCY = 5;
const BATCH_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Options + result types
// ---------------------------------------------------------------------------

export interface ProactiveScanOptions {
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

  await initDb();

  // 1. Eligible parks
  const parks = listCatalogParks().filter((p) => {
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
    : await findStaleWindows(allCandidates);
  const staleCount = toScan.length;

  log(`Proactive scan: ${parks.length} parks, ${windowStarts.length} windows (${daysAhead}d ahead)`);
  log(`  ${totalWindows} total — ${staleCount} stale / missing`);

  if (staleCount === 0) {
    await evictExpired();
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
    const catalogCgByName = new Map(park.campgrounds.map((c) => [c.name, c]));

    // The API only returns a grid when the arrival_date itself has ≥1 available site.
    // Probe each day in the window until we get data or exhaust the probe limit.
    // Far-out windows use fewer probes — cancellations 90+ days out are rare.
    const daysUntilWindow = dayjs(windowStart).diff(dayjs(), 'day');
    const maxProbes = daysUntilWindow < 30 ? WINDOW_DAYS : 3;

    let parsed: ReturnType<typeof parseAllAvailability> = [];
    let successUrl = '';

    for (let offset = 0; offset < maxProbes; offset++) {
      const arrivalDate = dayjs(windowStart).add(offset, 'day').format('YYYY-MM-DD');
      const url = buildAvailabilityUrl(parkPageId, { arrivalDate, nights: 1, endDate: wEnd });
      fetchCount++;

      let html: string;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
      } catch (err) {
        fetchErrors++;
        log(`  ✗ ${park.parkName} ${windowStart}+${offset} — ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      parsed = parseAllAvailability(html);
      if (parsed.length > 0) {
        successUrl = url;
        break;
      }

      if (!isNoAvailabilityPage(html)) {
        // Unexpected response (landing page / error) — stop probing this window
        log(`  ⚠ ${park.parkName} ${windowStart}+${offset} — unexpected empty parse, skipping`);
        return;
      }
      // isNoAvailabilityPage: this day is fully booked, try next
    }

    if (parsed.length === 0) {
      // All days in the window confirmed fully booked
      await upsertEntry({
        parkPageId,
        parkName: park.parkName,
        windowStart,
        windowEnd: wEnd,
        scannedAt: new Date().toISOString(),
        sourceUrl: buildAvailabilityUrl(parkPageId, { arrivalDate: windowStart, nights: 1, endDate: wEnd }),
        campgrounds: [],
      });
      cacheWrites++;
      return;
    }

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
      sourceUrl: successUrl,
      campgrounds,
    };

    await upsertEntry(entry);
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

  const evicted = await evictExpired();
  if (evicted > 0) log(`  Evicted ${evicted} expired cache entries`);

  try {
    await refreshMaterializedView();
    log('  MV refreshed: mv_available_stays');
  } catch (err) {
    log(`  MV refresh failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  return { totalWindows, staleCount, fetchCount, fetchErrors, cacheWrites, durationMs: Date.now() - startMs };
}
