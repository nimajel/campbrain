import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { appRouter } from "../src/trpc/router";
import type { TrpcContext } from "../src/trpc/context";

const URL = process.env["DATABASE_URL"] ?? "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";
async function dbReachable(): Promise<boolean> {
  try { const s = postgres(URL, { max: 1, onnotice: () => {}, connect_timeout: 2 }); await s`SELECT 1`; await s.end(); return true; } catch { return false; }
}
const stub = (id: string) => ({ user: { id } } as unknown as TrpcContext["session"]);

describe("dashboard router (integration)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let db: ReturnType<typeof drizzle> | null = null;
  const callerFor = (id: string | null) => appRouter.createCaller({ db: db as never, auth: {} as never, session: id ? stub(id) : null });
  beforeAll(() => { if (!hasDb) return; client = postgres(URL, { max: 1, onnotice: () => {} }); db = drizzle(client, { schema }); });
  afterAll(async () => { if (client) await client.end(); });

  it.skipIf(!hasDb)("rejects unauthenticated", async () => {
    await expect(callerFor(null).dashboard.stats()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it.skipIf(!hasDb)("returns zeroed stats + empty openings for a user with no data", async () => {
    const c = callerFor("dash-empty-user");
    expect(await c.dashboard.stats()).toEqual({ activeAlerts: 0, currentMatches: 0, totalHits: 0 });
    expect(await c.dashboard.recentOpenings()).toEqual([]);
    expect(await c.dashboard.lastScan()).not.toBeUndefined(); // null or {finishedAt}
  });
});
