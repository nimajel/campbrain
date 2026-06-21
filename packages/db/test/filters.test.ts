import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { pgEnumArray, buildAvailabilityClauses } from "../src/queries/filters";
import { createTestDb, dbReachable } from "./helpers";
import { rows } from "../src/queries/exec";

describe("pgEnumArray", () => {
  it("returns null for empty/undefined", () => {
    expect(pgEnumArray(undefined, ["a"])).toBeNull();
    expect(pgEnumArray([], ["a"])).toBeNull();
  });
  it("drops values not in the allowed set", () => {
    expect(pgEnumArray(["drive_in", "evil"], ["drive_in", "hike_in"])).toEqual(["drive_in"]);
  });
  it("returns null when nothing survives validation", () => {
    expect(pgEnumArray(["evil"], ["drive_in"])).toBeNull();
  });
});

describe("buildAvailabilityClauses", () => {
  it("includes the three base predicates by default", () => {
    const r = buildAvailabilityClauses({});
    expect(r.conds.length).toBe(3);
    expect(r.dowConds.length).toBe(0);
    expect(r.excludeWalkUp).toBe(false);
    expect(r.minNights).toBeUndefined();
  });
  it("adds from/to/access/kind predicates and the weekend DOW clause", () => {
    const r = buildAvailabilityClauses({
      from: "2026-07-01", to: "2026-07-31",
      access: ["hike_in"], kinds: ["tent"], weekendsOnly: true,
    });
    expect(r.conds.length).toBe(7);
    expect(r.dowConds.length).toBe(1);
  });
  it("sets excludeWalkUp for hide=walk_up and passes minNights through", () => {
    const r = buildAvailabilityClauses({ hide: ["walk_up"], minNights: 2 });
    expect(r.excludeWalkUp).toBe(true);
    expect(r.minNights).toBe(2);
    expect(r.conds.length).toBe(3);
  });
});

describe("buildAvailabilityClauses – DB integration (access filter SQL)", () => {
  const PROVIDER_ID = "test-1b-filters";
  let dbHandle: ReturnType<typeof createTestDb>;
  let reachable = false;

  beforeAll(async () => {
    reachable = await dbReachable();
    if (!reachable) return;

    dbHandle = createTestDb();
    const { client } = dbHandle;

    await client`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER_ID}, 'Filter Integration Test') ON CONFLICT DO NOTHING`;
    await client`INSERT INTO parks (provider_id, park_page_id, park_name) VALUES (${PROVIDER_ID}, 'p1', 'Test Park') ON CONFLICT DO NOTHING`;
    await client`INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id) VALUES (${PROVIDER_ID}, 'p1', 'CG1', 'cg1') ON CONFLICT DO NOTHING`;

    // Two sites: one hike_in, one drive_in
    await client`INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, access) VALUES (${PROVIDER_ID}, 'p1', 'CG1', 'Site-Hike', 'hike_in') ON CONFLICT DO NOTHING`;
    await client`INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, access) VALUES (${PROVIDER_ID}, 'p1', 'CG1', 'Site-Drive', 'drive_in') ON CONFLICT DO NOTHING`;

    const hikeRows = await client<{ site_id: number }[]>`SELECT site_id FROM sites WHERE provider_id = ${PROVIDER_ID} AND site_name = 'Site-Hike'`;
    const driveRows = await client<{ site_id: number }[]>`SELECT site_id FROM sites WHERE provider_id = ${PROVIDER_ID} AND site_name = 'Site-Drive'`;
    const hikeId = hikeRows[0]!.site_id;
    const driveId = driveRows[0]!.site_id;

    // Far-future dates to satisfy `a.date >= CURRENT_DATE`
    await client`INSERT INTO availability (site_id, date, status) VALUES (${hikeId}, '2999-07-01', 'available'), (${driveId}, '2999-07-01', 'available') ON CONFLICT DO NOTHING`;
  });

  afterAll(async () => {
    if (!reachable || !dbHandle) return;
    const { client } = dbHandle;
    const siteRows = await client`SELECT site_id FROM sites WHERE provider_id = ${PROVIDER_ID}`;
    for (const { site_id } of siteRows) {
      await client`DELETE FROM availability WHERE site_id = ${site_id}`;
    }
    await client`DELETE FROM sites WHERE provider_id = ${PROVIDER_ID}`;
    await client`DELETE FROM campgrounds WHERE provider_id = ${PROVIDER_ID}`;
    await client`DELETE FROM parks WHERE provider_id = ${PROVIDER_ID}`;
    await client`DELETE FROM providers WHERE provider_id = ${PROVIDER_ID}`;
    await dbHandle.client.end({ timeout: 1 }).catch(() => {});
  });

  it("access filter generates valid SQL and returns only matching sites", async () => {
    if (!reachable) {
      console.log("DB not reachable — skipping integration test");
      return;
    }
    const { db } = dbHandle;
    const { conds } = buildAvailabilityClauses({ access: ["hike_in"] });
    const query = sql`
      SELECT s.site_name, s.access
      FROM availability a
      JOIN sites s ON s.site_id = a.site_id
      WHERE s.provider_id = ${PROVIDER_ID}
        AND ${sql.join(conds, sql` AND `)}
    `;
    const result = await rows<{ site_name: string; access: string }>(db, query);
    const names = result.map((r) => r.site_name);
    expect(names).toContain("Site-Hike");
    expect(names).not.toContain("Site-Drive");
  });
});
