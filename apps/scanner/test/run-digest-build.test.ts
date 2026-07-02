import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { runDigestBuild } from "../src/run-digest-build";
import { getParkDigest } from "@campbrain/db";
import { buildParkAvailability, buildSiteClassMap, addDays } from "@campbrain/core";
import type { AvailabilityWindowEntry } from "@campbrain/core";

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

const PARK_A = "digest-test-park-a";
const PARK_B = "digest-test-park-b";
const CG_A = "Digest Test Campground A";
const CG_B = "Digest Test Campground B";

// Far-future window so today-dependence in buildParkAvailability can't flake.
const WINDOW_START = "2027-08-13"; // Friday
const WINDOW_END = addDays(WINDOW_START, 7);

function makeFixtureEntries(parkPageId: string, cgName: string): AvailabilityWindowEntry[] {
  return [
    {
      parkPageId,
      parkName: "Digest Test Park",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      scannedAt: "2027-08-01T00:00:00Z",
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

describe("runDigestBuild (integration)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let db: ReturnType<typeof drizzle> | null = null;

  beforeAll(async () => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });

    await client`DELETE FROM park_digests WHERE park_page_id IN (${PARK_A}, ${PARK_B})`;
    await client`DELETE FROM sites WHERE park_page_id IN (${PARK_A}, ${PARK_B})`;
    await client`DELETE FROM campgrounds WHERE park_page_id IN (${PARK_A}, ${PARK_B})`;
    await client`DELETE FROM parks WHERE park_page_id IN (${PARK_A}, ${PARK_B})`;

    await client`
      INSERT INTO parks (provider_id, park_page_id, park_name)
      VALUES ('california-parks', ${PARK_A}, 'Digest Test Park A'),
             ('california-parks', ${PARK_B}, 'Digest Test Park B')
    `;
    await client`
      INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id, nightly_fee, booking_url)
      VALUES ('california-parks', ${PARK_A}, ${CG_A}, ${CG_A}, 35, 'http://book'),
             ('california-parks', ${PARK_B}, ${CG_B}, ${CG_B}, 35, 'http://book')
    `;
    await client`
      INSERT INTO sites (provider_id, park_page_id, campground_name, site_name)
      VALUES ('california-parks', ${PARK_A}, ${CG_A}, 'Tent Site #1'),
             ('california-parks', ${PARK_A}, ${CG_A}, 'Hike/Bike Campsite #HB1'),
             ('california-parks', ${PARK_B}, ${CG_B}, 'Tent Site #1'),
             ('california-parks', ${PARK_B}, ${CG_B}, 'Hike/Bike Campsite #HB1')
    `;
  });

  afterAll(async () => {
    if (client) {
      await client`DELETE FROM park_digests WHERE park_page_id IN (${PARK_A}, ${PARK_B})`;
      await client`DELETE FROM sites WHERE park_page_id IN (${PARK_A}, ${PARK_B})`;
      await client`DELETE FROM campgrounds WHERE park_page_id IN (${PARK_A}, ${PARK_B})`;
      await client`DELETE FROM parks WHERE park_page_id IN (${PARK_A}, ${PARK_B})`;
      await client.end();
    }
  });

  it.skipIf(!hasDb)(
    "builds digest for park A, isolates park B's throw, records a digest scan run",
    async () => {
      const fixtureA = makeFixtureEntries(PARK_A, CG_A);
      const logs: string[] = [];

      await runDigestBuild({
        db: db as never,
        log: (m) => logs.push(m),
        getEntries: async (_db, ids) => {
          const id = ids[0];
          if (id === PARK_B) throw new Error("simulated fetch failure for park B");
          if (id === PARK_A) return fixtureA;
          return [];
        },
      });

      // (a) Park A's digest present and deep-equals the pure-function output.
      const expectedDigest = buildParkAvailability(fixtureA, {}, PARK_A);
      const expectedSiteClass = buildSiteClassMap(fixtureA, PARK_A);

      const storedA = await getParkDigest(db as never, "california-parks", PARK_A);
      expect(storedA).toBeDefined();
      expect(storedA?.digest).toEqual(expectedDigest);
      expect(storedA?.siteClass).toEqual(expectedSiteClass);

      // (b) Park B's throw was isolated — no digest row written for it.
      const storedB = await getParkDigest(db as never, "california-parks", PARK_B);
      expect(storedB).toBeUndefined();
      expect(logs.some((l) => l.includes(PARK_B))).toBe(true);

      // (c) A digest scan_run row was written with parksScanned/errors.
      const runRows = await client!`
        SELECT kind, status, parks_scanned, errors FROM scan_runs
        WHERE kind = 'digest' ORDER BY started_at DESC LIMIT 1
      `;
      expect(runRows[0]).toMatchObject({ kind: "digest", status: "ok" });
      expect(Number(runRows[0]!["parks_scanned"])).toBeGreaterThanOrEqual(1);
      expect(Number(runRows[0]!["errors"])).toBeGreaterThanOrEqual(1);
    },
  );
});
