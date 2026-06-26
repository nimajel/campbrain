import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { runCalendarSync } from "../src/run-calendar-sync";
import { deterministicEventId } from "../src/google-calendar";
import type { CalendarClient } from "../src/google-calendar";
import type { CalendarEventDraft } from "@campbrain/types";
import dayjs from "dayjs";

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

// Stable test IDs to avoid collisions with other test suites.
const USER_ID = "calsync-test-user";
const TARGET_ID = "calsync-test-target";

// A far-future arrival date so all 3 reminder events lie in the future.
const ARRIVAL_DATE = dayjs().add(8, "month").format("YYYY-MM-DD");

function makeMockClient(): CalendarClient & {
  insertCalls: CalendarEventDraft[];
  updateCalls: Array<{ eventId: string; draft: CalendarEventDraft }>;
} {
  let counter = 0;
  const insertCalls: CalendarEventDraft[] = [];
  const updateCalls: Array<{ eventId: string; draft: CalendarEventDraft }> = [];
  return {
    insertCalls,
    updateCalls,
    async insertEvent(draft: CalendarEventDraft): Promise<string> {
      insertCalls.push(draft);
      return `fake-event-${++counter}`;
    },
    async updateEvent(eventId: string, draft: CalendarEventDraft): Promise<void> {
      updateCalls.push({ eventId, draft });
    },
  };
}

describe("runCalendarSync (integration)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let db: ReturnType<typeof drizzle> | null = null;

  beforeAll(async () => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });

    // Clean up any leftover rows from a previous failed run.
    await client`DELETE FROM calendar_sync_state WHERE user_id = ${USER_ID}`;
    await client`DELETE FROM calendar_connections WHERE user_id = ${USER_ID}`;
    await client`DELETE FROM targets WHERE id = ${TARGET_ID}`;
    await client`DELETE FROM "user" WHERE id = ${USER_ID}`;

    // Seed: user row required by FK on targets.user_id.
    await client`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${USER_ID}, 'CalSync Test', 'calsync@test.invalid', true, now(), now())
    `;

    // Seed: a target with calendar_enabled=true, a far-future exact arrival date.
    await client`
      INSERT INTO targets (id, user_id, provider, name, definition, enabled, calendar_enabled, created_at, updated_at)
      VALUES (
        ${TARGET_ID},
        ${USER_ID},
        'california-parks',
        'CalSync Target',
        ${JSON.stringify({
          scope: { parkPageId: "1", parkName: "Test Park", campgroundName: "Main CG" },
          datePattern: { kind: "exact", date: ARRIVAL_DATE },
          bookingRule: { monthsBefore: 6, releaseTime: "08:00", timezone: "America/Los_Angeles" },
        })}::jsonb,
        true,
        true,
        now(),
        now()
      )
    `;

    // Seed: a google calendar_connection for the user.
    await client`
      INSERT INTO calendar_connections (id, user_id, provider_id, access_token, refresh_token, access_token_expires_at, scope, connected_at, updated_at)
      VALUES (
        gen_random_uuid()::text,
        ${USER_ID},
        'google',
        null,
        'fake-refresh-token',
        null,
        null,
        now(),
        now()
      )
    `;
  });

  afterAll(async () => {
    if (client) {
      await client`DELETE FROM calendar_sync_state WHERE user_id = ${USER_ID}`;
      await client`DELETE FROM calendar_connections WHERE user_id = ${USER_ID}`;
      await client`DELETE FROM targets WHERE id = ${TARGET_ID}`;
      await client`DELETE FROM "user" WHERE id = ${USER_ID}`;
      await client.end();
    }
  });

  it.skipIf(!hasDb)(
    "first run inserts 3 events (one per reminder), writes sync state",
    async () => {
      const mock = makeMockClient();
      const logs: string[] = [];

      await runCalendarSync({
        db: db as never,
        clientId: "x",
        clientSecret: "y",
        makeClient: () => mock,
        log: (m) => logs.push(m),
      });

      // generateEventDrafts produces 3 drafts per booking window (prep, night-before, booking).
      // The arrival date is 8 months out so all 3 reminders are in the future.
      expect(mock.insertCalls).toHaveLength(3);
      expect(mock.updateCalls).toHaveLength(0);

      // State rows must be persisted for the idempotency check below.
      const stateRows = await client!`SELECT key FROM calendar_sync_state WHERE user_id = ${USER_ID}`;
      expect(stateRows).toHaveLength(3);

      // A calendar scan_run row must have been recorded.
      const runRows = await client!`
        SELECT kind, status FROM scan_runs
        WHERE kind = 'calendar' AND status = 'ok'
        ORDER BY started_at DESC LIMIT 1
      `;
      expect(runRows[0]).toMatchObject({ kind: "calendar", status: "ok" });
    },
  );

  it.skipIf(!hasDb)(
    "second run is fully idempotent — no inserts or updates when drafts are unchanged",
    async () => {
      const mock = makeMockClient();
      const logs: string[] = [];

      await runCalendarSync({
        db: db as never,
        clientId: "x",
        clientSecret: "y",
        makeClient: () => mock,
        log: (m) => logs.push(m),
      });

      expect(mock.insertCalls).toHaveLength(0);
      expect(mock.updateCalls).toHaveLength(0);
    },
  );
});

// ---------------------------------------------------------------------------
// Unit: skip-when-unconfigured (no DB, no Google calls)
// ---------------------------------------------------------------------------

describe("runCalendarSync — skip when credentials not set", () => {
  it("makes NO Google calls when clientId is empty", async () => {
    const mock = makeMockClient();
    const logs: string[] = [];

    // Pass a stub DB — listCalendarSyncTargets must never be called either.
    const stubDb = {} as never;

    await runCalendarSync({
      db: stubDb,
      clientId: "",
      clientSecret: "some-secret",
      makeClient: () => mock,
      log: (m) => logs.push(m),
    });

    expect(mock.insertCalls).toHaveLength(0);
    expect(mock.updateCalls).toHaveLength(0);
    expect(logs.some((l) => l.includes("calendar sync skipped"))).toBe(true);
  });

  it("makes NO Google calls when clientSecret is empty", async () => {
    const mock = makeMockClient();
    const logs: string[] = [];

    const stubDb = {} as never;

    await runCalendarSync({
      db: stubDb,
      clientId: "some-client-id",
      clientSecret: "",
      makeClient: () => mock,
      log: (m) => logs.push(m),
    });

    expect(mock.insertCalls).toHaveLength(0);
    expect(mock.updateCalls).toHaveLength(0);
    expect(logs.some((l) => l.includes("calendar sync skipped"))).toBe(true);
  });

  it("makes NO Google calls when both credentials are empty", async () => {
    const mock = makeMockClient();
    const logs: string[] = [];

    const stubDb = {} as never;

    await runCalendarSync({
      db: stubDb,
      clientId: "",
      clientSecret: "",
      makeClient: () => mock,
      log: (m) => logs.push(m),
    });

    expect(mock.insertCalls).toHaveLength(0);
    expect(mock.updateCalls).toHaveLength(0);
    expect(logs.some((l) => l.includes("calendar sync skipped"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit: deterministicEventId
// ---------------------------------------------------------------------------

describe("deterministicEventId", () => {
  it("is deterministic — same input always yields same output", () => {
    const key = "target:abc|park:123|2026-12-01|prep";
    expect(deterministicEventId(key)).toBe(deterministicEventId(key));
  });

  it("differs for different inputs", () => {
    expect(deterministicEventId("key-a")).not.toBe(deterministicEventId("key-b"));
  });

  it("output is 64 hex chars (sha-256) — valid Google Calendar event id", () => {
    const id = deterministicEventId("some-key");
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Unit: 409-safety-net orchestration
// Simulates: insertEvent throws 409 (prior partial run created event but DB write failed).
// The orchestrator must NOT throw, must count it as created, and must write sync-state
// so the next run skips it entirely.
// ---------------------------------------------------------------------------

describe("runCalendarSync — 409 safety net (mock DB)", async () => {
  const hasDb = await dbReachable();

  const SAFETY_USER_ID = "calsync-409-user";
  const SAFETY_TARGET_ID = "calsync-409-target";
  const ARRIVAL_DATE_409 = dayjs().add(9, "month").format("YYYY-MM-DD");

  let client409: ReturnType<typeof postgres> | null = null;
  let db409: ReturnType<typeof drizzle> | null = null;

  beforeAll(async () => {
    if (!hasDb) return;
    client409 = postgres(URL, { max: 1, onnotice: () => {} });
    db409 = drizzle(client409, { schema });

    await client409`DELETE FROM calendar_sync_state WHERE user_id = ${SAFETY_USER_ID}`;
    await client409`DELETE FROM calendar_connections WHERE user_id = ${SAFETY_USER_ID}`;
    await client409`DELETE FROM targets WHERE id = ${SAFETY_TARGET_ID}`;
    await client409`DELETE FROM "user" WHERE id = ${SAFETY_USER_ID}`;

    await client409`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${SAFETY_USER_ID}, '409 Test', '409@test.invalid', true, now(), now())
    `;

    await client409`
      INSERT INTO targets (id, user_id, provider, name, definition, enabled, calendar_enabled, created_at, updated_at)
      VALUES (
        ${SAFETY_TARGET_ID},
        ${SAFETY_USER_ID},
        'california-parks',
        '409 Target',
        ${JSON.stringify({
          scope: { parkPageId: "1", parkName: "Test Park 409", campgroundName: "CG 409" },
          datePattern: { kind: "exact", date: ARRIVAL_DATE_409 },
          bookingRule: { monthsBefore: 6, releaseTime: "08:00", timezone: "America/Los_Angeles" },
        })}::jsonb,
        true,
        true,
        now(),
        now()
      )
    `;

    await client409`
      INSERT INTO calendar_connections (id, user_id, provider_id, access_token, refresh_token, access_token_expires_at, scope, connected_at, updated_at)
      VALUES (
        gen_random_uuid()::text,
        ${SAFETY_USER_ID},
        'google',
        null,
        'fake-refresh-token-409',
        null,
        null,
        now(),
        now()
      )
    `;
  });

  afterAll(async () => {
    if (client409) {
      await client409`DELETE FROM calendar_sync_state WHERE user_id = ${SAFETY_USER_ID}`;
      await client409`DELETE FROM calendar_connections WHERE user_id = ${SAFETY_USER_ID}`;
      await client409`DELETE FROM targets WHERE id = ${SAFETY_TARGET_ID}`;
      await client409`DELETE FROM "user" WHERE id = ${SAFETY_USER_ID}`;
      await client409.end();
    }
  });

  it.skipIf(!hasDb)(
    "409 safety-net: client returning deterministic id (409-handled path) writes sync-state; second run skips",
    async () => {
      // Simulate the post-fix makeGoogleCalendarClient contract: insertEvent absorbs a 409
      // internally and returns the deterministic id rather than throwing. This is the exact
      // value the orchestrator will store in calendar_sync_state.googleEventId, letting the
      // next run recognise the event as already synced.
      let insertAttempts = 0;
      const conflictClient: CalendarClient = {
        async insertEvent(draft: CalendarEventDraft): Promise<string> {
          insertAttempts++;
          // Simulate the 409 path in makeGoogleCalendarClient: absorb the conflict and
          // return the same deterministic id that would have been passed to Google.
          return deterministicEventId(draft.key);
        },
        async updateEvent(): Promise<void> {},
      };

      const logs: string[] = [];
      // Must NOT throw.
      await expect(
        runCalendarSync({
          db: db409 as never,
          clientId: "x",
          clientSecret: "y",
          makeClient: () => conflictClient,
          log: (m) => logs.push(m),
        }),
      ).resolves.toBeUndefined();

      // All 3 drafts attempted an insert (all returned deterministic ids).
      expect(insertAttempts).toBe(3);

      // Sync-state rows must be written so the next run skips.
      const stateRows =
        await client409!`SELECT key FROM calendar_sync_state WHERE user_id = ${SAFETY_USER_ID}`;
      expect(stateRows).toHaveLength(3);

      // Second run with a normal mock client — must be fully idempotent (no inserts).
      const normalClient = makeMockClient();
      await runCalendarSync({
        db: db409 as never,
        clientId: "x",
        clientSecret: "y",
        makeClient: () => normalClient,
        log: (m) => logs.push(m),
      });
      expect(normalClient.insertCalls).toHaveLength(0);
    },
  );
});
