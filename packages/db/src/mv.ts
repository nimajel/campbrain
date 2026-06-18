import { sql } from "drizzle-orm";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";

export const MV_CREATE_SQL = `
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_available_stays AS
WITH avail AS (
  SELECT s.provider_id, s.park_page_id, s.campground_name, s.site_name, s.site_id,
         a.date, s.is_walk_up
  FROM availability a
  JOIN sites s ON s.site_id = a.site_id
  WHERE a.status = 'available' AND a.date >= CURRENT_DATE AND s.is_day_use = false
),
stays AS (
  SELECT a.provider_id, a.park_page_id, a.campground_name, a.date AS arrival_date, 1 AS nights,
         a.site_name, a.is_walk_up
  FROM avail a
  UNION ALL
  SELECT a1.provider_id, a1.park_page_id, a1.campground_name, a1.date AS arrival_date, 2 AS nights,
         a1.site_name, a1.is_walk_up
  FROM avail a1
  JOIN avail a2 ON a2.site_id = a1.site_id AND a2.date = a1.date + interval '1 day'
  WHERE NOT a1.is_walk_up
)
SELECT s.provider_id, s.park_page_id, p.park_name, s.campground_name,
       cg.nightly_fee::numeric(8,2), cg.booking_url, s.arrival_date, s.nights,
       coalesce(array_agg(DISTINCT s.site_name ORDER BY s.site_name) FILTER (WHERE NOT s.is_walk_up), '{}'::text[]) AS available_sites,
       coalesce(array_agg(DISTINCT s.site_name ORDER BY s.site_name) FILTER (WHERE s.is_walk_up), '{}'::text[]) AS walk_up_sites
FROM stays s
JOIN parks p ON p.provider_id = s.provider_id AND p.park_page_id = s.park_page_id
JOIN campgrounds cg ON cg.provider_id = s.provider_id AND cg.park_page_id = s.park_page_id AND cg.campground_name = s.campground_name
GROUP BY s.provider_id, s.park_page_id, p.park_name, s.campground_name,
         cg.nightly_fee, cg.booking_url, s.arrival_date, s.nights
WITH NO DATA;
`;

export const MV_INDEX_SQL = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_available_stays_pk ON mv_available_stays(provider_id, park_page_id, campground_name, arrival_date, nights)`,
  `CREATE INDEX IF NOT EXISTS idx_mv_available_stays_date ON mv_available_stays(arrival_date)`,
];

export async function refreshAvailableStays(db: NeonDatabase<Record<string, never>>): Promise<void> {
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_available_stays`);
}
