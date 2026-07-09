import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getEntriesForParks } from "../src/queries/entries";
import { createTestDb, dbReachable } from "./helpers";

describe("getEntriesForParks (integration)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  const PROVIDER = "test-1b";
  const PARK = "test-park-entries";
  const EMPTY_PARK = "test-park-entries-empty";

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    const sql = env.client;
    await sql`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER}, 'Test') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO parks (provider_id, park_page_id, park_name) VALUES (${PROVIDER}, ${PARK}, 'Test Park') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO parks (provider_id, park_page_id, park_name) VALUES (${PROVIDER}, ${EMPTY_PARK}, 'Empty Park') ON CONFLICT DO NOTHING`;
    // Two OVERLAPPING windows (the daily-shifted lattice the scanner accumulates).
    // The read path must dedupe these — one entry per park, each date shipped once.
    await sql`INSERT INTO scan_windows (provider_id, park_page_id, window_start, window_end, scanned_at, source_url)
      VALUES (${PROVIDER}, ${PARK}, '2999-01-01', '2999-01-08', '2026-06-20T00:00:00Z', 'http://x') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO scan_windows (provider_id, park_page_id, window_start, window_end, scanned_at, source_url)
      VALUES (${PROVIDER}, ${PARK}, '2999-01-02', '2999-01-09', '2026-06-21T00:00:00Z', 'http://y') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO scan_windows (provider_id, park_page_id, window_start, window_end, scanned_at, source_url)
      VALUES (${PROVIDER}, ${EMPTY_PARK}, '2999-01-01', '2999-01-08', '2026-06-20T00:00:00Z', 'http://z') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id, nightly_fee, booking_url)
      VALUES (${PROVIDER}, ${PARK}, 'Loop A', 'loop-a', 35.00, 'http://b') ON CONFLICT DO NOTHING`;
    const [site] = await sql`INSERT INTO sites (provider_id, park_page_id, campground_name, site_name)
      VALUES (${PROVIDER}, ${PARK}, 'Loop A', 'Site 1')
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET site_name = EXCLUDED.site_name
      RETURNING site_id`;
    await sql`INSERT INTO availability (site_id, date, status) VALUES (${site!.site_id}, '2999-01-02', 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
    await sql`INSERT INTO availability (site_id, date, status) VALUES (${site!.site_id}, '2999-01-03', 'available')
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

  it.skipIf(!hasDb)("returns ONE deduped entry per park despite overlapping windows", async () => {
    const entries = await getEntriesForParks(env!.db, [PARK], PROVIDER);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.parkName).toBe("Test Park");
    // asOf semantics: the freshest window's scanned_at
    expect(entry.scannedAt).toContain("2026-06-21");
    expect(entry.campgrounds).toHaveLength(1);
    const cg = entry.campgrounds[0]!;
    expect(cg.nightlyFee).toBe(35);
    expect(cg.bookingUrl).toBe("http://b");
    expect(cg.sites).toHaveLength(1);
    const site = cg.sites[0]!;
    expect(site.name).toBe("Site 1");
    // each available date exactly once, despite living inside both windows
    expect(site.dates).toEqual({
      "2999-01-02": "available",
      "2999-01-03": "available",
    });
  });

  it.skipIf(!hasDb)("park with scan coverage but no availability still returns park meta", async () => {
    const entries = await getEntriesForParks(env!.db, [EMPTY_PARK], PROVIDER);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.parkName).toBe("Empty Park");
    expect(entries[0]!.campgrounds).toEqual([]);
  });

  it.skipIf(!hasDb)("unknown park returns no entries", async () => {
    const entries = await getEntriesForParks(env!.db, ["no-such-park"], PROVIDER);
    expect(entries).toEqual([]);
  });
});
