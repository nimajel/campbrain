import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildEntriesFromRows, getEntriesForParks, type EntryRow } from "../src/queries/entries";
import { createTestDb, dbReachable } from "./helpers";

describe("buildEntriesFromRows (pure)", () => {
  it("nests park → campground → site → dates and ignores null fan-out rows", () => {
    const base = {
      park_page_id: "p1", park_name: "Park One",
      window_start: "2026-07-01", window_end: "2026-07-08",
      scanned_at: "2026-06-20T00:00:00Z", source_url: "http://x",
    };
    const testRows: EntryRow[] = [
      { ...base, cg_name: "Loop A", cg_id: "loop-a", nightly_fee: "35.00", booking_url: "http://b",
        site_id: 1, site_name: "Site 1", avail_date: "2026-07-01", status: "available" },
      { ...base, cg_name: "Loop A", cg_id: "loop-a", nightly_fee: "35.00", booking_url: "http://b",
        site_id: 1, site_name: "Site 1", avail_date: "2026-07-02", status: "available" },
      { ...base, cg_name: null, cg_id: null, nightly_fee: null, booking_url: null,
        site_id: null, site_name: null, avail_date: null, status: null },
    ];
    const entries = buildEntriesFromRows(testRows);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.campgrounds[0]!.nightlyFee).toBe(35);
    expect(entries[0]!.campgrounds[0]!.sites[0]!.dates).toEqual({
      "2026-07-01": "available", "2026-07-02": "available",
    });
  });
});

describe("getEntriesForParks (integration)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  const PROVIDER = "test-1b";
  const PARK = "test-park-entries";

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    const sql = env.client;
    await sql`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER}, 'Test') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO parks (provider_id, park_page_id, park_name) VALUES (${PROVIDER}, ${PARK}, 'Test Park') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO scan_windows (provider_id, park_page_id, window_start, window_end, scanned_at, source_url)
      VALUES (${PROVIDER}, ${PARK}, '2999-01-01', '2999-01-08', NOW(), 'http://x') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id, nightly_fee, booking_url)
      VALUES (${PROVIDER}, ${PARK}, 'Loop A', 'loop-a', 35.00, 'http://b') ON CONFLICT DO NOTHING`;
    const [site] = await sql`INSERT INTO sites (provider_id, park_page_id, campground_name, site_name)
      VALUES (${PROVIDER}, ${PARK}, 'Loop A', 'Site 1')
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET site_name = EXCLUDED.site_name
      RETURNING site_id`;
    await sql`INSERT INTO availability (site_id, date, status) VALUES (${site!.site_id}, '2999-01-02', 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
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

  it.skipIf(!hasDb)("returns the seeded park's window with the available date", async () => {
    const entries = await getEntriesForParks(env!.db, [PARK], PROVIDER);
    expect(entries).toHaveLength(1);
    const site = entries[0]!.campgrounds[0]!.sites[0]!;
    expect(site.name).toBe("Site 1");
    expect(site.dates["2999-01-02"]).toBe("available");
  });
});
