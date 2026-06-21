import { sql } from "drizzle-orm";
import { rows, type QueryDb } from "./exec";

export interface CatalogPark {
  providerId: string;
  parkPageId: string;
  parkName: string;
  latitude: number | null;
  longitude: number | null;
  campgrounds: { name: string; siteCount: number }[];
}

/** All parks that have sites in the DB, with coordinates + per-campground site counts.
 *  Extends src/cache/availability-cache.ts:685-713 with lat/lon. */
export async function getCatalogParks(db: QueryDb): Promise<CatalogPark[]> {
  const result = await rows<{
    provider_id: string; park_page_id: string; park_name: string;
    latitude: string | null; longitude: string | null;
    campground_name: string; site_count: number;
  }>(
    db,
    sql`SELECT p.provider_id, p.park_page_id, p.park_name, p.latitude, p.longitude,
               s.campground_name, COUNT(s.site_id)::int AS site_count
        FROM parks p
        -- INNER JOIN: parks with no sites are excluded (no pins to show)
        JOIN sites s ON s.provider_id = p.provider_id AND s.park_page_id = p.park_page_id
        GROUP BY p.provider_id, p.park_page_id, p.park_name, p.latitude, p.longitude, s.campground_name
        ORDER BY p.park_name, s.campground_name`,
  );

  const byPark = new Map<string, CatalogPark>();
  for (const row of result) {
    const key = `${row.provider_id}:${row.park_page_id}`;
    if (!byPark.has(key)) {
      byPark.set(key, {
        providerId: row.provider_id,
        parkPageId: row.park_page_id,
        parkName: row.park_name,
        latitude: row.latitude != null ? Number(row.latitude) : null,
        longitude: row.longitude != null ? Number(row.longitude) : null,
        campgrounds: [],
      });
    }
    byPark.get(key)!.campgrounds.push({ name: row.campground_name, siteCount: Number(row.site_count) });
  }
  return Array.from(byPark.values());
}
