import { sql } from "drizzle-orm";
import { firstMatchingArrival } from "@campbrain/core";
import { rows, type QueryDb } from "./exec";
import { buildAvailabilityClauses, type AvailabilityClauseOptions } from "./filters";

export interface ParkAvailabilityCount {
  providerId: string;
  parkPageId: string;
  siteCount: number;
  walkUpCount: number;
  /** Earliest bookable date matching the filters; null when only walk-up sites match. */
  soonestDate: string | null;
}

/** Per-park bookable + walk-up counts in the date range, with filters + optional min-stay.
 *  Ported from src/cache/availability-cache.ts:514-583. */
export async function getParkAvailabilityCounts(
  db: QueryDb,
  opts: AvailabilityClauseOptions = {},
): Promise<ParkAvailabilityCount[]> {
  const { conds, dowConds, excludeWalkUp, minNights } = buildAvailabilityClauses(opts);

  if (!minNights) {
    const where = sql.join([...conds, ...dowConds], sql` AND `);
    const bookable = sql`COUNT(DISTINCT s.site_id) FILTER (WHERE NOT s.is_walk_up)`;
    const walkUp = excludeWalkUp ? sql`0` : sql`COUNT(DISTINCT s.site_id) FILTER (WHERE s.is_walk_up)`;
    const having = excludeWalkUp ? sql`(${bookable}) > 0` : sql`(${bookable}) > 0 OR (${walkUp}) > 0`;
    const result = await rows<{ provider_id: string; park_page_id: string; site_count: number; walk_up_count: number; soonest_date: string | null }>(
      db,
      sql`SELECT s.provider_id, s.park_page_id,
                 (${bookable})::int AS site_count,
                 (${walkUp})::int AS walk_up_count,
                 (MIN(a.date) FILTER (WHERE NOT s.is_walk_up))::text AS soonest_date
          FROM availability a
          JOIN sites s ON s.site_id = a.site_id
          WHERE ${where}
          GROUP BY s.provider_id, s.park_page_id
          HAVING ${having}`,
    );
    return result.map((r) => ({
      providerId: r.provider_id,
      parkPageId: r.park_page_id,
      siteCount: Number(r.site_count),
      walkUpCount: Number(r.walk_up_count),
      soonestDate: r.soonest_date ?? null,
    }));
  }

  // Min-stay path: WHERE omits the DOW clause (arrival DOW is checked in firstMatchingArrival).
  const where = sql.join(conds, sql` AND `);
  const dateRows = await rows<{ provider_id: string; park_page_id: string; site_id: number; is_walk_up: boolean; date: string }>(
    db,
    sql`SELECT s.provider_id, s.park_page_id, s.site_id, s.is_walk_up, a.date::text AS date
        FROM availability a
        JOIN sites s ON s.site_id = a.site_id
        WHERE ${where}
        ORDER BY s.provider_id, s.park_page_id, s.site_id, a.date`,
  );

  const bySite = new Map<number, { providerId: string; parkPageId: string; isWalkUp: boolean; dates: string[] }>();
  for (const r of dateRows) {
    let e = bySite.get(r.site_id);
    if (!e) { e = { providerId: r.provider_id, parkPageId: r.park_page_id, isWalkUp: r.is_walk_up, dates: [] }; bySite.set(r.site_id, e); }
    e.dates.push(r.date);
  }

  const stay = { minNights, from: opts.from ?? null, to: opts.to ?? null, weekendsOnly: opts.weekendsOnly ?? false };
  const perPark = new Map<string, { providerId: string; parkPageId: string; siteCount: number; walkUpCount: number; soonestDate: string | null }>();
  for (const { providerId, parkPageId, isWalkUp, dates } of bySite.values()) {
    const arrival = firstMatchingArrival(dates, stay);
    if (arrival === null) continue;
    const key = `${providerId}:${parkPageId}`;
    let p = perPark.get(key);
    if (!p) { p = { providerId, parkPageId, siteCount: 0, walkUpCount: 0, soonestDate: null }; perPark.set(key, p); }
    if (isWalkUp) { if (!excludeWalkUp) p.walkUpCount++; }
    else {
      p.siteCount++;
      if (p.soonestDate === null || arrival < p.soonestDate) p.soonestDate = arrival;
    }
  }

  return [...perPark.values()].filter((c) => c.siteCount > 0 || c.walkUpCount > 0);
}
