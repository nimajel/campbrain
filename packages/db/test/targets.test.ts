import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, dbReachable } from "./helpers";

const TEST_USER_ID = "test-targets-user";

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
