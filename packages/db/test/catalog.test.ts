import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getCatalogParks } from "../src/queries/catalog";
import { createTestDb, dbReachable } from "./helpers";

describe("getCatalogParks (integration)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  const PROVIDER = "test-1b-cat";
  const PARK = "cat-park";

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    const sql = env.client;
    await sql`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER}, 'Test') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO parks (provider_id, park_page_id, park_name, latitude, longitude)
      VALUES (${PROVIDER}, ${PARK}, 'Catalog Park', 37.5, -122.0)
      ON CONFLICT (provider_id, park_page_id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude`;
    await sql`INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id) VALUES
      (${PROVIDER}, ${PARK}, 'Loop A', 'loop-a'),
      (${PROVIDER}, ${PARK}, 'Loop B', 'loop-b') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO sites (provider_id, park_page_id, campground_name, site_name) VALUES
      (${PROVIDER}, ${PARK}, 'Loop A', 'A1'),
      (${PROVIDER}, ${PARK}, 'Loop A', 'A2'),
      (${PROVIDER}, ${PARK}, 'Loop B', 'B1')
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET site_name = EXCLUDED.site_name`;
  });

  afterAll(async () => {
    if (!env) return;
    const sql = env.client;
    await sql`DELETE FROM sites WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM campgrounds WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM parks WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM providers WHERE provider_id = ${PROVIDER}`;
    await env.client.end();
  });

  it.skipIf(!hasDb)("returns the park with coordinates and campground site counts", async () => {
    const parks = await getCatalogParks(env!.db);
    const park = parks.find((p) => p.parkPageId === PARK);
    expect(park).toBeTruthy();
    expect(park!.latitude).toBe(37.5);
    expect(park!.longitude).toBe(-122.0);
    const cgs = Object.fromEntries(park!.campgrounds.map((c) => [c.name, c.siteCount]));
    expect(cgs).toEqual({ "Loop A": 2, "Loop B": 1 });
  });
});
