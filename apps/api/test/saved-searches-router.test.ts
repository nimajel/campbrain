import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { appRouter } from "../src/trpc/router";
import type { TrpcContext } from "../src/trpc/context";
import type { SavedSearchInput } from "@campbrain/types";

const URL = process.env["DATABASE_URL"] ?? "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";
async function dbReachable(): Promise<boolean> {
  try { const s = postgres(URL, { max: 1, onnotice: () => {}, connect_timeout: 2 }); await s`SELECT 1`; await s.end(); return true; } catch { return false; }
}
function stubSession(userId: string): TrpcContext["session"] {
  return { user: { id: userId } } as unknown as TrpcContext["session"];
}
function input(name: string): SavedSearchInput {
  return {
    userId: null, provider: "california-parks", name,
    scope: { region: null, parkPageIds: [] },
    datePattern: { kind: "fixed_range", from: "2026-08-01", to: "2026-08-03" },
    filters: { access: [], kinds: [], hide: [], minNights: 1 },
    alertEnabled: false, emailEnabled: true,
  };
}

describe("savedSearches router (integration, protected + scoped)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let db: ReturnType<typeof drizzle> | null = null;
  const callerFor = (userId: string | null) =>
    appRouter.createCaller({ db: db as never, auth: {} as never, session: userId ? stubSession(userId) : null });

  // Use router-specific user IDs to avoid parallel-run collision with saved-searches-store.test.ts
  const USER_A = "routerTestA";
  const USER_B = "routerTestB";

  beforeAll(async () => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });
    await client`DELETE FROM saved_searches WHERE user_id IN (${USER_A}, ${USER_B})`;
  });
  afterAll(async () => {
    if (client) { await client`DELETE FROM saved_searches WHERE user_id IN (${USER_A}, ${USER_B})`; await client.end(); }
  });

  it.skipIf(!hasDb)("rejects unauthenticated callers with UNAUTHORIZED", async () => {
    await expect(callerFor(null).savedSearches.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(callerFor(null).savedSearches.create(input("x"))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.skipIf(!hasDb)("CRUD round-trip for the owner", async () => {
    const a = callerFor(USER_A);
    const created = await a.savedSearches.create(input("My search"));
    expect(created.userId).toBe(USER_A); // userId comes from the session, not input
    expect((await a.savedSearches.list()).map((s) => s.name)).toContain("My search");
    const updated = await a.savedSearches.update({ id: created.id, patch: { name: "Renamed" } });
    expect(updated.name).toBe("Renamed");
    await a.savedSearches.toggleAlert({ id: created.id, enabled: true });
    expect((await a.savedSearches.list()).find((s) => s.id === created.id)?.alertEnabled).toBe(true);
    await a.savedSearches.delete({ id: created.id });
    expect((await a.savedSearches.list()).some((s) => s.id === created.id)).toBe(false);
  });

  it.skipIf(!hasDb)("isolation: userB cannot touch userA's search", async () => {
    const a = callerFor(USER_A);
    const b = callerFor(USER_B);
    const created = await a.savedSearches.create(input("A only"));
    expect((await b.savedSearches.list()).some((s) => s.id === created.id)).toBe(false);
    await expect(b.savedSearches.update({ id: created.id, patch: { name: "hijack" } })).rejects.toThrow();
    await b.savedSearches.delete({ id: created.id }); // no-op
    expect((await a.savedSearches.list()).find((s) => s.id === created.id)?.name).toBe("A only");
    await a.savedSearches.delete({ id: created.id });
  });
});
