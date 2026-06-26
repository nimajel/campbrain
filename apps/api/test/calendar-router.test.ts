import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { appRouter } from "../src/trpc/router";
import type { TrpcContext } from "../src/trpc/context";

const URL = process.env["DATABASE_URL"] ?? "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";

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

function stubSession(userId: string): TrpcContext["session"] {
  return { user: { id: userId } } as unknown as TrpcContext["session"];
}

describe("calendar router (integration, protected + scoped)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let db: ReturnType<typeof drizzle> | null = null;

  const callerFor = (userId: string | null) =>
    appRouter.createCaller({
      db: db as never,
      auth: {} as never,
      session: userId ? stubSession(userId) : null,
    });

  const USER_A = "calRouterTestA";
  const USER_B = "calRouterTestB";

  beforeAll(async () => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });
    // Clean up any leftover rows from previous runs
    await client`DELETE FROM calendar_connections WHERE user_id IN (${USER_A}, ${USER_B})`;
  });

  afterAll(async () => {
    if (client) {
      await client`DELETE FROM calendar_connections WHERE user_id IN (${USER_A}, ${USER_B})`;
      await client.end();
    }
  });

  it.skipIf(!hasDb)("status rejects unauthenticated with UNAUTHORIZED", async () => {
    await expect(callerFor(null).calendar.status()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.skipIf(!hasDb)("disconnect rejects unauthenticated with UNAUTHORIZED", async () => {
    await expect(callerFor(null).calendar.disconnect()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.skipIf(!hasDb)("status returns {connected:false} for a fresh user with no connection", async () => {
    const result = await callerFor(USER_A).calendar.status();
    expect(result).toEqual({ connected: false });
  });

  it.skipIf(!hasDb)("status returns {connected:true, connectedAt} after seeding a connection row", async () => {
    if (!client) return;
    // Seed a calendar_connections row directly (simulating the OAuth callback)
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await client`
      INSERT INTO calendar_connections
        (id, user_id, provider_id, access_token, refresh_token,
         access_token_expires_at, scope, connected_at, updated_at)
      VALUES
        (${id}, ${USER_A}, 'google', 'acc_tok', 'ref_tok',
         ${now}::timestamptz, 'https://www.googleapis.com/auth/calendar.events',
         ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT (user_id, provider_id) DO UPDATE SET updated_at = now()
    `;

    const result = await callerFor(USER_A).calendar.status();
    expect(result.connected).toBe(true);
    expect(result.connectedAt).toBeDefined();
    // Refresh token must NOT appear in the status response
    expect(JSON.stringify(result)).not.toContain("ref_tok");
  });

  it.skipIf(!hasDb)("disconnect removes the connection row", async () => {
    // USER_A should still have the row from the previous test
    const before = await callerFor(USER_A).calendar.status();
    expect(before.connected).toBe(true);

    const result = await callerFor(USER_A).calendar.disconnect();
    expect(result).toEqual({ connected: false });

    const after = await callerFor(USER_A).calendar.status();
    expect(after).toEqual({ connected: false });
  });

  it.skipIf(!hasDb)("disconnect is a no-op for a user with no connection (does not throw)", async () => {
    // USER_B has no connection at all
    await expect(callerFor(USER_B).calendar.disconnect()).resolves.toEqual({ connected: false });
  });

  it.skipIf(!hasDb)("disconnect is user-scoped: USER_B disconnect does not affect USER_A", async () => {
    if (!client) return;
    // Re-seed USER_A connection
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await client`
      INSERT INTO calendar_connections
        (id, user_id, provider_id, access_token, refresh_token,
         access_token_expires_at, scope, connected_at, updated_at)
      VALUES
        (${id}, ${USER_A}, 'google', 'acc_tok2', 'ref_tok2',
         ${now}::timestamptz, null, ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT (user_id, provider_id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        updated_at = now()
    `;

    // USER_B disconnects — should be a no-op since USER_B has no connection
    await callerFor(USER_B).calendar.disconnect();

    // USER_A's connection should still be present
    const statusA = await callerFor(USER_A).calendar.status();
    expect(statusA.connected).toBe(true);
  });
});
