import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, dbReachable } from "./helpers";
import {
  listTargets, getTarget, createTarget, updateTarget, deleteTarget, setTargetEnabled,
} from "../src/queries/targets";
import type { TargetInput } from "@campbrain/types";

const TEST_USER_ID = "test-targets-user";

function makeTargetInput(name: string): TargetInput {
  return {
    userId: null, // createTarget overrides with its userId arg
    provider: "california-parks",
    name,
    scope: { parkPageId: null, parkName: null, campgroundName: null },
    datePattern: { kind: "rolling_weekends", weeks: 4 },
    bookingRule: { monthsBefore: 6, releaseTime: "08:00", timezone: "America/Los_Angeles" },
    enabled: true,
    calendarEnabled: false,
  };
}

describe("targets table", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;

  beforeAll(() => {
    if (!hasDb) return;
    env = createTestDb();
  });

  afterAll(async () => {
    if (!env) return;
    await env.client`DELETE FROM targets WHERE user_id = ${TEST_USER_ID}`;
    await env.client.end();
  });

  it.skipIf(!hasDb)("inserts a targets row and reads back the name", async () => {
    const id = crypto.randomUUID();
    const definition = JSON.stringify({
      scope: { parkPageId: null, parkName: "X", campgroundName: null },
      datePattern: { kind: "exact", date: "2099-08-01" },
      bookingRule: {
        monthsBefore: 6,
        releaseTime: "08:00",
        timezone: "America/Los_Angeles",
      },
    });

    await env!.db.execute(
      sql`INSERT INTO targets (id, user_id, provider, name, definition)
          VALUES (${id}, ${TEST_USER_ID}, 'california-parks', 'Smoke Test Target', ${definition}::jsonb)`
    );

    const res = await env!.db.execute(
      sql`SELECT name FROM targets WHERE id = ${id}`
    );
    const rows = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    expect((rows[0] as { name: string }).name).toBe("Smoke Test Target");
  });
});

describe("targets store (integration, user-scoped)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    await env.client`DELETE FROM targets WHERE user_id IN ('targetsA','targetsB')`;
  });

  afterAll(async () => {
    if (!env) return;
    await env.client`DELETE FROM targets WHERE user_id IN ('targetsA','targetsB')`;
    await env.client.end();
  });

  it.skipIf(!hasDb)("create + list scopes to the owner", async () => {
    const db = env!.db as never;
    const a = await createTarget(db, "targetsA", makeTargetInput("A target"));
    expect(a.id).toBeTruthy();
    expect(a.userId).toBe("targetsA");

    await createTarget(db, "targetsB", makeTargetInput("B target"));

    const listA = await listTargets(db, "targetsA");
    expect(listA.map((t) => t.name)).toEqual(["A target"]);
  });

  it.skipIf(!hasDb)("get/update/delete enforce ownership (cross-user = not found)", async () => {
    const db = env!.db as never;
    const a = await createTarget(db, "targetsA", makeTargetInput("Owned by A"));

    // cross-user get → undefined
    expect(await getTarget(db, a.id, "targetsB")).toBeUndefined();

    // cross-user update → throws
    await expect(updateTarget(db, a.id, "targetsB", { name: "hijack" })).rejects.toThrow();

    // cross-user delete → no-op (A's row survives)
    await deleteTarget(db, a.id, "targetsB");
    expect((await getTarget(db, a.id, "targetsA"))?.name).toBe("Owned by A");

    // owner can update
    const upd = await updateTarget(db, a.id, "targetsA", { name: "renamed" });
    expect(upd.name).toBe("renamed");

    // owner can delete
    await deleteTarget(db, a.id, "targetsA");
    expect(await getTarget(db, a.id, "targetsA")).toBeUndefined();
  });

  it.skipIf(!hasDb)("setTargetEnabled flips only the owner's row", async () => {
    const db = env!.db as never;
    const a = await createTarget(db, "targetsA", makeTargetInput("toggle me"));

    // cross-user setEnabled → no-op
    await setTargetEnabled(db, a.id, "targetsB", false);
    expect((await getTarget(db, a.id, "targetsA"))?.enabled).toBe(true);

    // owner toggle
    await setTargetEnabled(db, a.id, "targetsA", false);
    expect((await getTarget(db, a.id, "targetsA"))?.enabled).toBe(false);

    await deleteTarget(db, a.id, "targetsA");
  });
});
