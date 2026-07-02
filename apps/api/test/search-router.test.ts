import { describe, it, expect } from "vitest";
import { SearchInputSchema } from "@campbrain/types";

describe("SearchInputSchema", () => {
  it("accepts a minimal valid input and defaults the arrays", () => {
    const parsed = SearchInputSchema.parse({ from: "2026-08-01", to: "2026-08-03" });
    expect(parsed).toMatchObject({ from: "2026-08-01", to: "2026-08-03", access: [], kinds: [], hide: [], region: null });
  });
  it("accepts a full input", () => {
    const parsed = SearchInputSchema.parse({ from: "2026-08-01", to: "2026-08-03", access: ["drive_in"], kinds: ["tent"], hide: ["walk_up"], region: "bay-area" });
    expect(parsed.region).toBe("bay-area");
  });
  it("rejects a non-ISO date", () => {
    expect(SearchInputSchema.safeParse({ from: "08/01/2026", to: "2026-08-03" }).success).toBe(false);
  });
  it("rejects an unknown region", () => {
    expect(SearchInputSchema.safeParse({ from: "2026-08-01", to: "2026-08-03", region: "mars" }).success).toBe(false);
  });
  it("has no minNights field (search infers stay length from the date range)", () => {
    const parsed = SearchInputSchema.parse({ from: "2026-08-01", to: "2026-08-03" }) as Record<string, unknown>;
    expect("minNights" in parsed).toBe(false);
  });
});

import { beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { appRouter } from "../src/trpc/router";
import dayjs from "dayjs";

const URL =
  process.env["DATABASE_URL"] ??
  "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";

async function dbReachable(): Promise<boolean> {
  try {
    const s = postgres(URL, { max: 1, onnotice: () => {}, connect_timeout: 2 });
    await s`SELECT 1`;
    await s.end();
    return true;
  } catch {
    return false;
  }
}

describe("search router (integration)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let caller: ReturnType<typeof appRouter.createCaller> | null = null;

  beforeAll(() => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    const db = drizzle(client, { schema });
    caller = appRouter.createCaller({ db: db as never, auth: {} as never, session: null });
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  const from = dayjs().add(7, "day").format("YYYY-MM-DD");
  const to = dayjs().add(9, "day").format("YYYY-MM-DD");

  // Caller path is caller.search.query(...) because search is mounted as searchRouter
  // with a procedure named "query", giving client path api.search.query(input).
  it.skipIf(!hasDb)("search is public (no session) and returns the park-grouped shape", async () => {
    const res = await caller!.search.query({ from, to });
    expect(res).toHaveProperty("parks");
    expect(res).toHaveProperty("fallback");
    expect(Array.isArray(res.parks)).toBe(true);
    if (res.parks.length > 0) {
      const p = res.parks[0]!;
      expect(p).toHaveProperty("parkPageId");
      expect(p).toHaveProperty("region");
      expect(typeof p.totalAvailable).toBe("number");
    }
  });

  it.skipIf(!hasDb)("region filter narrows the result to that region", async () => {
    const all = await caller!.search.query({ from, to });
    const bay = await caller!.search.query({ from, to, region: "bay-area" });
    expect(bay.parks.every((p) => p.region === "bay-area")).toBe(true);
    expect(bay.parks.length).toBeLessThanOrEqual(all.parks.length);
  });
});

describe("search router cross-provider park_page_id collision (integration)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let caller: ReturnType<typeof appRouter.createCaller> | null = null;

  const PROVIDER_A = "test-1b-search-router-a";
  const PROVIDER_B = "test-1b-search-router-b";
  const SHARED_PARK = "500";
  // Distinct, non-overlapping coordinates so a misattributed lookup is detectable.
  const COORDS_A = { lat: 38.5, lon: -121.5 }; // Sacramento area -> north-coast/sierra-ish
  const COORDS_B = { lat: 33.8, lon: -117.9 }; // SoCal

  const d0 = dayjs().add(3, "day").format("YYYY-MM-DD");
  const d1 = dayjs().add(4, "day").format("YYYY-MM-DD");

  async function seedProvider(
    sql: ReturnType<typeof postgres>,
    provider: string,
    siteName: string,
    coords: { lat: number; lon: number },
  ) {
    await sql`INSERT INTO providers (provider_id, display_name) VALUES (${provider}, ${provider}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO parks (provider_id, park_page_id, park_name, latitude, longitude)
      VALUES (${provider}, ${SHARED_PARK}, ${`Park ${provider}`}, ${coords.lat}, ${coords.lon})
      ON CONFLICT (provider_id, park_page_id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude`;
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
    client = postgres(URL, { max: 1, onnotice: () => {} });
    await seedProvider(client, PROVIDER_A, "CA Site 1", COORDS_A);
    await seedProvider(client, PROVIDER_B, "Federal Site 1", COORDS_B);
    const db = drizzle(client, { schema });
    caller = appRouter.createCaller({ db: db as never, auth: {} as never, session: null });
  });

  afterAll(async () => {
    if (!client) return;
    for (const provider of [PROVIDER_A, PROVIDER_B]) {
      await client`DELETE FROM availability WHERE site_id IN (SELECT site_id FROM sites WHERE provider_id = ${provider})`;
      await client`DELETE FROM sites WHERE provider_id = ${provider}`;
      await client`DELETE FROM campgrounds WHERE provider_id = ${provider}`;
      await client`DELETE FROM parks WHERE provider_id = ${provider}`;
      await client`DELETE FROM providers WHERE provider_id = ${provider}`;
    }
    await client.end();
  });

  it.skipIf(!hasDb)("returns both parks with their own provider and coordinates, not merged/misattributed", async () => {
    const from = d0;
    const to = d1;
    const res = await caller!.search.query({ from, to });
    const matches = res.parks.filter((p) => p.parkPageId === SHARED_PARK && [PROVIDER_A, PROVIDER_B].includes(p.provider));
    expect(matches).toHaveLength(2);

    const parkA = matches.find((p) => p.provider === PROVIDER_A)!;
    const parkB = matches.find((p) => p.provider === PROVIDER_B)!;
    expect(parkA.campgrounds[0]!.availableSites).toEqual(["CA Site 1"]);
    expect(parkB.campgrounds[0]!.availableSites).toEqual(["Federal Site 1"]);

    // Coordinates were region-classified from each provider's OWN park row, not a
    // cross-provider merge — the two seeded locations classify to different regions.
    expect(parkA.region).not.toBe(parkB.region);
  });
});
