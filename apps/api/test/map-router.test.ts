import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { appRouter } from "../src/trpc/router";
import { upsertParkDigest } from "@campbrain/db";
import { buildParkAvailability, buildSiteClassMap, filterDigest, addDays } from "@campbrain/core";
import type { AvailabilityWindowEntry, SiteClassEntry } from "@campbrain/core";

const URL =
  process.env["DATABASE_URL"] ??
  "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";

const DIGEST_PARK = "digest-router-test-park";
const DIGEST_CG = "Digest Router Test Campground";
const NO_DIGEST_PARK = "digest-router-test-park-no-digest";
const MALFORMED_DIGEST_PARK = "digest-router-test-park-malformed";

// Far-future window so today-dependence in buildParkAvailability can't flake.
const WINDOW_START = "2027-09-10"; // Friday
const WINDOW_END = addDays(WINDOW_START, 7);

function makeFixtureEntries(parkPageId: string, cgName: string): AvailabilityWindowEntry[] {
  return [
    {
      parkPageId,
      parkName: "Digest Router Test Park",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      scannedAt: "2027-09-01T00:00:00Z",
      sourceUrl: "http://x",
      campgrounds: [
        {
          id: cgName,
          name: cgName,
          nightlyFee: 35,
          bookingUrl: "http://book",
          sites: [
            { name: "Tent Site #1", dates: { [WINDOW_START]: "available" } },
            { name: "Hike/Bike Campsite #HB1", dates: { [WINDOW_START]: "available" } },
          ],
        },
      ],
    },
  ];
}

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

describe("map router (integration)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let caller: ReturnType<typeof appRouter.createCaller> | null = null;

  let dbHandle: ReturnType<typeof drizzle> | null = null;

  beforeAll(async () => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    dbHandle = drizzle(client, { schema });
    caller = appRouter.createCaller({ db: dbHandle as never, auth: {} as never, session: null });

    await client`DELETE FROM park_digests WHERE park_page_id IN (${DIGEST_PARK}, ${NO_DIGEST_PARK}, ${MALFORMED_DIGEST_PARK})`;
    await client`DELETE FROM sites WHERE park_page_id IN (${DIGEST_PARK}, ${NO_DIGEST_PARK}, ${MALFORMED_DIGEST_PARK})`;
    await client`DELETE FROM campgrounds WHERE park_page_id IN (${DIGEST_PARK}, ${NO_DIGEST_PARK}, ${MALFORMED_DIGEST_PARK})`;
    await client`DELETE FROM parks WHERE park_page_id IN (${DIGEST_PARK}, ${NO_DIGEST_PARK}, ${MALFORMED_DIGEST_PARK})`;

    await client`
      INSERT INTO parks (provider_id, park_page_id, park_name)
      VALUES ('california-parks', ${DIGEST_PARK}, 'Digest Router Test Park'),
             ('california-parks', ${NO_DIGEST_PARK}, 'No Digest Router Test Park'),
             ('california-parks', ${MALFORMED_DIGEST_PARK}, 'Malformed Digest Router Test Park')
    `;
    await client`
      INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id, nightly_fee, booking_url)
      VALUES ('california-parks', ${DIGEST_PARK}, ${DIGEST_CG}, ${DIGEST_CG}, 35, 'http://book')
    `;
    await client`
      INSERT INTO sites (provider_id, park_page_id, campground_name, site_name)
      VALUES ('california-parks', ${DIGEST_PARK}, ${DIGEST_CG}, 'Tent Site #1'),
             ('california-parks', ${DIGEST_PARK}, ${DIGEST_CG}, 'Hike/Bike Campsite #HB1')
    `;

    const fixture = makeFixtureEntries(DIGEST_PARK, DIGEST_CG);
    const digest = buildParkAvailability(fixture, {}, DIGEST_PARK);
    const siteClass = buildSiteClassMap(fixture, DIGEST_PARK);
    await upsertParkDigest(dbHandle, {
      provider: "california-parks",
      parkPageId: DIGEST_PARK,
      asOf: digest.asOf,
      digest,
      siteClass,
    });

    // Structurally malformed digest (missing nextAvailableDates etc.) seeded via raw
    // SQL — upsertParkDigest is typed and can't produce this shape.
    await client`
      INSERT INTO park_digests (provider, park_page_id, as_of, digest, site_class)
      VALUES ('california-parks', ${MALFORMED_DIGEST_PARK}, NULL, '{}'::jsonb, '{}'::jsonb)
    `;
  });

  afterAll(async () => {
    if (client) {
      await client`DELETE FROM park_digests WHERE park_page_id IN (${DIGEST_PARK}, ${NO_DIGEST_PARK}, ${MALFORMED_DIGEST_PARK})`;
      await client`DELETE FROM sites WHERE park_page_id IN (${DIGEST_PARK}, ${NO_DIGEST_PARK}, ${MALFORMED_DIGEST_PARK})`;
      await client`DELETE FROM campgrounds WHERE park_page_id IN (${DIGEST_PARK}, ${NO_DIGEST_PARK}, ${MALFORMED_DIGEST_PARK})`;
      await client`DELETE FROM parks WHERE park_page_id IN (${DIGEST_PARK}, ${NO_DIGEST_PARK}, ${MALFORMED_DIGEST_PARK})`;
      await client.end();
    }
  });

  it.skipIf(!hasDb)("catalog returns mapped parks", async () => {
    const { parks } = await caller!.map.catalog();
    expect(Array.isArray(parks)).toBe(true);
    if (parks.length > 0) {
      const p = parks[0]!;
      expect(p).toHaveProperty("provider");
      expect(p).toHaveProperty("siteCount");
      expect(typeof p.campgroundCount).toBe("number");
      expect(p).toHaveProperty("parkPageId");
      expect(typeof p.parkPageId).toBe("string");
    }
  });

  it.skipIf(!hasDb)("availability returns a ParkAvailabilityResponse shape for a park", async () => {
    const { parks } = await caller!.map.catalog();
    const parkId = parks[0]?.parkPageId ?? "468";
    const res = await caller!.map.availability({ parkPageId: parkId, access: [], kinds: [], hide: [] });
    expect(res).toHaveProperty("nextAvailableDates");
    expect(res).toHaveProperty("nextAvailableWeekends");
    expect(res.parkPageId).toBe(parkId);
  });

  it.skipIf(!hasDb)("summary returns { parks } counts", async () => {
    const { parks } = await caller!.map.summary({ access: [], kinds: [], hide: [], weekendsOnly: false });
    expect(Array.isArray(parks)).toBe(true);
  });

  it.skipIf(!hasDb)("availability serves the digest fast path when a park_digests row exists", async () => {
    const fixture = makeFixtureEntries(DIGEST_PARK, DIGEST_CG);
    const digest = buildParkAvailability(fixture, {}, DIGEST_PARK);
    const siteClass = buildSiteClassMap(fixture, DIGEST_PARK);

    const res = await caller!.map.availability({
      parkPageId: DIGEST_PARK,
      access: [],
      kinds: [],
      hide: [],
    });
    const expected = filterDigest(digest, siteClass, { access: [], kinds: [], hide: [] });
    expect(res).toEqual(expected);

    const filteredRes = await caller!.map.availability({
      parkPageId: DIGEST_PARK,
      access: [],
      kinds: [],
      hide: ["walk_up"],
    });
    const expectedFiltered = filterDigest(digest, siteClass, { access: [], kinds: [], hide: ["walk_up"] });
    expect(filteredRes).toEqual(expectedFiltered);
  });

  it.skipIf(!hasDb)("availability falls back to live compute when the stored digest is malformed", async () => {
    const res = await caller!.map.availability({
      parkPageId: MALFORMED_DIGEST_PARK,
      access: [],
      kinds: [],
      hide: [],
    });
    expect(res.parkPageId).toBe(MALFORMED_DIGEST_PARK);
    expect(Array.isArray(res.nextAvailableDates)).toBe(true);
    expect(Array.isArray(res.nextAvailableWeekends)).toBe(true);
  });

  it.skipIf(!hasDb)("availability falls back to live compute when no park_digests row exists", async () => {
    const res = await caller!.map.availability({
      parkPageId: NO_DIGEST_PARK,
      access: [],
      kinds: [],
      hide: [],
    });
    expect(res.parkPageId).toBe(NO_DIGEST_PARK);
    expect(Array.isArray(res.nextAvailableDates)).toBe(true);
    expect(Array.isArray(res.nextAvailableWeekends)).toBe(true);
  });
});
