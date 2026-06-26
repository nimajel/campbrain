import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, dbReachable } from "./helpers";
import {
  upsertConnection, getConnection, deleteConnection, getConnectionStatus,
  listCalendarSyncTargets, getSyncState, upsertSyncState,
} from "../src/queries/calendar";

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

// ─── per-user connection CRUD + isolation ────────────────────────────────────

describe("calendar connection store (integration, user-scoped)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;

  const USER_A = "cal-conn-userA";
  const USER_B = "cal-conn-userB";

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    await env.client`DELETE FROM calendar_connections WHERE user_id IN (${USER_A}, ${USER_B})`;
  });

  afterAll(async () => {
    if (!env) return;
    await env.client`DELETE FROM calendar_connections WHERE user_id IN (${USER_A}, ${USER_B})`;
    await env.client.end();
  });

  it.skipIf(!hasDb)("upsertConnection stores a connection and getConnection retrieves it", async () => {
    const db = env!.db as never;
    await upsertConnection(db, USER_A, {
      accessToken: "at-a", refreshToken: "rt-a",
      accessTokenExpiresAt: "2099-01-01T00:00:00.000Z", scope: "calendar",
    });
    const conn = await getConnection(db, USER_A);
    expect(conn).toBeDefined();
    expect(conn!.refreshToken).toBe("rt-a");
    expect(conn!.accessToken).toBe("at-a");
    expect(conn!.providerId).toBe("google");
    expect(conn!.userId).toBe(USER_A);
  });

  it.skipIf(!hasDb)("upsertConnection is idempotent — second upsert updates, no duplicate row", async () => {
    const db = env!.db as never;
    await upsertConnection(db, USER_A, {
      accessToken: "at-a-v2", refreshToken: "rt-a-v2",
      accessTokenExpiresAt: null, scope: "calendar.readonly",
    });
    const conn = await getConnection(db, USER_A);
    expect(conn!.refreshToken).toBe("rt-a-v2");
    expect(conn!.accessToken).toBe("at-a-v2");

    const res = await env!.client`SELECT COUNT(*)::int as n FROM calendar_connections WHERE user_id = ${USER_A}`;
    const countRow = res[0] as { n: number } | undefined;
    expect(countRow?.n).toBe(1);
  });

  it.skipIf(!hasDb)("user isolation — getConnection(userB) does not see userA's connection", async () => {
    const db = env!.db as never;
    await upsertConnection(db, USER_B, {
      accessToken: null, refreshToken: "rt-b",
      accessTokenExpiresAt: null, scope: null,
    });

    const connA = await getConnection(db, USER_A);
    const connB = await getConnection(db, USER_B);
    expect(connA!.refreshToken).toBe("rt-a-v2");
    expect(connB!.refreshToken).toBe("rt-b");
    // cross-user read returns undefined
    // (simulate by checking that getConnection scopes to userId)
    const rowsForA = await env!.client`SELECT * FROM calendar_connections WHERE user_id = ${USER_A} AND provider_id = 'google'`;
    expect(rowsForA).toHaveLength(1);
    const rowsForB = await env!.client`SELECT * FROM calendar_connections WHERE user_id = ${USER_B} AND provider_id = 'google'`;
    expect(rowsForB).toHaveLength(1);
    // a get with wrong userId returns nothing
    // (we have no cross-user API so verify via the raw count)
    const xUser = await getConnection(db, "non-existent-user");
    expect(xUser).toBeUndefined();
  });

  it.skipIf(!hasDb)("deleteConnection(userB) does not remove userA's row", async () => {
    const db = env!.db as never;
    await deleteConnection(db, USER_B);
    // B is gone
    expect(await getConnection(db, USER_B)).toBeUndefined();
    // A still exists
    expect(await getConnection(db, USER_A)).toBeDefined();
  });

  it.skipIf(!hasDb)("getConnectionStatus reflects presence per user", async () => {
    const db = env!.db as never;
    const statusA = await getConnectionStatus(db, USER_A);
    expect(statusA.connected).toBe(true);
    expect(statusA.connectedAt).toBeDefined();

    const statusB = await getConnectionStatus(db, USER_B);
    expect(statusB.connected).toBe(false);
    expect((statusB as { connectedAt?: string }).connectedAt).toBeUndefined();
  });
});

// ─── listCalendarSyncTargets join ────────────────────────────────────────────

describe("listCalendarSyncTargets (scanner query)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;

  const SYNC_USER = "cal-sync-targets-user";
  const SYNC_USER_NO_CONN = "cal-sync-no-conn-user";
  let targetId: string;
  let targetNoConnId: string;

  const definition = JSON.stringify({
    scope: { parkPageId: null, parkName: "Test Park", campgroundName: null },
    datePattern: { kind: "rolling_weekends", weeks: 4 },
    bookingRule: { monthsBefore: 6, releaseTime: "08:00", timezone: "America/Los_Angeles" },
  });

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    // clean up from any prior runs
    await env.client`DELETE FROM calendar_connections WHERE user_id IN (${SYNC_USER}, ${SYNC_USER_NO_CONN})`;
    await env.client`DELETE FROM targets WHERE user_id IN (${SYNC_USER}, ${SYNC_USER_NO_CONN})`;

    // Seed: target with calendar_enabled=true + enabled=true + connection (should appear)
    targetId = crypto.randomUUID();
    await env.client`INSERT INTO targets (id, user_id, provider, name, definition, enabled, calendar_enabled)
      VALUES (${targetId}, ${SYNC_USER}, 'california-parks', 'Cal Sync Target', ${definition}::jsonb, true, true)`;

    await env.client`INSERT INTO calendar_connections (id, user_id, provider_id, refresh_token)
      VALUES (${crypto.randomUUID()}, ${SYNC_USER}, 'google', 'rt-sync-user')`;

    // Seed: target with calendar_enabled=true but NO connection (should NOT appear)
    targetNoConnId = crypto.randomUUID();
    await env.client`INSERT INTO targets (id, user_id, provider, name, definition, enabled, calendar_enabled)
      VALUES (${targetNoConnId}, ${SYNC_USER_NO_CONN}, 'california-parks', 'No Conn Target', ${definition}::jsonb, true, true)`;
  });

  afterAll(async () => {
    if (!env) return;
    await env.client`DELETE FROM calendar_connections WHERE user_id IN (${SYNC_USER}, ${SYNC_USER_NO_CONN})`;
    await env.client`DELETE FROM targets WHERE user_id IN (${SYNC_USER}, ${SYNC_USER_NO_CONN})`;
    await env.client.end();
  });

  it.skipIf(!hasDb)("returns targets joined to their google connection", async () => {
    const db = env!.db as never;
    const results = await listCalendarSyncTargets(db);
    const mine = results.filter((r) => r.userId === SYNC_USER);
    expect(mine).toHaveLength(1);
    const first = mine[0];
    expect(first?.refreshToken).toBe("rt-sync-user");
    expect(first?.target.id).toBe(targetId);
    expect(first?.target.name).toBe("Cal Sync Target");
    expect(first?.target.calendarEnabled).toBe(true);
    expect(first?.target.enabled).toBe(true);
  });

  it.skipIf(!hasDb)("user WITHOUT a connection does NOT appear in listCalendarSyncTargets", async () => {
    const db = env!.db as never;
    const results = await listCalendarSyncTargets(db);
    const noConn = results.filter((r) => r.userId === SYNC_USER_NO_CONN);
    expect(noConn).toHaveLength(0);
  });

  it.skipIf(!hasDb)("a connection without a calendar_enabled target does NOT appear", async () => {
    const db = env!.db as never;
    // Seed a connection for SYNC_USER_NO_CONN but leave their target as-is (already has calendar_enabled=true)
    // Instead create a user with connection but target.calendar_enabled=false
    const USER_NO_CAL = "cal-no-cal-enabled-user";
    await env!.client`DELETE FROM calendar_connections WHERE user_id = ${USER_NO_CAL}`;
    await env!.client`DELETE FROM targets WHERE user_id = ${USER_NO_CAL}`;

    const tId = crypto.randomUUID();
    await env!.client`INSERT INTO targets (id, user_id, provider, name, definition, enabled, calendar_enabled)
      VALUES (${tId}, ${USER_NO_CAL}, 'california-parks', 'No Cal Target', ${definition}::jsonb, true, false)`;
    await env!.client`INSERT INTO calendar_connections (id, user_id, provider_id, refresh_token)
      VALUES (${crypto.randomUUID()}, ${USER_NO_CAL}, 'google', 'rt-no-cal')`;

    const results = await listCalendarSyncTargets(db);
    const noCal = results.filter((r) => r.userId === USER_NO_CAL);
    expect(noCal).toHaveLength(0);

    await env!.client`DELETE FROM calendar_connections WHERE user_id = ${USER_NO_CAL}`;
    await env!.client`DELETE FROM targets WHERE user_id = ${USER_NO_CAL}`;
  });
});

// ─── sync state CRUD + isolation ─────────────────────────────────────────────

describe("calendar sync-state store (integration, user-scoped)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;

  const SS_USER_A = "cal-ss-userA";
  const SS_USER_B = "cal-ss-userB";
  let targetAId: string;
  let targetBId: string;

  const definition = JSON.stringify({
    scope: { parkPageId: null, parkName: "Sync Park", campgroundName: null },
    datePattern: { kind: "exact", date: "2099-09-01" },
    bookingRule: { monthsBefore: 6, releaseTime: "08:00", timezone: "America/Los_Angeles" },
  });

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    await env.client`DELETE FROM calendar_sync_state WHERE user_id IN (${SS_USER_A}, ${SS_USER_B})`;
    await env.client`DELETE FROM targets WHERE user_id IN (${SS_USER_A}, ${SS_USER_B})`;

    targetAId = crypto.randomUUID();
    targetBId = crypto.randomUUID();
    await env.client`INSERT INTO targets (id, user_id, provider, name, definition)
      VALUES (${targetAId}, ${SS_USER_A}, 'california-parks', 'SS Target A', ${definition}::jsonb)`;
    await env.client`INSERT INTO targets (id, user_id, provider, name, definition)
      VALUES (${targetBId}, ${SS_USER_B}, 'california-parks', 'SS Target B', ${definition}::jsonb)`;
  });

  afterAll(async () => {
    if (!env) return;
    await env.client`DELETE FROM calendar_sync_state WHERE user_id IN (${SS_USER_A}, ${SS_USER_B})`;
    await env.client`DELETE FROM targets WHERE user_id IN (${SS_USER_A}, ${SS_USER_B})`;
    await env.client.end();
  });

  it.skipIf(!hasDb)("upsertSyncState then getSyncState returns the record by key", async () => {
    const db = env!.db as never;
    const rec = {
      key: `ss:${targetAId}|2099-09-01`,
      googleEventId: "gev-abc",
      summary: "Test booking window",
      startTimeIso: "2099-09-01T15:00:00.000Z",
    };
    await upsertSyncState(db, SS_USER_A, targetAId, rec);
    const map = await getSyncState(db, SS_USER_A, [rec.key]);
    expect(map.has(rec.key)).toBe(true);
    const entry = map.get(rec.key)!;
    expect(entry.googleEventId).toBe("gev-abc");
    expect(entry.summary).toBe("Test booking window");
    expect(entry.startTimeIso).toBe("2099-09-01T15:00:00.000Z");
  });

  it.skipIf(!hasDb)("getSyncState with empty keys returns empty Map without querying", async () => {
    const db = env!.db as never;
    const map = await getSyncState(db, SS_USER_A, []);
    expect(map.size).toBe(0);
  });

  it.skipIf(!hasDb)("cross-user getSyncState does not see the other user's record", async () => {
    const db = env!.db as never;
    const key = `ss:${targetAId}|2099-09-01`;
    const map = await getSyncState(db, SS_USER_B, [key]);
    expect(map.has(key)).toBe(false);
  });

  it.skipIf(!hasDb)("re-upsert updates the existing record (idempotent)", async () => {
    const db = env!.db as never;
    const key = `ss:${targetAId}|2099-09-01`;
    await upsertSyncState(db, SS_USER_A, targetAId, {
      key,
      googleEventId: "gev-updated",
      summary: "Updated summary",
      startTimeIso: "2099-09-01T16:00:00.000Z",
    });
    const map = await getSyncState(db, SS_USER_A, [key]);
    const entry = map.get(key)!;
    expect(entry.googleEventId).toBe("gev-updated");
    expect(entry.summary).toBe("Updated summary");

    // only one row (no duplicate)
    const rawRows = await env!.client`SELECT COUNT(*)::int as n FROM calendar_sync_state WHERE user_id = ${SS_USER_A} AND key = ${key}`;
    const ssCountRow = rawRows[0] as { n: number } | undefined;
    expect(ssCountRow?.n).toBe(1);
  });

  it.skipIf(!hasDb)("getSyncState returns multiple keys when requested", async () => {
    const db = env!.db as never;
    const keyA = `ss:${targetAId}|2099-09-01`;
    const keyB = `ss:${targetAId}|2099-09-08`;
    await upsertSyncState(db, SS_USER_A, targetAId, {
      key: keyB,
      googleEventId: "gev-b",
      summary: "Second window",
      startTimeIso: "2099-09-08T15:00:00.000Z",
    });
    const map = await getSyncState(db, SS_USER_A, [keyA, keyB]);
    expect(map.size).toBe(2);
    expect(map.get(keyA)!.googleEventId).toBe("gev-updated");
    expect(map.get(keyB)!.googleEventId).toBe("gev-b");
  });
});
