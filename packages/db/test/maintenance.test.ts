import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { evictExpired } from "../src/queries/maintenance";
import { refreshMaterializedView } from "../src/mv";
import { createTestDb, dbReachable } from "./helpers";

const PROVIDER = "test-1c-mx";
const PARK = "mx-park";

describe("evictExpired + refreshMaterializedView (integration)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    const sql = env.client;
    await sql`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER}, 'Test') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO parks (provider_id, park_page_id, park_name) VALUES (${PROVIDER}, ${PARK}, 'MX Park') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id) VALUES (${PROVIDER}, ${PARK}, 'CG', 'cg') ON CONFLICT DO NOTHING`;
    const [site] = await sql`INSERT INTO sites (provider_id, park_page_id, campground_name, site_name) VALUES (${PROVIDER}, ${PARK}, 'CG', 'S1') ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET site_name = EXCLUDED.site_name RETURNING site_id`;
    await sql`INSERT INTO scan_windows (provider_id, park_page_id, window_start, window_end, scanned_at, source_url) VALUES
      (${PROVIDER}, ${PARK}, '2000-01-01', '2000-01-08', NOW(), 'x'),
      (${PROVIDER}, ${PARK}, '2999-01-01', '2999-01-08', NOW(), 'x') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO availability (site_id, date, status) VALUES
      (${site!.site_id}, '2000-01-02', 'available'),
      (${site!.site_id}, '2999-01-02', 'available') ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
  });
  afterAll(async () => {
    if (!env) return;
    const sql = env.client;
    await sql`DELETE FROM availability WHERE site_id IN (SELECT site_id FROM sites WHERE provider_id = ${PROVIDER})`;
    await sql`DELETE FROM sites WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM campgrounds WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM scan_windows WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM parks WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM providers WHERE provider_id = ${PROVIDER}`;
    await env.client.end();
  });

  it.skipIf(!hasDb)("evicts past windows + availability, keeps future", { timeout: 15_000 }, async () => {
    const removed = await evictExpired(env!.db);
    expect(removed).toBeGreaterThanOrEqual(1);
    const pastSwRows = await env!.client`SELECT COUNT(*)::int AS count FROM scan_windows WHERE provider_id = ${PROVIDER} AND window_start = '2000-01-01'`;
    expect(Number(pastSwRows[0]?.["count"])).toBe(0);
    const futSwRows = await env!.client`SELECT COUNT(*)::int AS count FROM scan_windows WHERE provider_id = ${PROVIDER} AND window_start = '2999-01-01'`;
    expect(Number(futSwRows[0]?.["count"])).toBe(1);
    const pastAvailRows = await env!.client`SELECT COUNT(*)::int AS count FROM availability a JOIN sites s ON s.site_id = a.site_id WHERE s.provider_id = ${PROVIDER} AND a.date = '2000-01-02'`;
    expect(Number(pastAvailRows[0]?.["count"])).toBe(0);
  });

  it.skipIf(!hasDb)("refreshMaterializedView does not throw", { timeout: 30_000 }, async () => {
    await expect(refreshMaterializedView(env!.db)).resolves.toBeUndefined();
  });
});
