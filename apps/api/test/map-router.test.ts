import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { appRouter } from "../src/trpc/router";

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

describe("map router (integration)", async () => {
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
});
