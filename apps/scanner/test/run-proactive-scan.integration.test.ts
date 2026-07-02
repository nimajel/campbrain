import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import type { AvailabilityWindowEntry, ParkCatalogEntry } from "@campbrain/core";
import { runProactiveScan, type ScanProvider } from "../src/run-proactive-scan";

const DB_URL =
  process.env["DATABASE_URL"] ?? "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";

async function dbReachable(): Promise<boolean> {
  try {
    const s = postgres(DB_URL, { max: 1, onnotice: () => {}, connect_timeout: 2 });
    await s`SELECT 1`;
    await s.end();
    return true;
  } catch {
    return false;
  }
}

const RG_PROVIDER = "test-rg-proactive";
const RG_PARK = "rg-proactive-park";

function rgPark(): ParkCatalogEntry {
  return {
    provider: "recreation-gov",
    parkName: "RG Proactive Park",
    parkPageId: RG_PARK,
    campgrounds: [],
    defaultBookingRule: {
      type: "rolling_months_before",
      monthsBefore: 6,
      releaseTime: "08:00",
      timezone: "America/Los_Angeles",
      source: "known",
      confidence: "high",
    },
  };
}

function rgEntry(): AvailabilityWindowEntry {
  return {
    parkPageId: RG_PARK,
    parkName: "RG Proactive Park",
    windowStart: "2026-08-01",
    windowEnd: "2026-08-31",
    scannedAt: "2026-07-02T00:00:00Z",
    sourceUrl: "http://rg-x",
    campgrounds: [
      {
        id: "loop-a",
        name: "Loop A",
        nightlyFee: 30,
        bookingUrl: "http://b",
        sites: [{ name: "Site 1", dates: { "2026-08-05": "available" } }],
      },
    ],
  };
}

describe("runProactiveScan (recreation-gov provider_id integration)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let db: ReturnType<typeof drizzle> | null = null;

  beforeAll(async () => {
    if (!hasDb) return;
    client = postgres(DB_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });
    await client`INSERT INTO providers (provider_id, display_name) VALUES (${RG_PROVIDER}, 'RG Proactive Test') ON CONFLICT DO NOTHING`;
  });

  afterAll(async () => {
    if (!client) return;
    await client`DELETE FROM availability WHERE site_id IN (SELECT site_id FROM sites WHERE provider_id = ${RG_PROVIDER})`;
    await client`DELETE FROM sites WHERE provider_id = ${RG_PROVIDER}`;
    await client`DELETE FROM campgrounds WHERE provider_id = ${RG_PROVIDER}`;
    await client`DELETE FROM scan_windows WHERE provider_id = ${RG_PROVIDER}`;
    await client`DELETE FROM parks WHERE provider_id = ${RG_PROVIDER}`;
    await client`DELETE FROM providers WHERE provider_id = ${RG_PROVIDER}`;
    await client.end();
  });

  it.skipIf(!hasDb)("writes rows under a non-default providerId (real upsertEntry, refreshMv: false)", async () => {
    const provider: ScanProvider = {
      generateCacheWindows: () => [{ windowStart: rgEntry().windowStart, windowEnd: rgEntry().windowEnd }],
      proactiveScanWindow: async () => rgEntry(),
    };
    const summary = await runProactiveScan({
      db: db as never,
      parks: [rgPark()],
      provider,
      providerId: RG_PROVIDER,
      refreshMv: false,
      todayOverride: "2026-07-02",
    });
    expect(summary.cacheWrites).toBe(1);

    const parkRows = await client!`SELECT provider_id FROM parks WHERE provider_id = ${RG_PROVIDER} AND park_page_id = ${RG_PARK}`;
    expect(parkRows).toHaveLength(1);
    const swRows = await client!`SELECT provider_id FROM scan_windows WHERE provider_id = ${RG_PROVIDER} AND park_page_id = ${RG_PARK}`;
    expect(swRows).toHaveLength(1);
    const siteRows = await client!`SELECT site_name FROM sites WHERE provider_id = ${RG_PROVIDER} AND park_page_id = ${RG_PARK}`;
    expect(siteRows.map((r) => r["site_name"])).toEqual(["Site 1"]);
  });
});
