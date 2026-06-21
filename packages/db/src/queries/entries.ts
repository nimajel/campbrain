import { sql } from "drizzle-orm";
import type { AvailabilityWindowEntry, CampgroundWindow } from "@campbrain/core";
import { rows, type QueryDb } from "./exec";
import { sqlTextArray } from "./filters";

export type EntryRow = {
  park_page_id: string;
  park_name: string;
  window_start: string;
  window_end: string;
  scanned_at: string;
  source_url: string;
  cg_name: string | null;
  cg_id: string | null;
  nightly_fee: string | null;
  booking_url: string | null;
  site_id: number | null;
  site_name: string | null;
  avail_date: string | null;
  status: string | null;
};

/** Pure: assemble nested AvailabilityWindowEntry[] from flat join rows.
 *  Ported verbatim from src/cache/availability-cache.ts:271-321. */
export function buildEntriesFromRows(rowsIn: EntryRow[]): AvailabilityWindowEntry[] {
  const windowMap = new Map<string, AvailabilityWindowEntry>();
  const cgMap = new Map<string, CampgroundWindow>();
  const siteMap = new Map<string, { name: string; dates: Record<string, "available" | "unavailable" | "unknown"> }>();

  for (const row of rowsIn) {
    const windowKey = `${row.park_page_id}::${row.window_start}`;
    if (!windowMap.has(windowKey)) {
      windowMap.set(windowKey, {
        parkPageId: row.park_page_id,
        parkName: row.park_name,
        windowStart: row.window_start,
        windowEnd: row.window_end,
        scannedAt: row.scanned_at,
        sourceUrl: row.source_url,
        campgrounds: [],
      });
    }
    if (row.cg_name === null) continue;

    const cgKey = `${windowKey}::${row.cg_name}`;
    if (!cgMap.has(cgKey)) {
      const cg: CampgroundWindow = { id: row.cg_id ?? row.cg_name, name: row.cg_name, sites: [] };
      if (row.nightly_fee !== null) cg.nightlyFee = Number(row.nightly_fee);
      if (row.booking_url !== null) cg.bookingUrl = row.booking_url;
      cgMap.set(cgKey, cg);
      windowMap.get(windowKey)!.campgrounds.push(cg);
    }
    if (row.site_name === null) continue;

    const siteKey = `${cgKey}::${row.site_name}`;
    if (!siteMap.has(siteKey)) {
      const site = { name: row.site_name, dates: {} as Record<string, "available" | "unavailable" | "unknown"> };
      siteMap.set(siteKey, site);
      cgMap.get(cgKey)!.sites.push(site);
    }
    if (row.avail_date !== null && row.status !== null) {
      siteMap.get(siteKey)!.dates[row.avail_date] = row.status as "available" | "unavailable" | "unknown";
    }
  }
  return Array.from(windowMap.values());
}

const ENTRY_QUERY_SELECT = sql`
  sw.park_page_id, p.park_name,
  sw.window_start::text AS window_start, sw.window_end::text AS window_end,
  sw.scanned_at::text AS scanned_at, sw.source_url,
  cg.campground_name AS cg_name, cg.campground_id AS cg_id,
  cg.nightly_fee, cg.booking_url,
  s.site_id, s.site_name,
  a.date::text AS avail_date, a.status`;

const ENTRY_QUERY_JOINS = sql`
  JOIN parks p ON p.provider_id = sw.provider_id AND p.park_page_id = sw.park_page_id
  LEFT JOIN campgrounds cg ON cg.provider_id = sw.provider_id AND cg.park_page_id = sw.park_page_id
  LEFT JOIN sites s ON s.provider_id = cg.provider_id AND s.park_page_id = cg.park_page_id AND s.campground_name = cg.campground_name
  LEFT JOIN availability a ON a.site_id = s.site_id AND a.date >= sw.window_start AND a.date <= sw.window_end AND a.status = 'available'`;

/** All non-expired windows for the given parks, with per-site per-date availability.
 *  Ported from src/cache/availability-cache.ts:352-367. */
export async function getEntriesForParks(
  db: QueryDb,
  parkPageIds: string[],
  providerName?: string,
): Promise<AvailabilityWindowEntry[]> {
  if (parkPageIds.length === 0) return [];
  const providerCond = providerName ? sql` AND sw.provider_id = ${providerName}` : sql``;
  const result = await rows<EntryRow>(
    db,
    sql`SELECT ${ENTRY_QUERY_SELECT} FROM scan_windows sw ${ENTRY_QUERY_JOINS}
        WHERE sw.park_page_id = ANY(${sqlTextArray(parkPageIds)})${providerCond} AND sw.window_end >= CURRENT_DATE
        ORDER BY sw.window_start, cg.campground_name, s.site_name, a.date`,
  );
  return buildEntriesFromRows(result);
}

export async function getEntriesForPark(
  db: QueryDb,
  parkPageId: string,
  providerName?: string,
): Promise<AvailabilityWindowEntry[]> {
  return getEntriesForParks(db, [parkPageId], providerName);
}
