import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, dbReachable } from "./helpers";

const TEST_USER_ID = "test-calendar-user";

describe("calendar_connections table", async () => {
  const hasDb = await dbReachable();
  const env = hasDb ? createTestDb() : null;

  afterAll(async () => {
    if (!env) return;
    await env.client`DELETE FROM calendar_connections WHERE user_id = ${TEST_USER_ID}`;
    await env.client.end();
  });

  it.skipIf(!hasDb)("inserts a calendar_connections row and reads back refresh_token + provider_id", async () => {
    const id = crypto.randomUUID();

    await env!.db.execute(
      sql`INSERT INTO calendar_connections (id, user_id, provider_id, refresh_token)
          VALUES (${id}, ${TEST_USER_ID}, 'google', 'test-refresh-token-abc')`
    );

    const res = await env!.db.execute(
      sql`SELECT provider_id, refresh_token FROM calendar_connections WHERE id = ${id}`
    );
    const rows = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    const row = rows[0] as { provider_id: string; refresh_token: string };
    expect(row.provider_id).toBe("google");
    expect(row.refresh_token).toBe("test-refresh-token-abc");
  });
});
