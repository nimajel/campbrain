import { sql } from "drizzle-orm";
import {
  expandStayWindows,
  classifyRegion,
  type CampRegion,
} from "@campbrain/core";
import type { SavedSearch } from "@campbrain/types";
import { rows, type QueryDb } from "./exec";
import { sqlTextArray } from "./filters";
import { searchAvailableStays } from "./search";
import { getCatalogParks } from "./catalog";

export interface SavedSearchOpening {
  savedSearchId: string;
  parkPageId: string;
  parkName: string;
  campgroundName: string;
  siteName: string;
  arrivalDate: string;
  departureDate: string;
  nights: number;
  bookingUrl: string | null;
  availabilityAsOf?: string;
}

/** Maps parkPageId → CampRegion (or null when coordinates are absent). */
export type ParkRegionOf = (parkPageId: string) => CampRegion | null;

/** Build a ParkRegionOf lookup from the catalog. Call once per scan run. */
export async function buildParkRegionOf(db: QueryDb): Promise<ParkRegionOf> {
  const parks = await getCatalogParks(db);
  const map = new Map<string, CampRegion>();
  for (const p of parks) {
    if (p.latitude != null && p.longitude != null) {
      map.set(p.parkPageId, classifyRegion(p.latitude, p.longitude));
    }
  }
  return (id) => map.get(id) ?? null;
}

function parkPassesScope(
  parkPageId: string,
  scope: SavedSearch["scope"],
  regionOf: ParkRegionOf,
): boolean {
  if (scope.parkPageIds.length > 0) return scope.parkPageIds.includes(parkPageId);
  if (scope.region === null) return true;
  return regionOf(parkPageId) === scope.region;
}

/**
 * Lightweight freshness lookup: oldest scanned_at from scan_windows overlapping [from, to).
 * Returns a map of parkPageId → oldest scanned_at ISO string.
 * Uses only the scan_windows table (no availability join) — fast even for hundreds of parks.
 */
async function getOldestScanAt(
  db: QueryDb,
  parkPageIds: string[],
  from: string,
  to: string,
): Promise<Map<string, string>> {
  if (parkPageIds.length === 0) return new Map();
  type Row = { park_page_id: string; oldest_scan_at: string };
  const result = await rows<Row>(
    db,
    sql`SELECT park_page_id, MIN(scanned_at)::text AS oldest_scan_at
        FROM scan_windows
        WHERE park_page_id = ANY(${sqlTextArray(parkPageIds)})
          AND window_start < ${to}::date
          AND window_end >= ${from}::date
          AND window_end >= CURRENT_DATE
        GROUP BY park_page_id`,
  );
  return new Map(result.map((r) => [r.park_page_id, r.oldest_scan_at]));
}

/**
 * Match a saved search against live DB availability, returning concrete openings.
 *
 * Walk-up sites are intentionally excluded — alerts are for bookable/reservable sites only.
 * `regionOf` should come from `buildParkRegionOf` (built once per scan run, not per search).
 *
 * `availabilityAsOf` is populated from `scan_windows` (lightweight freshness query — no full
 * availability join) for only the parks that produced openings.
 */
export async function matchSavedSearchAgainstDb(
  db: QueryDb,
  search: SavedSearch,
  today: string,
  regionOf: ParkRegionOf,
): Promise<SavedSearchOpening[]> {
  const windows = expandStayWindows(search, today);
  if (windows.length === 0) return [];
  const { filters, scope } = search;

  // Phase 1: collect openings without availabilityAsOf — one searchAvailableStays per window.
  type PendingOpening = Omit<SavedSearchOpening, "availabilityAsOf"> & {
    windowFrom: string;
    windowTo: string;
  };
  const pending: PendingOpening[] = [];

  for (const window of windows) {
    const searchParams: Parameters<typeof searchAvailableStays>[1] = {
      from: window.from,
      to: window.to,
    };
    if (filters.access.length > 0) searchParams.access = filters.access;
    if (filters.kinds.length > 0) searchParams.kinds = filters.kinds;
    if (filters.hide.length > 0) searchParams.hide = filters.hide;

    const parks = await searchAvailableStays(db, searchParams);

    for (const park of parks) {
      if (!parkPassesScope(park.parkPageId, scope, regionOf)) continue;

      for (const cg of park.campgrounds) {
        // Walk-up sites live in cg.walkUpSites — intentionally not iterated here
        for (const siteName of cg.availableSites) {
          pending.push({
            savedSearchId: search.id,
            parkPageId: park.parkPageId,
            parkName: park.parkName,
            campgroundName: cg.name,
            siteName,
            arrivalDate: window.from,
            departureDate: window.to,
            nights: window.nights,
            bookingUrl: cg.bookingUrl ?? null,
            windowFrom: window.from,
            windowTo: window.to,
          });
        }
      }
    }
  }

  if (pending.length === 0) return [];

  // Phase 2: batch-fetch scan freshness (lightweight — scan_windows only, no availability join)
  // for the parks that produced openings. Groups by window so a multi-window search makes at
  // most one query per distinct (from, to) pair.
  const windowKeys = [...new Set(pending.map((p) => `${p.windowFrom}::${p.windowTo}`))];
  const freshnessCache = new Map<string, Map<string, string>>();
  for (const key of windowKeys) {
    const [wFrom, wTo] = key.split("::") as [string, string];
    const parkIds = [...new Set(pending.filter((p) => p.windowFrom === wFrom && p.windowTo === wTo).map((p) => p.parkPageId))];
    freshnessCache.set(key, await getOldestScanAt(db, parkIds, wFrom, wTo));
  }

  // Phase 3: annotate each opening with availabilityAsOf and return.
  // windowFrom/windowTo are carried on each pending opening; no stayDates needed.
  return pending.map(({ windowFrom, windowTo, ...opening }) => {
    const key = `${windowFrom}::${windowTo}`;
    const asOf = freshnessCache.get(key)?.get(opening.parkPageId);
    return asOf !== undefined ? { ...opening, availabilityAsOf: asOf } : opening;
  });
}
