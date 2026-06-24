import { sql } from "drizzle-orm";
import {
  TargetSchema, TargetInputSchema,
  type Target, type TargetInput,
} from "@campbrain/types";
import { rows, type QueryDb } from "./exec";

type DefinitionJson = { scope: unknown; datePattern: unknown; bookingRule: unknown };

type TargetRow = {
  id: string; user_id: string; provider: string; name: string;
  definition: DefinitionJson | null;
  enabled: boolean; calendar_enabled: boolean;
  created_at: string; updated_at: string;
};

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

function toDefinition(input: TargetInput): DefinitionJson {
  return { scope: input.scope, datePattern: input.datePattern, bookingRule: input.bookingRule };
}

const SELECT_COLS = sql`id, user_id, provider, name, definition,
  enabled, calendar_enabled, created_at::text, updated_at::text`;

/** Only this user's rows. */
export async function listTargets(db: QueryDb, userId: string): Promise<Target[]> {
  const result = await rows<TargetRow>(
    db,
    sql`SELECT ${SELECT_COLS} FROM targets WHERE user_id = ${userId} ORDER BY created_at`,
  );
  const out: Target[] = [];
  for (const r of result) { const t = rowToTarget(r); if (t) out.push(t); }
  return out;
}

/** A single row, ownership-checked. Cross-user id → undefined. */
export async function getTarget(db: QueryDb, id: string, userId: string): Promise<Target | undefined> {
  const result = await rows<TargetRow>(
    db,
    sql`SELECT ${SELECT_COLS} FROM targets WHERE id = ${id} AND user_id = ${userId}`,
  );
  const row = result[0];
  if (!row) return undefined;
  return rowToTarget(row) ?? undefined;
}

/** Insert, forcing user_id = userId (never trusts input.userId). */
export async function createTarget(db: QueryDb, userId: string, input: TargetInput): Promise<Target> {
  const validated = TargetInputSchema.parse({ ...input, userId });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const definition = toDefinition(validated);
  await rows(
    db,
    sql`INSERT INTO targets
          (id, user_id, provider, name, definition, enabled, calendar_enabled, created_at, updated_at)
        VALUES (${id}, ${userId}, ${validated.provider}, ${validated.name},
                ${JSON.stringify(definition)}::jsonb, ${validated.enabled},
                ${validated.calendarEnabled}, ${now}::timestamptz, ${now}::timestamptz)`,
  );
  const created = await getTarget(db, id, userId);
  if (!created) throw new Error("Failed to read target after create");
  return created;
}

/** Patch an owned row. Cross-user id (or missing) → throws "not found". */
export async function updateTarget(
  db: QueryDb, id: string, userId: string, patch: Partial<TargetInput>,
): Promise<Target> {
  const existing = await getTarget(db, id, userId);
  if (!existing) throw new Error(`Target "${id}" not found`);
  const now = new Date().toISOString();
  const merged = TargetInputSchema.parse({
    userId,
    provider: patch.provider ?? existing.provider,
    name: patch.name ?? existing.name,
    scope: patch.scope ?? existing.scope,
    datePattern: patch.datePattern ?? existing.datePattern,
    bookingRule: patch.bookingRule ?? existing.bookingRule,
    enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled,
    calendarEnabled: patch.calendarEnabled !== undefined ? patch.calendarEnabled : existing.calendarEnabled,
  });
  const definition = toDefinition(merged);
  await rows(
    db,
    sql`UPDATE targets
        SET name = ${merged.name}, definition = ${JSON.stringify(definition)}::jsonb,
            provider = ${merged.provider}, enabled = ${merged.enabled},
            calendar_enabled = ${merged.calendarEnabled}, updated_at = ${now}::timestamptz
        WHERE id = ${id} AND user_id = ${userId}`,
  );
  const updated = await getTarget(db, id, userId);
  if (!updated) throw new Error("Failed to read target after update");
  return updated;
}

/** Delete an owned row. Cross-user id → no-op (0 rows affected). */
export async function deleteTarget(db: QueryDb, id: string, userId: string): Promise<void> {
  await rows(db, sql`DELETE FROM targets WHERE id = ${id} AND user_id = ${userId}`);
}

/** Flip enabled on an owned row. Cross-user → no-op. */
export async function setTargetEnabled(db: QueryDb, id: string, userId: string, enabled: boolean): Promise<void> {
  await rows(
    db,
    sql`UPDATE targets SET enabled = ${enabled}, updated_at = ${new Date().toISOString()}::timestamptz
        WHERE id = ${id} AND user_id = ${userId}`,
  );
}
