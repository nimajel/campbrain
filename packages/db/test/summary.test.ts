import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getParkAvailabilityCounts } from "../src/queries/summary";
import { createTestDb, dbReachable } from "./helpers";

describe("getParkAvailabilityCounts (integration)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  const PROVIDER = "test-1b-sum";
  const PARK = "sum-park";

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    const sql = env.client;
    await sql`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER}, 'Test') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO parks (provider_id, park_page_id, park_name) VALUES (${PROVIDER}, ${PARK}, 'Sum Park') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id) VALUES (${PROVIDER}, ${PARK}, 'CG', 'cg') ON CONFLICT DO NOTHING`;
    const [book] = await sql`INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, access, site_kind)
      VALUES (${PROVIDER}, ${PARK}, 'CG', 'Tent 1', 'drive_in', 'tent')
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET site_name = EXCLUDED.site_name RETURNING site_id`;
    const [walk] = await sql`INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, is_walk_up)
      VALUES (${PROVIDER}, ${PARK}, 'CG', 'Hike 1', true)
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET is_walk_up = EXCLUDED.is_walk_up RETURNING site_id`;
    await sql`INSERT INTO availability (site_id, date, status) VALUES
      (${book!.site_id}, '2999-02-01', 'available'),
      (${book!.site_id}, '2999-02-02', 'available'),
      (${walk!.site_id}, '2999-02-01', 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
  });

  afterAll(async () => {
    if (!env) return;
    const sql = env.client;
    await sql`DELETE FROM availability WHERE site_id IN (SELECT site_id FROM sites WHERE provider_id = ${PROVIDER})`;
    await sql`DELETE FROM sites WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM campgrounds WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM parks WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM providers WHERE provider_id = ${PROVIDER}`;
    await env.client.end();
  });

  const find = (arr: Awaited<ReturnType<typeof getParkAvailabilityCounts>>) => arr.find((p) => p.parkPageId === PARK);

  it.skipIf(!hasDb)("counts bookable + walk-up with soonest date", async () => {
    const p = find(await getParkAvailabilityCounts(env!.db, {}));
    expect(p).toBeTruthy();
    expect(p!.siteCount).toBe(1);
    expect(p!.walkUpCount).toBe(1);
    expect(p!.soonestDate).toBe("2999-02-01");
  });
  it.skipIf(!hasDb)("hides walk-up when requested", async () => {
    const p = find(await getParkAvailabilityCounts(env!.db, { hide: ["walk_up"] }));
    expect(p!.walkUpCount).toBe(0);
  });
  it.skipIf(!hasDb)("min-stay 2 keeps the 2-consecutive-night bookable site", async () => {
    const p = find(await getParkAvailabilityCounts(env!.db, { minNights: 2 }));
    expect(p!.siteCount).toBe(1);
  });
  it.skipIf(!hasDb)("access filter with no matches returns no park row", async () => {
    const p = find(await getParkAvailabilityCounts(env!.db, { access: ["boat_in"] }));
    expect(p).toBeUndefined();
  });
});
