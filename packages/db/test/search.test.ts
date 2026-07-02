import { describe, it, expect, beforeAll, afterAll } from "vitest";
import dayjs from "dayjs";
import { searchAvailableStays, findNextAvailableDates } from "../src/queries/search";
import { createTestDb, dbReachable } from "./helpers";

describe("searchAvailableStays + findNextAvailableDates (integration)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  const PROVIDER = "test-1b-search";
  const PARK = "search-park";

  // Compute near-future dates so findNextAvailableDates (bounded to CURRENT_DATE…+withinDays) sees them
  const d0 = dayjs().add(3, "day").format("YYYY-MM-DD");
  const d1 = dayjs().add(4, "day").format("YYYY-MM-DD");
  const d2 = dayjs().add(5, "day").format("YYYY-MM-DD");

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    const sql = env.client;

    await sql`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER}, 'Test Search') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO parks (provider_id, park_page_id, park_name) VALUES (${PROVIDER}, ${PARK}, 'Search Park') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id, nightly_fee, booking_url)
      VALUES (${PROVIDER}, ${PARK}, 'CG', 'cg-search', 45.00, 'http://book') ON CONFLICT DO NOTHING`;
    const [site] = await sql`
      INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, access)
      VALUES (${PROVIDER}, ${PARK}, 'CG', 'Site 1', 'drive_in')
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name)
        DO UPDATE SET site_name = EXCLUDED.site_name
      RETURNING site_id`;
    const siteId = site!.site_id;
    // Insert availability for d0, d1, d2 (three consecutive nights)
    await sql`INSERT INTO availability (site_id, date, status) VALUES (${siteId}, ${d0}::date, 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
    await sql`INSERT INTO availability (site_id, date, status) VALUES (${siteId}, ${d1}::date, 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
    await sql`INSERT INTO availability (site_id, date, status) VALUES (${siteId}, ${d2}::date, 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;

    // Walk-up site available on the same nights as Site 1
    const [walkUpSite] = await sql`
      INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, access, is_walk_up)
      VALUES (${PROVIDER}, ${PARK}, 'CG', 'Hike 1', 'hike_in', true)
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name)
        DO UPDATE SET is_walk_up = EXCLUDED.is_walk_up
      RETURNING site_id`;
    const walkUpSiteId = walkUpSite!.site_id;
    await sql`INSERT INTO availability (site_id, date, status) VALUES (${walkUpSiteId}, ${d0}::date, 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
    await sql`INSERT INTO availability (site_id, date, status) VALUES (${walkUpSiteId}, ${d1}::date, 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
    await sql`INSERT INTO availability (site_id, date, status) VALUES (${walkUpSiteId}, ${d2}::date, 'available')
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

  it.skipIf(!hasDb)("searchAvailableStays: 2-night stay returns search-park with Site 1 in availableSites", async () => {
    // from=d0, to=d2 → covers nights d0 and d1 (exclusive upper bound)
    const results = await searchAvailableStays(env!.db, { from: d0, to: d2 });
    const park = results.find((p) => p.parkPageId === PARK);
    expect(park).toBeDefined();
    const cg = park!.campgrounds.find((c) => c.name === "CG");
    expect(cg).toBeDefined();
    expect(cg!.availableSites).toContain("Site 1");
    expect(cg!.walkUpSites).toContain("Hike 1");
  });

  it.skipIf(!hasDb)("searchAvailableStays: 5-night stay (more than 3 available nights) returns no match for search-park", async () => {
    const to5 = dayjs(d0).add(5, "day").format("YYYY-MM-DD");
    const results = await searchAvailableStays(env!.db, { from: d0, to: to5 });
    const park = results.find((p) => p.parkPageId === PARK);
    expect(park).toBeUndefined();
  });

  it.skipIf(!hasDb)("findNextAvailableDates: includes search-park with earliestDate === d0", async () => {
    // Scope to our test park so the LIMIT 5 doesn't cut it out when real park data exists
    const results = await findNextAvailableDates(env!.db, { parkPageIds: [PARK] });
    const park = results.find((r) => r.parkPageId === PARK);
    expect(park).toBeDefined();
    expect(park!.earliestDate).toBe(d0);
  });

  it.skipIf(!hasDb)("findNextAvailableDates: parkPageIds filter excludes search-park when nonexistent id given", async () => {
    const results = await findNextAvailableDates(env!.db, { parkPageIds: ["nonexistent-xyz"] });
    const park = results.find((r) => r.parkPageId === PARK);
    expect(park).toBeUndefined();
  });

  it.skipIf(!hasDb)("searchAvailableStays: walk-up site appears in walkUpSites, not availableSites", async () => {
    const results = await searchAvailableStays(env!.db, { from: d0, to: d2 });
    const park = results.find((p) => p.parkPageId === PARK);
    expect(park).toBeDefined();
    const cg = park!.campgrounds.find((c) => c.name === "CG");
    expect(cg).toBeDefined();
    expect(cg!.availableSites).toContain("Site 1");
    expect(cg!.walkUpSites).toContain("Hike 1");
    expect(cg!.availableSites).not.toContain("Hike 1");
  });

  it.skipIf(!hasDb)("searchAvailableStays: hide walk_up excludes walk-up sites entirely from result", async () => {
    const results = await searchAvailableStays(env!.db, { from: d0, to: d2, hide: ["walk_up"] });
    const park = results.find((p) => p.parkPageId === PARK);
    expect(park).toBeDefined();
    const cg = park!.campgrounds.find((c) => c.name === "CG");
    expect(cg).toBeDefined();
    expect(cg!.availableSites).toContain("Site 1");
    expect(cg!.walkUpSites).toEqual([]);
  });
});

describe("cross-provider park_page_id collision (integration)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  const PROVIDER_A = "test-1b-collide-a";
  const PROVIDER_B = "test-1b-collide-b";
  const SHARED_PARK = "500";

  const d0 = dayjs().add(3, "day").format("YYYY-MM-DD");
  const d1 = dayjs().add(4, "day").format("YYYY-MM-DD");

  async function seedProvider(sql: ReturnType<typeof createTestDb>["client"], provider: string, siteName: string) {
    await sql`INSERT INTO providers (provider_id, display_name) VALUES (${provider}, ${provider}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO parks (provider_id, park_page_id, park_name) VALUES (${provider}, ${SHARED_PARK}, ${`Park ${provider}`}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id, nightly_fee, booking_url)
      VALUES (${provider}, ${SHARED_PARK}, 'CG', ${`cg-${provider}`}, 20.00, 'http://book') ON CONFLICT DO NOTHING`;
    const [site] = await sql`
      INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, access)
      VALUES (${provider}, ${SHARED_PARK}, 'CG', ${siteName}, 'drive_in')
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name)
        DO UPDATE SET site_name = EXCLUDED.site_name
      RETURNING site_id`;
    const siteId = site!.site_id;
    await sql`INSERT INTO availability (site_id, date, status) VALUES (${siteId}, ${d0}::date, 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
    await sql`INSERT INTO availability (site_id, date, status) VALUES (${siteId}, ${d1}::date, 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
  }

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    const sql = env.client;
    await seedProvider(sql, PROVIDER_A, "CA Site 1");
    await seedProvider(sql, PROVIDER_B, "Federal Site 1");
  });

  afterAll(async () => {
    if (!env) return;
    const sql = env.client;
    for (const provider of [PROVIDER_A, PROVIDER_B]) {
      await sql`DELETE FROM availability WHERE site_id IN (SELECT site_id FROM sites WHERE provider_id = ${provider})`;
      await sql`DELETE FROM sites WHERE provider_id = ${provider}`;
      await sql`DELETE FROM campgrounds WHERE provider_id = ${provider}`;
      await sql`DELETE FROM parks WHERE provider_id = ${provider}`;
      await sql`DELETE FROM providers WHERE provider_id = ${provider}`;
    }
    await env.client.end();
  });

  it.skipIf(!hasDb)("searchAvailableStays returns two separate parks for the same park_page_id under different providers", async () => {
    const results = await searchAvailableStays(env!.db, { from: d0, to: d1 });
    const matches = results.filter((p) => p.parkPageId === SHARED_PARK && [PROVIDER_A, PROVIDER_B].includes(p.providerId));
    expect(matches).toHaveLength(2);
    const providerIds = matches.map((m) => m.providerId).sort();
    expect(providerIds).toEqual([PROVIDER_A, PROVIDER_B].sort());

    const parkA = matches.find((m) => m.providerId === PROVIDER_A)!;
    const parkB = matches.find((m) => m.providerId === PROVIDER_B)!;
    expect(parkA.campgrounds[0]!.availableSites).toEqual(["CA Site 1"]);
    expect(parkB.campgrounds[0]!.availableSites).toEqual(["Federal Site 1"]);
  });

  it.skipIf(!hasDb)("findNextAvailableDates returns two rows for the same park_page_id under different providers", async () => {
    const results = await findNextAvailableDates(env!.db, { parkPageIds: [SHARED_PARK] });
    const matches = results.filter((r) => r.parkPageId === SHARED_PARK && [PROVIDER_A, PROVIDER_B].includes(r.providerId));
    expect(matches).toHaveLength(2);
    const providerIds = matches.map((m) => m.providerId).sort();
    expect(providerIds).toEqual([PROVIDER_A, PROVIDER_B].sort());
  });
});
