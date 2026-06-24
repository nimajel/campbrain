import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { appRouter } from "../src/trpc/router";
import type { TrpcContext } from "../src/trpc/context";
import type { TargetInput } from "@campbrain/types";

const URL = process.env["DATABASE_URL"] ?? "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";
async function dbReachable(): Promise<boolean> {
  try { const s = postgres(URL, { max: 1, onnotice: () => {}, connect_timeout: 2 }); await s`SELECT 1`; await s.end(); return true; } catch { return false; }
}
function stubSession(userId: string): TrpcContext["session"] {
  return { user: { id: userId } } as unknown as TrpcContext["session"];
}
function targetInput(name: string): TargetInput {
  return {
    userId: null,
    provider: "california-parks",
    name,
    scope: { parkPageId: null, parkName: "X", campgroundName: null },
    datePattern: { kind: "exact", date: "2099-08-01" },
    bookingRule: { monthsBefore: 6, releaseTime: "08:00", timezone: "America/Los_Angeles" },
    enabled: true,
    calendarEnabled: false,
  };
}

describe("targets router (integration, protected + scoped)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let db: ReturnType<typeof drizzle> | null = null;
  const callerFor = (userId: string | null) =>
    appRouter.createCaller({ db: db as never, auth: {} as never, session: userId ? stubSession(userId) : null });

  const USER_A = "targRouterA";
  const USER_B = "targRouterB";

  beforeAll(async () => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });
    await client`DELETE FROM targets WHERE user_id IN (${USER_A}, ${USER_B})`;
  });
  afterAll(async () => {
    if (client) {
      await client`DELETE FROM targets WHERE user_id IN (${USER_A}, ${USER_B})`;
      await client.end();
    }
  });

  it.skipIf(!hasDb)("rejects unauthenticated callers with UNAUTHORIZED", async () => {
    await expect(callerFor(null).targets.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(callerFor(null).targets.create(targetInput("x"))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.skipIf(!hasDb)("CRUD round-trip for the owner", async () => {
    const a = callerFor(USER_A);
    const created = await a.targets.create(targetInput("My target"));
    expect(created.userId).toBe(USER_A); // userId comes from the session, not input
    expect((await a.targets.list()).map((t) => t.name)).toContain("My target");
    const updated = await a.targets.update({ id: created.id, patch: { name: "Renamed" } });
    expect(updated.name).toBe("Renamed");
    await a.targets.setEnabled({ id: created.id, enabled: false });
    expect((await a.targets.list()).find((t) => t.id === created.id)?.enabled).toBe(false);
    await a.targets.delete({ id: created.id });
    expect((await a.targets.list()).some((t) => t.id === created.id)).toBe(false);
  });

  it.skipIf(!hasDb)("isolation: userB cannot touch userA's target", async () => {
    const a = callerFor(USER_A);
    const b = callerFor(USER_B);
    const created = await a.targets.create(targetInput("A only"));
    expect((await b.targets.list()).some((t) => t.id === created.id)).toBe(false);
    await expect(b.targets.update({ id: created.id, patch: { name: "hijack" } })).rejects.toThrow();
    await b.targets.delete({ id: created.id }); // no-op (cross-user delete is silent)
    expect((await a.targets.list()).find((t) => t.id === created.id)?.name).toBe("A only");
    await a.targets.delete({ id: created.id });
  });

  it.skipIf(!hasDb)("upcoming: returns future windows for enabled targets only", async () => {
    const a = callerFor(USER_A);
    const b = callerFor(USER_B);

    // date 2099-08-01 → bookingOpensAt = 2099-02-01T16:00:00.000Z (6 months before, 08:00 LA)
    const enabledTarget = await a.targets.create(targetInput("Far Future"));
    const disabledTarget = await a.targets.create({
      ...targetInput("Disabled Future"),
      enabled: false,
    });

    const upcoming = await a.targets.upcoming();

    // The enabled target with a far-future date should appear
    const match = upcoming.find((u) => u.targetId === enabledTarget.id);
    expect(match).toBeDefined();
    expect(match!.windows.length).toBeGreaterThan(0);
    // Every bookingOpensAt should be in the future
    for (const w of match!.windows) {
      expect(new Date(w.bookingOpensAt).getTime()).toBeGreaterThan(Date.now());
    }
    expect(match!.scopeLabel).toBe("X"); // parkName="X", campgroundName=null

    // Disabled target excluded
    expect(upcoming.some((u) => u.targetId === disabledTarget.id)).toBe(false);

    // userB upcoming doesn't include userA's targets
    const bUpcoming = await b.targets.upcoming();
    expect(bUpcoming.some((u) => u.targetId === enabledTarget.id)).toBe(false);

    // cleanup
    await a.targets.delete({ id: enabledTarget.id });
    await a.targets.delete({ id: disabledTarget.id });
  });
});
