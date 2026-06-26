import { sql } from "drizzle-orm";
import { TargetSchema } from "@campbrain/types";
import type { Target } from "@campbrain/types";
import { rows, type QueryDb } from "./exec";
import { sqlTextArray } from "./filters";

export interface CalendarConnection {
  userId: string;
  providerId: string;
  accessToken: string | null;
  refreshToken: string;
  accessTokenExpiresAt: string | null;
  scope: string | null;
  connectedAt: string;
}

export interface ConnectionInput {
  providerId?: string; // default 'google'
  accessToken: string | null;
  refreshToken: string;
  accessTokenExpiresAt: string | null;
  scope: string | null;
}

export interface CalendarSyncTarget {
  target: Target;
  userId: string;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
}

type ConnectionRow = {
  user_id: string;
  provider_id: string;
  access_token: string | null;
  refresh_token: string;
  access_token_expires_at: string | null;
  scope: string | null;
  connected_at: string;
};

type TargetRow = {
  id: string;
  user_id: string;
  provider: string;
  name: string;
  definition: { scope: unknown; datePattern: unknown; bookingRule: unknown } | null;
  enabled: boolean;
  calendar_enabled: boolean;
  created_at: string;
  updated_at: string;
};

type CalendarSyncRow = TargetRow & {
  c_user_id: string;
  c_refresh_token: string;
  c_access_token: string | null;
  c_access_token_expires_at: string | null;
};

type SyncStateRow = {
  key: string;
  google_event_id: string;
  summary: string;
  start_time_iso: string;
};

function rowToConnection(row: ConnectionRow): CalendarConnection {
  return {
    userId: row.user_id,
    providerId: row.provider_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    accessTokenExpiresAt: row.access_token_expires_at,
    scope: row.scope,
    connectedAt: row.connected_at,
  };
}

function rowToTarget(row: TargetRow): Target | null {
  const def = row.definition;
  if (!def) return null;
  const result = TargetSchema.safeParse({
    id: row.id, userId: row.user_id, provider: row.provider, name: row.name,
    scope: def.scope, datePattern: def.datePattern, bookingRule: def.bookingRule,
    enabled: row.enabled, calendarEnabled: row.calendar_enabled,
    createdAt: row.created_at, updatedAt: row.updated_at,
  });
  if (!result.success) {
    console.warn(`targets row ${row.id} failed schema validation`, result.error.flatten());
    return null;
  }
  return result.data;
}

// ─── per-user connection CRUD ────────────────────────────────────────────────

export async function upsertConnection(
  db: QueryDb,
  userId: string,
  input: ConnectionInput,
): Promise<void> {
  const providerId = input.providerId ?? "google";
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = input.accessTokenExpiresAt;
  await rows(
    db,
    sql`INSERT INTO calendar_connections
          (id, user_id, provider_id, access_token, refresh_token,
           access_token_expires_at, scope, connected_at, updated_at)
        VALUES
          (${id}, ${userId}, ${providerId}, ${input.accessToken}, ${input.refreshToken},
           ${expiresAt}::timestamptz, ${input.scope}, ${now}::timestamptz, ${now}::timestamptz)
        ON CONFLICT (user_id, provider_id) DO UPDATE SET
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          access_token_expires_at = EXCLUDED.access_token_expires_at,
          scope = EXCLUDED.scope,
          updated_at = now()`,
  );
}

export async function getConnection(
  db: QueryDb,
  userId: string,
  providerId = "google",
): Promise<CalendarConnection | undefined> {
  const result = await rows<ConnectionRow>(
    db,
    sql`SELECT user_id, provider_id, access_token, refresh_token,
               access_token_expires_at::text, scope, connected_at::text
          FROM calendar_connections
         WHERE user_id = ${userId} AND provider_id = ${providerId}`,
  );
  const row = result[0];
  if (!row) return undefined;
  return rowToConnection(row);
}

export async function deleteConnection(
  db: QueryDb,
  userId: string,
  providerId = "google",
): Promise<void> {
  await rows(
    db,
    sql`DELETE FROM calendar_connections WHERE user_id = ${userId} AND provider_id = ${providerId}`,
  );
}

export async function getConnectionStatus(
  db: QueryDb,
  userId: string,
): Promise<{ connected: boolean; connectedAt?: string }> {
  const conn = await getConnection(db, userId, "google");
  if (!conn) return { connected: false };
  return { connected: true, connectedAt: conn.connectedAt };
}

// ─── un-scoped scanner query ─────────────────────────────────────────────────

export async function listCalendarSyncTargets(
  db: QueryDb,
): Promise<CalendarSyncTarget[]> {
  const result = await rows<CalendarSyncRow>(
    db,
    sql`SELECT
          t.id, t.user_id, t.provider, t.name, t.definition,
          t.enabled, t.calendar_enabled, t.created_at::text, t.updated_at::text,
          c.user_id AS c_user_id,
          c.refresh_token AS c_refresh_token,
          c.access_token AS c_access_token,
          c.access_token_expires_at::text AS c_access_token_expires_at
        FROM targets t
        JOIN calendar_connections c
          ON c.user_id = t.user_id AND c.provider_id = 'google'
        WHERE t.calendar_enabled = true AND t.enabled = true`,
  );

  const out: CalendarSyncTarget[] = [];
  for (const row of result) {
    const target = rowToTarget(row);
    if (!target) continue;
    out.push({
      target,
      userId: row.c_user_id,
      refreshToken: row.c_refresh_token,
      accessToken: row.c_access_token,
      accessTokenExpiresAt: row.c_access_token_expires_at,
    });
  }
  return out;
}

// ─── sync state (per-user) ───────────────────────────────────────────────────

export async function getSyncState(
  db: QueryDb,
  userId: string,
  keys: string[],
): Promise<Map<string, { googleEventId: string; summary: string; startTimeIso: string }>> {
  if (keys.length === 0) return new Map();

  const result = await rows<SyncStateRow>(
    db,
    sql`SELECT key, google_event_id, summary, start_time_iso
          FROM calendar_sync_state
         WHERE user_id = ${userId} AND key = ANY(${sqlTextArray(keys)})`,
  );

  const map = new Map<string, { googleEventId: string; summary: string; startTimeIso: string }>();
  for (const row of result) {
    map.set(row.key, {
      googleEventId: row.google_event_id,
      summary: row.summary,
      startTimeIso: row.start_time_iso,
    });
  }
  return map;
}

export async function upsertSyncState(
  db: QueryDb,
  userId: string,
  targetId: string,
  rec: { key: string; googleEventId: string; summary: string; startTimeIso: string },
): Promise<void> {
  const id = crypto.randomUUID();
  await rows(
    db,
    sql`INSERT INTO calendar_sync_state
          (id, user_id, target_id, key, google_event_id, summary, start_time_iso, last_synced_at)
        VALUES
          (${id}, ${userId}, ${targetId}, ${rec.key}, ${rec.googleEventId},
           ${rec.summary}, ${rec.startTimeIso}, now())
        ON CONFLICT (user_id, key) DO UPDATE SET
          google_event_id = EXCLUDED.google_event_id,
          summary = EXCLUDED.summary,
          start_time_iso = EXCLUDED.start_time_iso,
          last_synced_at = now()`,
  );
}
