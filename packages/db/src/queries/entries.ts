import { sql } from "drizzle-orm";
import type { AvailabilityWindowEntry, CampgroundWindow } from "@campbrain/core";
import { rows, type QueryDb } from "./exec";
import { sqlTextArray } from "./filters";

type ParkMetaRow = {
  provider_id: string;
  park_page_id: string;
  park_name: string;
  scanned_at: string;
  source_url: string;
};

type SiteDatesRow = {
  provider_id: string;
  park_page_id: string;
  cg_name: string;
  cg_id: string | null;
  nightly_fee: string | null;
  booking_url: string | null;
  site_name: string;
  dates: string[];
};

/** One deduped entry per (provider, park): all available dates from today forward,
 *  each shipped exactly once as a per-site date array.
 *
 *  This intentionally does NOT join through scan_windows. The scanner's daily-shifted
 *  8-day lattice accumulates ~180 overlapping windows per park, and the old
 *  window-joined read fanned out to windows × sites rows per park (multi-GB egress
 *  per digest build on Neon). Consumers (buildParkAvailability, buildSiteClassMap)
 *  deduped across windows in memory anyway, so a single synthetic window per park is
 *  behavior-preserving; scan_windows is consulted only for park-level freshness meta. */
export async function getEntriesForParks(
  db: QueryDb,
  parkPageIds: string[],
  providerName?: string,
): Promise<AvailabilityWindowEntry[]> {
  if (parkPageIds.length === 0) return [];
  const swProviderCond = providerName ? sql` AND sw.provider_id = ${providerName}` : sql``;
  const sProviderCond = providerName ? sql` AND s.provider_id = ${providerName}` : sql``;

  const meta = await rows<ParkMetaRow>(
    db,
    sql`SELECT sw.provider_id, sw.park_page_id, p.park_name,
               max(sw.scanned_at)::text AS scanned_at,
               (array_agg(sw.source_url ORDER BY sw.scanned_at DESC))[1] AS source_url
        FROM scan_windows sw
        JOIN parks p ON p.provider_id = sw.provider_id AND p.park_page_id = sw.park_page_id
        WHERE sw.park_page_id = ANY(${sqlTextArray(parkPageIds)})${swProviderCond}
          AND sw.window_end >= CURRENT_DATE
        GROUP BY sw.provider_id, sw.park_page_id, p.park_name`,
  );
  if (meta.length === 0) return [];

  const siteRows = await rows<SiteDatesRow>(
    db,
    sql`SELECT s.provider_id, s.park_page_id,
               cg.campground_name AS cg_name, cg.campground_id AS cg_id,
               cg.nightly_fee, cg.booking_url,
               s.site_name,
               array_agg(a.date::text ORDER BY a.date) AS dates
        FROM availability a
        JOIN sites s ON s.site_id = a.site_id
        JOIN campgrounds cg ON cg.provider_id = s.provider_id AND cg.park_page_id = s.park_page_id AND cg.campground_name = s.campground_name
        WHERE s.park_page_id = ANY(${sqlTextArray(parkPageIds)})${sProviderCond}
          AND a.status = 'available' AND a.date >= CURRENT_DATE
        GROUP BY s.provider_id, s.park_page_id, cg.campground_name, cg.campground_id, cg.nightly_fee, cg.booking_url, s.site_name
        ORDER BY s.provider_id, s.park_page_id, cg.campground_name, s.site_name`,
  );

  const entryByKey = new Map<string, AvailabilityWindowEntry>();
  for (const m of meta) {
    entryByKey.set(`${m.provider_id}::${m.park_page_id}`, {
      parkPageId: m.park_page_id,
      parkName: m.park_name,
      windowStart: "",
      windowEnd: "",
      scannedAt: m.scanned_at,
      sourceUrl: m.source_url,
      campgrounds: [],
    });
  }

  const cgByKey = new Map<string, CampgroundWindow>();
  for (const row of siteRows) {
    const entry = entryByKey.get(`${row.provider_id}::${row.park_page_id}`);
    if (!entry) continue; // availability with no unexpired scan window: park is unscanned

    const cgKey = `${row.provider_id}::${row.park_page_id}::${row.cg_name}`;
    let cg = cgByKey.get(cgKey);
    if (!cg) {
      cg = { id: row.cg_id ?? row.cg_name, name: row.cg_name, sites: [] };
      if (row.nightly_fee !== null) cg.nightlyFee = Number(row.nightly_fee);
      if (row.booking_url !== null) cg.bookingUrl = row.booking_url;
      cgByKey.set(cgKey, cg);
      entry.campgrounds.push(cg);
    }

    const dates: Record<string, "available" | "unavailable" | "unknown"> = {};
    for (const d of row.dates) dates[d] = "available";
    cg.sites.push({ name: row.site_name, dates });

    const first = row.dates[0];
    const last = row.dates[row.dates.length - 1];
    if (first && (entry.windowStart === "" || first < entry.windowStart)) entry.windowStart = first;
    if (last && (entry.windowEnd === "" || last > entry.windowEnd)) entry.windowEnd = last;
  }

  return Array.from(entryByKey.values());
}

export async function getEntriesForPark(
  db: QueryDb,
  parkPageId: string,
  providerName?: string,
): Promise<AvailabilityWindowEntry[]> {
  return getEntriesForParks(db, [parkPageId], providerName);
}
