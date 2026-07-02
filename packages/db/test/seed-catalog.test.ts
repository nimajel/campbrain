import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { seedCatalog } from "../src/seed-catalog";
import { createTestDb, dbReachable } from "./helpers";

function recreationGovCatalogPathForTest(): string {
  return fileURLToPath(new URL("../../../data/catalog/recreation-gov.json", import.meta.url));
}

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

describe("seedCatalog (recreation-gov, second provider)", async () => {
  // Seeds CA first, then recreation-gov, into the shared local DB — non-isolated by design
  // (matches the harness above). Confirms Rec.gov seeds as bare park rows and leaves CA untouched.
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  let caCountsBefore: { parks: number; campgrounds: number; sites: number } | null = null;

  type CountRow = { count: number };
  async function countsFor(sql: ReturnType<typeof createTestDb>["client"], providerId: string) {
    const parkRows = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM parks WHERE provider_id = ${providerId}`;
    const campgroundRows = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM campgrounds WHERE provider_id = ${providerId}`;
    const siteRows = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM sites WHERE provider_id = ${providerId}`;
    return {
      parks: Number(parkRows[0]!.count),
      campgrounds: Number(campgroundRows[0]!.count),
      sites: Number(siteRows[0]!.count),
    };
  }

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    await seedCatalog(env.client);
    caCountsBefore = await countsFor(env.client, "california-parks");
    await seedCatalog(env.client, {
      providerId: "recreation-gov",
      providerName: "Recreation.gov",
      catalogPath: recreationGovCatalogPathForTest(),
    });
  }, 120_000);

  afterAll(async () => { if (env) await env.client.end(); });

  it.skipIf(!hasDb)("creates a recreation-gov providers row", async () => {
    const sql = env!.client;
    const rows = await sql<{ provider_id: string; display_name: string }[]>`
      SELECT provider_id, display_name FROM providers WHERE provider_id = 'recreation-gov'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.display_name).toBe("Recreation.gov");
  });

  it.skipIf(!hasDb)("seeds recreation-gov park rows with lat/lon", async () => {
    const sql = env!.client;
    const parkRows = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM parks WHERE provider_id = 'recreation-gov'`;
    expect(Number(parkRows[0]!.count)).toBeGreaterThan(500); // ~650 parks in the catalog file
    const latRows = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM parks WHERE provider_id = 'recreation-gov' AND latitude IS NOT NULL`;
    expect(Number(latRows[0]!.count)).toBeGreaterThan(500);
  });

  it.skipIf(!hasDb)("seeds zero campgrounds/sites for a bare (campgrounds: []) park", async () => {
    const sql = env!.client;
    // Mariners Point Group Campground — present in recreation-gov.json with campgrounds: [].
    const parkPageId = "273755";
    const parkRows = await sql<{ park_name: string }[]>`
      SELECT park_name FROM parks WHERE provider_id = 'recreation-gov' AND park_page_id = ${parkPageId}`;
    expect(parkRows).toHaveLength(1);
    expect(parkRows[0]!.park_name).toBe("Mariners Point Group Campground");
    const cgRows = await sql<CountRow[]>`
      SELECT COUNT(*)::int AS count FROM campgrounds WHERE provider_id = 'recreation-gov' AND park_page_id = ${parkPageId}`;
    expect(Number(cgRows[0]!.count)).toBe(0);
    const siteRows = await sql<CountRow[]>`
      SELECT COUNT(*)::int AS count FROM sites WHERE provider_id = 'recreation-gov' AND park_page_id = ${parkPageId}`;
    expect(Number(siteRows[0]!.count)).toBe(0);
  });

  it.skipIf(!hasDb)("leaves existing california-parks rows undisturbed", async () => {
    const sql = env!.client;
    const caCountsAfter = await countsFor(sql, "california-parks");
    expect(caCountsAfter).toEqual(caCountsBefore);
  });
});
