import { sql } from "drizzle-orm";
import {
  SavedSearchSchema, SavedSearchInputSchema,
  type SavedSearch, type SavedSearchInput,
} from "@campbrain/types";
import { rows, type QueryDb } from "./exec";

type DefinitionJson = { scope: unknown; datePattern: unknown; filters: unknown; legacy?: unknown };

type SavedSearchRow = {
  id: string; user_id: string | null; provider: string; name: string;
  definition: DefinitionJson | null;
  alert_enabled: boolean; email_enabled: boolean;
  created_at: string; updated_at: string;
};

function rowToSavedSearch(row: SavedSearchRow): SavedSearch | null {
  const def = row.definition;
  if (!def) return null;
  const result = SavedSearchSchema.safeParse({
    id: row.id, userId: row.user_id, provider: row.provider, name: row.name,
    scope: def.scope, datePattern: def.datePattern, filters: def.filters,
    alertEnabled: row.alert_enabled, emailEnabled: row.email_enabled,
    createdAt: row.created_at, updatedAt: row.updated_at, legacy: def.legacy,
  });
  return result.success ? result.data : null;
}

function toDefinition(input: SavedSearchInput & { legacy?: unknown }): DefinitionJson {
  return {
    scope: input.scope, datePattern: input.datePattern, filters: input.filters,
    ...(input.legacy !== undefined ? { legacy: input.legacy } : {}),
  };
}

const SELECT_COLS = sql`id, user_id, provider, name, definition,
  alert_enabled, email_enabled, created_at::text, updated_at::text`;

/** Only this user's rows (idx_saved_searches_user already exists). */
export async function listSavedSearches(db: QueryDb, userId: string): Promise<SavedSearch[]> {
  const result = await rows<SavedSearchRow>(
    db,
    sql`SELECT ${SELECT_COLS} FROM saved_searches WHERE user_id = ${userId} ORDER BY created_at`,
  );
  const out: SavedSearch[] = [];
  for (const r of result) { const p = rowToSavedSearch(r); if (p) out.push(p); }
  return out;
}

/** A single row, ownership-checked. Cross-user id → undefined. */
export async function getSavedSearch(db: QueryDb, id: string, userId: string): Promise<SavedSearch | undefined> {
  const result = await rows<SavedSearchRow>(
    db,
    sql`SELECT ${SELECT_COLS} FROM saved_searches WHERE id = ${id} AND user_id = ${userId}`,
  );
  const row = result[0];
  if (!row) return undefined;
  return rowToSavedSearch(row) ?? undefined;
}

/** Insert, forcing user_id = userId (never trusts input.userId). */
export async function createSavedSearch(db: QueryDb, userId: string, input: SavedSearchInput): Promise<SavedSearch> {
  const validated = SavedSearchInputSchema.parse({ ...input, userId });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const definition = toDefinition({ ...validated, userId });
  await rows(
    db,
    sql`INSERT INTO saved_searches
          (id, user_id, provider, name, definition, alert_enabled, email_enabled, created_at, updated_at)
        VALUES (${id}, ${userId}, ${validated.provider}, ${validated.name},
                ${JSON.stringify(definition)}::jsonb, ${validated.alertEnabled},
                ${validated.emailEnabled}, ${now}::timestamptz, ${now}::timestamptz)`,
  );
  const saved = await getSavedSearch(db, id, userId);
  if (!saved) throw new Error("Failed to read saved search after create");
  return saved;
}

/** Patch an owned row. Cross-user id (or missing) → throws "not found". */
export async function updateSavedSearch(
  db: QueryDb, id: string, userId: string, patch: Partial<SavedSearchInput>,
): Promise<SavedSearch> {
  const existing = await getSavedSearch(db, id, userId);
  if (!existing) throw new Error(`SavedSearch "${id}" not found`);
  const now = new Date().toISOString();
  const merged = SavedSearchInputSchema.parse({
    userId,
    provider: patch.provider ?? existing.provider,
    name: patch.name ?? existing.name,
    scope: patch.scope ?? existing.scope,
    datePattern: patch.datePattern ?? existing.datePattern,
    filters: patch.filters ?? existing.filters,
    alertEnabled: patch.alertEnabled !== undefined ? patch.alertEnabled : existing.alertEnabled,
    emailEnabled: patch.emailEnabled !== undefined ? patch.emailEnabled : existing.emailEnabled,
    legacy: patch.legacy !== undefined ? patch.legacy : existing.legacy,
  });
  const definition = toDefinition({ ...merged, userId });
  await rows(
    db,
    sql`UPDATE saved_searches
        SET name = ${merged.name}, definition = ${JSON.stringify(definition)}::jsonb,
            provider = ${merged.provider}, alert_enabled = ${merged.alertEnabled},
            email_enabled = ${merged.emailEnabled}, updated_at = ${now}::timestamptz
        WHERE id = ${id} AND user_id = ${userId}`,
  );
  const updated = await getSavedSearch(db, id, userId);
  if (!updated) throw new Error("Failed to read saved search after update");
  return updated;
}

/** Delete an owned row. Cross-user id → no-op (0 rows affected). */
export async function deleteSavedSearch(db: QueryDb, id: string, userId: string): Promise<void> {
  await rows(db, sql`DELETE FROM saved_searches WHERE id = ${id} AND user_id = ${userId}`);
}

/** Flip alert_enabled on an owned row (data only in 2a; 2b consumes it). */
export async function setAlertEnabled(db: QueryDb, id: string, userId: string, enabled: boolean): Promise<void> {
  await rows(
    db,
    sql`UPDATE saved_searches SET alert_enabled = ${enabled}, updated_at = ${new Date().toISOString()}::timestamptz
        WHERE id = ${id} AND user_id = ${userId}`,
  );
}

/** UN-scoped — reserved for the 2b scanner. NOT exposed via tRPC. */
export async function listAlertEnabledSavedSearches(db: QueryDb): Promise<SavedSearch[]> {
  const result = await rows<SavedSearchRow>(
    db,
    sql`SELECT ${SELECT_COLS} FROM saved_searches WHERE alert_enabled = true ORDER BY created_at`,
  );
  const out: SavedSearch[] = [];
  for (const r of result) { const p = rowToSavedSearch(r); if (p) out.push(p); }
  return out;
}
