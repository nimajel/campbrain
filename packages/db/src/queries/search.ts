import { sql, type SQL } from "drizzle-orm";
import dayjs from "dayjs";
import type { SiteAccess, SiteKind, HideTarget } from "./filters";
import { pgEnumArray, sqlTextArray } from "./filters";
import { rows, type QueryDb } from "./exec";

export type SearchCampground = {
  name: string;
  nightlyFee: number | null;
  bookingUrl: string | null;
  availableSites: string[];
  walkUpSites: string[];
};
export type SearchParkResult = {
  parkPageId: string;
  parkName: string;
  campgrounds: SearchCampground[];
};

/** Sites available on EVERY night in [from, to). Ported from availability-cache.ts:820-913. */
export async function searchAvailableStays(
  db: QueryDb,
  params: { from: string; to: string; access?: SiteAccess[]; kinds?: SiteKind[]; hide?: HideTarget[] },
): Promise<SearchParkResult[]> {
  const { from, to, access, kinds, hide = [] } = params;
  const nightCount = dayjs(to).diff(dayjs(from), "day");
  if (nightCount < 1) return [];

  const filters: SQL[] = [sql`s.is_day_use = false`];
  const accessArr = pgEnumArray(access, ["drive_in", "hike_in", "boat_in"]);
  if (accessArr) filters.push(sql`s.access = ANY(${sqlTextArray(accessArr)})`);
  const kindArr = pgEnumArray(kinds, ["tent", "hookup", "cabin"]);
  if (kindArr) filters.push(sql`s.site_kind = ANY(${sqlTextArray(kindArr)})`);
  if (hide.includes("group")) filters.push(sql`NOT s.is_group`);
  if (hide.includes("equestrian")) filters.push(sql`NOT s.is_equestrian`);
  // hide 'walk_up' removes walk-up sites from the result entirely (they won't appear in walkUpSites)
  if (hide.includes("walk_up")) filters.push(sql`NOT s.is_walk_up`);
  const filterWhere = sql.join(filters, sql` AND `);

  type Row = {
    park_page_id: string; park_name: string; campground_name: string;
    nightly_fee: string | null; booking_url: string | null; site_name: string; is_walk_up: boolean;
  };
  const result = await rows<Row>(
    db,
    sql`SELECT p.park_page_id, p.park_name, cg.campground_name, cg.nightly_fee::text, cg.booking_url, s.site_name, s.is_walk_up
        FROM sites s
        JOIN campgrounds cg ON cg.provider_id = s.provider_id AND cg.park_page_id = s.park_page_id AND cg.campground_name = s.campground_name
        JOIN parks p ON p.provider_id = s.provider_id AND p.park_page_id = s.park_page_id
        WHERE s.site_id IN (
          SELECT a.site_id FROM availability a
          WHERE a.date >= ${from}::date AND a.date < ${to}::date AND a.status = 'available'
          GROUP BY a.site_id HAVING COUNT(DISTINCT a.date) = ${nightCount}::int
        ) AND ${filterWhere}
        ORDER BY p.park_name, cg.campground_name, s.site_name`,
  );

  const parkMap = new Map<string, SearchParkResult>();
  for (const row of result) {
    if (!parkMap.has(row.park_page_id)) {
      parkMap.set(row.park_page_id, { parkPageId: row.park_page_id, parkName: row.park_name, campgrounds: [] });
    }
    const park = parkMap.get(row.park_page_id)!;
    let cg = park.campgrounds.find((c) => c.name === row.campground_name);
    if (!cg) {
      cg = { name: row.campground_name, nightlyFee: row.nightly_fee !== null ? Number(row.nightly_fee) : null,
             bookingUrl: row.booking_url, availableSites: [], walkUpSites: [] };
      park.campgrounds.push(cg);
    }
    if (row.is_walk_up) cg.walkUpSites.push(row.site_name);
    else cg.availableSites.push(row.site_name);
  }
  return [...parkMap.values()];
}

export type NextAvailableResult = { parkPageId: string; parkName: string; earliestDate: string };

/** Up to 5 parks' earliest bookable date within `withinDays`. Ported from availability-cache.ts:930-975. */
export async function findNextAvailableDates(
  db: QueryDb,
  params: { withinDays?: number; parkPageIds?: string[] },
): Promise<NextAvailableResult[]> {
  const { withinDays = 60, parkPageIds } = params;
  const endDate = dayjs().add(withinDays, "day").format("YYYY-MM-DD");

  const conds: SQL[] = [
    sql`a.status = 'available'`,
    sql`a.date >= CURRENT_DATE`,
    sql`a.date <= ${endDate}::date`,
    sql`NOT s.is_walk_up`,
    sql`s.is_day_use = false`,
  ];
  if (parkPageIds && parkPageIds.length > 0) conds.push(sql`s.park_page_id = ANY(${sqlTextArray(parkPageIds)})`);
  const where = sql.join(conds, sql` AND `);

  const result = await rows<{ park_page_id: string; park_name: string; earliest_date: string }>(
    db,
    sql`SELECT s.park_page_id, p.park_name, MIN(a.date)::text AS earliest_date
        FROM availability a
        JOIN sites s ON s.site_id = a.site_id
        JOIN parks p ON p.provider_id = s.provider_id AND p.park_page_id = s.park_page_id
        WHERE ${where}
        GROUP BY s.park_page_id, p.park_name
        ORDER BY earliest_date
        LIMIT 5`,
  );
  return result.map((r) => ({ parkPageId: r.park_page_id, parkName: r.park_name, earliestDate: r.earliest_date }));
}
