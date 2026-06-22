import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedCatalog } from "../src/seed-catalog";
import { createTestDb, dbReachable } from "./helpers";

describe("seedCatalog (integration smoke)", async () => {
  // This test seeds the REAL california-parks catalog into the shared local DB —
  // intentionally non-isolated (no cleanup). All upserts are idempotent, so re-runs are safe.
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    await seedCatalog(env.client);
  }, 120_000);

  afterAll(async () => { if (env) await env.client.end(); });

  it.skipIf(!hasDb)("loads california-parks with parks, coords, and classified sites", async () => {
    const sql = env!.client;
    type CountRow = { count: number };
    const parkRows = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM parks WHERE provider_id = 'california-parks'`;
    expect(Number(parkRows[0]!.count)).toBeGreaterThan(150); // ~200 parks
    const latRows = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM parks WHERE provider_id = 'california-parks' AND latitude IS NOT NULL`;
    expect(Number(latRows[0]!.count)).toBeGreaterThan(80);
    const campgroundRows = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM campgrounds WHERE provider_id = 'california-parks'`;
    expect(Number(campgroundRows[0]!.count)).toBeGreaterThan(250); // seed reports ~256 campgrounds
    const siteRows = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM sites WHERE provider_id = 'california-parks'`;
    expect(Number(siteRows[0]!.count)).toBeGreaterThan(1000); // ~6,700 sites
  });
});
