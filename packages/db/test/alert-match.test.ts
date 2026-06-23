import { describe, it, expect, beforeAll, afterAll } from "vitest";
import dayjs from "dayjs";
import * as schema from "../src/schema";
import { matchSavedSearchAgainstDb, buildParkRegionOf } from "../src/queries/alert-match";
import type { SavedSearch } from "@campbrain/types";
import { createTestDb, dbReachable } from "./helpers";

const PROVIDER = "test-alert-match";
const PARK = "alert-match-test-park";

function fixedSearch(from: string, to: string): SavedSearch {
  return {
    id: "match-test",
    userId: "u1",
    provider: "california-parks",
    name: "n",
    scope: { region: null, parkPageIds: [] },
    datePattern: { kind: "fixed_range", from, to },
    filters: { access: [], kinds: [], hide: [], minNights: 1 },
    alertEnabled: true,
    emailEnabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("matchSavedSearchAgainstDb (integration)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;

  // A near-future 1-night window: arrival = today+7, departure = today+8
  const from = dayjs().add(7, "day").format("YYYY-MM-DD");
  const to = dayjs().add(8, "day").format("YYYY-MM-DD");

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    const sql = env.client;

    // Seed a test park with one available site in the target window
    await sql`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER}, 'Alert Match Test') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO parks (provider_id, park_page_id, park_name, latitude, longitude)
      VALUES (${PROVIDER}, ${PARK}, 'Alert Match Test Park', 37.5, -122.0)
      ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id, nightly_fee, booking_url)
      VALUES (${PROVIDER}, ${PARK}, 'Main CG', 'main-cg-am', 35.00, 'http://book/alert-match')
      ON CONFLICT DO NOTHING`;
    const [site] = await sql`
      INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, access)
      VALUES (${PROVIDER}, ${PARK}, 'Main CG', 'Site AM-1', 'drive_in')
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name)
        DO UPDATE SET site_name = EXCLUDED.site_name
      RETURNING site_id`;
    const siteId = (site as { site_id: number }).site_id;
    // Make site available on the arrival night
    await sql`INSERT INTO availability (site_id, date, status)
      VALUES (${siteId}, ${from}::date, 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;

    // Walk-up site — also available but must NOT appear in openings
    const [walkUp] = await sql`
      INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, access, is_walk_up)
      VALUES (${PROVIDER}, ${PARK}, 'Main CG', 'Hike AM-1', 'hike_in', true)
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name)
        DO UPDATE SET is_walk_up = EXCLUDED.is_walk_up
      RETURNING site_id`;
    const walkUpId = (walkUp as { site_id: number }).site_id;
    await sql`INSERT INTO availability (site_id, date, status)
      VALUES (${walkUpId}, ${from}::date, 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
  });

  afterAll(async () => {
    if (!env) return;
    const sql = env.client;
    await sql`DELETE FROM availability WHERE site_id IN (SELECT site_id FROM sites WHERE provider_id = ${PROVIDER} AND park_page_id = ${PARK})`;
    await sql`DELETE FROM sites WHERE provider_id = ${PROVIDER} AND park_page_id = ${PARK}`;
    await sql`DELETE FROM campgrounds WHERE provider_id = ${PROVIDER} AND park_page_id = ${PARK}`;
    await sql`DELETE FROM parks WHERE provider_id = ${PROVIDER} AND park_page_id = ${PARK}`;
    await sql`DELETE FROM providers WHERE provider_id = ${PROVIDER}`;
    await env.client.end();
  });

  it.skipIf(!hasDb)("returns openings with correct provenance shape", async () => {
    const parkRegionOf = await buildParkRegionOf(env!.db);
    const openings = await matchSavedSearchAgainstDb(
      env!.db,
      fixedSearch(from, to),
      dayjs().format("YYYY-MM-DD"),
      parkRegionOf,
    );
    expect(openings.length).toBeGreaterThan(0);
    const o = openings.find((x) => x.siteName === "Site AM-1");
    expect(o).toBeDefined();
    expect(o!.savedSearchId).toBe("match-test");
    expect(o!.parkPageId).toBe(PARK);
    expect(o!.parkName).toBe("Alert Match Test Park");
    expect(o!.campgroundName).toBe("Main CG");
    expect(o!.arrivalDate).toBe(from);
    expect(o!.departureDate).toBe(to);
    expect(o!.nights).toBe(1);
    expect(typeof o!.bookingUrl).toBe("string");
  });

  it.skipIf(!hasDb)("excludes walk-up sites from openings", async () => {
    const parkRegionOf = await buildParkRegionOf(env!.db);
    const openings = await matchSavedSearchAgainstDb(
      env!.db,
      fixedSearch(from, to),
      dayjs().format("YYYY-MM-DD"),
      parkRegionOf,
    );
    const walkUpOpening = openings.find((x) => x.siteName === "Hike AM-1");
    expect(walkUpOpening).toBeUndefined();
  });

  it.skipIf(!hasDb)("honors parkPageIds scope — returns empty when park not in scope", async () => {
    const parkRegionOf = await buildParkRegionOf(env!.db);
    const scopedSearch: SavedSearch = {
      ...fixedSearch(from, to),
      scope: { region: null, parkPageIds: ["some-other-park"] },
    };
    const openings = await matchSavedSearchAgainstDb(
      env!.db,
      scopedSearch,
      dayjs().format("YYYY-MM-DD"),
      parkRegionOf,
    );
    const found = openings.find((x) => x.parkPageId === PARK);
    expect(found).toBeUndefined();
  });

  it.skipIf(!hasDb)("honors region scope — excludes park when region does not match", async () => {
    const parkRegionOf = await buildParkRegionOf(env!.db);
    // Test park is at lat 37.5, lon -122.0 → classifyRegion yields 'bay-area'
    // Requesting 'socal' should exclude it
    const scopedSearch: SavedSearch = {
      ...fixedSearch(from, to),
      scope: { region: "socal", parkPageIds: [] },
    };
    const openings = await matchSavedSearchAgainstDb(
      env!.db,
      scopedSearch,
      dayjs().format("YYYY-MM-DD"),
      parkRegionOf,
    );
    const found = openings.find((x) => x.parkPageId === PARK);
    expect(found).toBeUndefined();
  });

  it.skipIf(!hasDb)("region scope — includes park when region matches", async () => {
    const parkRegionOf = await buildParkRegionOf(env!.db);
    // Test park at lat 37.5, lon -122.0 → 'bay-area'
    const scopedSearch: SavedSearch = {
      ...fixedSearch(from, to),
      scope: { region: "bay-area", parkPageIds: [] },
    };
    const openings = await matchSavedSearchAgainstDb(
      env!.db,
      scopedSearch,
      dayjs().format("YYYY-MM-DD"),
      parkRegionOf,
    );
    const found = openings.find((x) => x.parkPageId === PARK);
    expect(found).toBeDefined();
  });
});
