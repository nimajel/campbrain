import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import type { AvailabilityCache, AvailabilityWindowEntry } from './types.js';
import { cacheKey, WINDOW_DAYS } from './types.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function cachePath(dataDir?: string): string {
  const base = dataDir ?? path.join(process.cwd(), '.campbrain', 'state');
  return path.join(base, 'availability-cache.json');
}

// ---------------------------------------------------------------------------
// TTL — keyed on windowStart (most time-sensitive date in the window)
// ---------------------------------------------------------------------------

const TTL_MINUTES = {
  veryFar: 480,  // > 90 days — barely changes, 8h
  far: 240,      // 30–90 days — 4h
  near: 120,     // 7–30 days — 2h
  imminent: 30,  // < 7 days — 30min
} as const;

export function ttlMinutes(windowStart: string, nowMs = Date.now()): number {
  const daysUntil = dayjs(windowStart).diff(dayjs(nowMs), 'day');
  if (daysUntil < 7) return TTL_MINUTES.imminent;
  if (daysUntil < 30) return TTL_MINUTES.near;
  if (daysUntil < 90) return TTL_MINUTES.far;
  return TTL_MINUTES.veryFar;
}

export function isEntryStale(entry: AvailabilityWindowEntry, nowMs = Date.now()): boolean {
  const ttl = ttlMinutes(entry.windowStart, nowMs) * 60 * 1000;
  return nowMs - new Date(entry.scannedAt).getTime() > ttl;
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export function readCache(dataDir?: string): AvailabilityCache {
  const p = cachePath(dataDir);
  if (!fs.existsSync(p)) return { version: 2, entries: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { version?: number };
    // Discard v1 cache — incompatible format
    if (raw.version !== 2) return { version: 2, entries: {} };
    return raw as AvailabilityCache;
  } catch {
    return { version: 2, entries: {} };
  }
}

export function writeCache(cache: AvailabilityCache, dataDir?: string): void {
  const p = cachePath(dataDir);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cache, null, 2), 'utf-8');
}

export function upsertEntry(entry: AvailabilityWindowEntry, dataDir?: string): void {
  const cache = readCache(dataDir);
  cache.entries[cacheKey(entry.parkPageId, entry.windowStart)] = entry;
  writeCache(cache, dataDir);
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

/** Generate non-overlapping 14-day window start dates covering daysAhead days. */
export function generateWindowStarts(daysAhead: number, today?: string): string[] {
  const base = today ? dayjs(today) : dayjs();
  const windows: string[] = [];
  let offset = 1; // start tomorrow
  while (offset <= daysAhead) {
    windows.push(base.add(offset, 'day').format('YYYY-MM-DD'));
    offset += WINDOW_DAYS;
  }
  return windows;
}

export function windowEnd(windowStart: string): string {
  return dayjs(windowStart).add(WINDOW_DAYS - 1, 'day').format('YYYY-MM-DD');
}

// ---------------------------------------------------------------------------
// Stale window detection
// ---------------------------------------------------------------------------

export function findStaleWindows(
  candidates: Array<{ parkPageId: string; windowStart: string }>,
  dataDir?: string,
  nowMs = Date.now()
): Array<{ parkPageId: string; windowStart: string }> {
  const cache = readCache(dataDir);
  return candidates.filter(({ parkPageId, windowStart }) => {
    const entry = cache.entries[cacheKey(parkPageId, windowStart)];
    return !entry || isEntryStale(entry, nowMs);
  });
}

// ---------------------------------------------------------------------------
// Query: available sites for a stay spanning one or more windows
// ---------------------------------------------------------------------------

export interface CampgroundStayResult {
  campgroundId: string;
  campgroundName: string;
  nightlyFee?: number;
  bookingUrl?: string;
  availableSites: string[];
}

/**
 * Given all window entries for a single park, returns campgrounds whose sites
 * are fully available for the requested stay (arrivalDate + nights).
 *
 * Handles stays that cross window boundaries by merging date data from
 * multiple windows.
 */
export function getAvailableSitesForStay(
  windows: AvailabilityWindowEntry[],
  arrivalDate: string,
  nights: number
): CampgroundStayResult[] {
  // Required dates: arrivalDate through arrivalDate+nights-1 (NOT checkout day)
  const requiredDates: string[] = [];
  let cur = dayjs(arrivalDate);
  for (let i = 0; i < nights; i++) {
    requiredDates.push(cur.format('YYYY-MM-DD'));
    cur = cur.add(1, 'day');
  }

  // Find windows that cover at least one required date
  const coveringWindows = windows.filter((w) =>
    requiredDates.some((d) => d >= w.windowStart && d <= w.windowEnd)
  );
  if (coveringWindows.length === 0) return [];

  // Merge campground data across covering windows.
  // Key: campgroundName → merged site date map
  type MergedCg = {
    id: string;
    name: string;
    nightlyFee: number | undefined;
    bookingUrl: string | undefined;
    sites: Map<string, Record<string, string>>; // siteName → date → status
  };
  const cgMap = new Map<string, MergedCg>();

  for (const w of coveringWindows) {
    for (const cg of w.campgrounds) {
      if (!cgMap.has(cg.name)) {
        cgMap.set(cg.name, {
          id: cg.id,
          name: cg.name,
          nightlyFee: cg.nightlyFee,
          bookingUrl: cg.bookingUrl,
          sites: new Map(),
        });
      }
      const merged = cgMap.get(cg.name)!;
      for (const site of cg.sites) {
        const existing = merged.sites.get(site.name) ?? {};
        // Merge dates from this window into the accumulated map
        Object.assign(existing, site.dates);
        merged.sites.set(site.name, existing);
      }
    }
  }

  // Evaluate: a site is available for the stay only if ALL required dates are 'available'
  const results: CampgroundStayResult[] = [];
  for (const cg of cgMap.values()) {
    const availableSites: string[] = [];
    for (const [siteName, dateLookup] of cg.sites) {
      if (requiredDates.every((d) => dateLookup[d] === 'available')) {
        availableSites.push(siteName);
      }
    }
    const result: CampgroundStayResult = {
      campgroundId: cg.id,
      campgroundName: cg.name,
      availableSites,
    };
    if (cg.nightlyFee !== undefined) result.nightlyFee = cg.nightlyFee;
    if (cg.bookingUrl !== undefined) result.bookingUrl = cg.bookingUrl;
    results.push(result);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Bulk readers
// ---------------------------------------------------------------------------

export function listFreshEntries(dataDir?: string, nowMs = Date.now()): AvailabilityWindowEntry[] {
  const cache = readCache(dataDir);
  return Object.values(cache.entries).filter((e) => !isEntryStale(e, nowMs));
}

/** Evict windows whose windowEnd is in the past. */
export function evictExpired(dataDir?: string, nowMs = Date.now()): number {
  const cache = readCache(dataDir);
  const today = dayjs(nowMs).format('YYYY-MM-DD');
  let evicted = 0;
  for (const key of Object.keys(cache.entries)) {
    if (cache.entries[key]!.windowEnd < today) {
      delete cache.entries[key];
      evicted++;
    }
  }
  if (evicted > 0) writeCache(cache, dataDir);
  return evicted;
}
