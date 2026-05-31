import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import type { AvailabilityCache, AvailabilityCacheEntry } from './types.js';
import { cacheKey } from './types.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function cachePath(dataDir?: string): string {
  const base = dataDir ?? path.join(process.cwd(), '.campbrain', 'state');
  return path.join(base, 'availability-cache.json');
}

// ---------------------------------------------------------------------------
// TTL — entries closer to arrival date get shorter TTL for fresher data
// ---------------------------------------------------------------------------

const TTL_MINUTES = {
  veryFar: 480,  // > 90 days — barely changes, 8h
  far: 240,      // 30–90 days — 4h
  near: 120,     // 7–30 days — 2h
  imminent: 30,  // < 7 days — sites open/close fast, 30min
} as const;

export function ttlMinutes(arrivalDate: string, nowMs = Date.now()): number {
  const daysUntil = dayjs(arrivalDate).diff(dayjs(nowMs), 'day');
  if (daysUntil < 7) return TTL_MINUTES.imminent;
  if (daysUntil < 30) return TTL_MINUTES.near;
  if (daysUntil < 90) return TTL_MINUTES.far;
  return TTL_MINUTES.veryFar;
}

export function isEntryStale(entry: AvailabilityCacheEntry, nowMs = Date.now()): boolean {
  const ttl = ttlMinutes(entry.arrivalDate, nowMs) * 60 * 1000;
  const age = nowMs - new Date(entry.scannedAt).getTime();
  return age > ttl;
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export function readCache(dataDir?: string): AvailabilityCache {
  const p = cachePath(dataDir);
  if (!fs.existsSync(p)) return { version: 1, entries: {} };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as AvailabilityCache;
  } catch {
    return { version: 1, entries: {} };
  }
}

export function writeCache(cache: AvailabilityCache, dataDir?: string): void {
  const p = cachePath(dataDir);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cache, null, 2), 'utf-8');
}

export function upsertEntry(
  entry: AvailabilityCacheEntry,
  dataDir?: string
): void {
  const cache = readCache(dataDir);
  const key = cacheKey(entry.parkPageId, entry.arrivalDate, entry.nights);
  cache.entries[key] = entry;
  writeCache(cache, dataDir);
}

// ---------------------------------------------------------------------------
// Query helpers used by scanner and UI
// ---------------------------------------------------------------------------

export function getEntry(
  parkPageId: string,
  arrivalDate: string,
  nights: number,
  dataDir?: string
): AvailabilityCacheEntry | undefined {
  const cache = readCache(dataDir);
  return cache.entries[cacheKey(parkPageId, arrivalDate, nights)];
}

export function listFreshEntries(dataDir?: string, nowMs = Date.now()): AvailabilityCacheEntry[] {
  const cache = readCache(dataDir);
  return Object.values(cache.entries).filter((e) => !isEntryStale(e, nowMs));
}

/** Returns (parkPageId, arrivalDate, nights) combos that are missing or stale. */
export function findStaleKeys(
  candidates: Array<{ parkPageId: string; arrivalDate: string; nights: number }>,
  dataDir?: string,
  nowMs = Date.now()
): Array<{ parkPageId: string; arrivalDate: string; nights: number }> {
  const cache = readCache(dataDir);
  return candidates.filter(({ parkPageId, arrivalDate, nights }) => {
    const key = cacheKey(parkPageId, arrivalDate, nights);
    const entry = cache.entries[key];
    return !entry || isEntryStale(entry, nowMs);
  });
}

/** Evict entries for dates that have already passed. */
export function evictExpired(dataDir?: string, nowMs = Date.now()): number {
  const cache = readCache(dataDir);
  const today = dayjs(nowMs).format('YYYY-MM-DD');
  let evicted = 0;
  for (const key of Object.keys(cache.entries)) {
    const entry = cache.entries[key]!;
    if (entry.arrivalDate < today) {
      delete cache.entries[key];
      evicted++;
    }
  }
  if (evicted > 0) writeCache(cache, dataDir);
  return evicted;
}
