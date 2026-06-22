import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AvailabilityWindowEntry } from "@campbrain/core";
import { upsertEntry } from "../src/queries/upsert";
import { createTestDb, dbReachable } from "./helpers";

const PROVIDER = "test-1c";
const PARK = "upsert-park";

function makeEntry(dates: Record<string, "available" | "unavailable">): AvailabilityWindowEntry {
  return {
    parkPageId: PARK, parkName: "Upsert Park",
    windowStart: "2999-03-01", windowEnd: "2999-03-08",
    scannedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(), sourceUrl: "http://x",
    campgrounds: [{ id: "loop-a", name: "Loop A", nightlyFee: 35, bookingUrl: "http://b", sites: [
      { name: "Tent 1", dates },
      { name: "Hike/Bike 1", dates: { "2999-03-01": "available" } },
    ] }],
  };
}

describe("upsertEntry (integration)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  beforeAll(() => { if (hasDb) env = createTestDb(); });
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

  it.skipIf(!hasDb)("inserts park/campground/sites/availability with classification", async () => {
    await env!.client`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER}, 'Test') ON CONFLICT DO NOTHING`;
    await upsertEntry(env!.db as unknown as Parameters<typeof upsertEntry>[0], makeEntry({ "2999-03-01": "available", "2999-03-02": "available" }), PROVIDER);
    const avail = await env!.client`
      SELECT s.site_name, s.is_walk_up, a.date::text AS date, a.status
      FROM availability a JOIN sites s ON s.site_id = a.site_id
      WHERE s.provider_id = ${PROVIDER} ORDER BY s.site_name, a.date`;
    const tent = avail.filter((r) => r["site_name"] === "Tent 1");
    expect(tent.map((r) => r["date"])).toEqual(["2999-03-01", "2999-03-02"]);
    const hike = avail.find((r) => r["site_name"] === "Hike/Bike 1");
    expect(hike?.["is_walk_up"]).toBe(true);
  });

  it.skipIf(!hasDb)("replaces in-range availability on re-upsert", async () => {
    await upsertEntry(env!.db as unknown as Parameters<typeof upsertEntry>[0], makeEntry({ "2999-03-03": "available" }), PROVIDER);
    const tent = await env!.client`
      SELECT a.date::text AS date FROM availability a JOIN sites s ON s.site_id = a.site_id
      WHERE s.provider_id = ${PROVIDER} AND s.site_name = 'Tent 1' ORDER BY a.date`;
    expect(tent.map((r) => r["date"])).toEqual(["2999-03-03"]);
  });
});
