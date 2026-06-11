import { getSql } from '../cache/db.js';
import { SavedSearchSchema, SavedSearchInputSchema } from './types.js';
import type { SavedSearch, SavedSearchInput } from './types.js';

// ---------------------------------------------------------------------------
// Row shape returned from Postgres
// ---------------------------------------------------------------------------

type DefinitionJson = {
  scope: unknown;
  datePattern: unknown;
  filters: unknown;
  legacy?: unknown;
};

type SavedSearchRow = {
  id: string;
  user_id: string | null;
  provider: string;
  name: string;
  definition: DefinitionJson | null;
  alert_enabled: boolean;
  email_enabled: boolean;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToSavedSearch(row: SavedSearchRow): SavedSearch | null {
  const def = row.definition;
  if (!def) return null;

  const result = SavedSearchSchema.safeParse({
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    name: row.name,
    scope: def['scope'],
    datePattern: def['datePattern'],
    filters: def['filters'],
    alertEnabled: row.alert_enabled,
    emailEnabled: row.email_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    legacy: def['legacy'],
  });

  if (!result.success) return null;
  return result.data;
}

function toDefinition(input: (SavedSearchInput | Partial<SavedSearchInput>) & { legacy?: unknown }): DefinitionJson {
  return {
    scope: input.scope,
    datePattern: input.datePattern,
    filters: input.filters,
    ...(input.legacy !== undefined ? { legacy: input.legacy } : {}),
  };
}

// sql.json() requires JSONValue; cast through unknown to satisfy the type checker.
// The definition object is always structurally valid JSON (all values come from
// validated zod-parsed inputs that serialize cleanly).
function definitionAsJson(def: DefinitionJson): Parameters<ReturnType<typeof getSql>['json']>[0] {
  return def as unknown as Parameters<ReturnType<typeof getSql>['json']>[0];
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listSavedSearches(userId?: string | null): Promise<SavedSearch[]> {
  const sql = getSql();
  let rows: SavedSearchRow[];

  if (userId === undefined || userId === null) {
    rows = await sql.unsafe<SavedSearchRow[]>(
      `SELECT id, user_id, provider, name, definition, alert_enabled, email_enabled,
              created_at::text, updated_at::text
       FROM saved_searches
       WHERE user_id IS NULL
       ORDER BY created_at`,
      []
    );
  } else {
    rows = await sql.unsafe<SavedSearchRow[]>(
      `SELECT id, user_id, provider, name, definition, alert_enabled, email_enabled,
              created_at::text, updated_at::text
       FROM saved_searches
       WHERE user_id = $1
       ORDER BY created_at`,
      [userId]
    );
  }

  const results: SavedSearch[] = [];
  for (const row of rows) {
    const parsed = rowToSavedSearch(row);
    if (parsed) results.push(parsed);
  }
  return results;
}

export async function getSavedSearch(id: string): Promise<SavedSearch | undefined> {
  const sql = getSql();
  const rows = await sql.unsafe<SavedSearchRow[]>(
    `SELECT id, user_id, provider, name, definition, alert_enabled, email_enabled,
            created_at::text, updated_at::text
     FROM saved_searches
     WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) return undefined;
  return rowToSavedSearch(row) ?? undefined;
}

export async function createSavedSearch(input: SavedSearchInput): Promise<SavedSearch> {
  const validated = SavedSearchInputSchema.parse(input);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row: SavedSearchRow = {
    id,
    user_id: validated.userId ?? null,
    provider: validated.provider ?? 'california-parks',
    name: validated.name,
    definition: toDefinition(validated),
    alert_enabled: validated.alertEnabled ?? false,
    email_enabled: validated.emailEnabled ?? true,
    created_at: now,
    updated_at: now,
  };

  const sql = getSql();
  await sql.unsafe<SavedSearchRow[]>(
    `INSERT INTO saved_searches
       (id, user_id, provider, name, definition, alert_enabled, email_enabled, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [row.id, row.user_id, row.provider, row.name, sql.json(definitionAsJson(row.definition!)), row.alert_enabled, row.email_enabled, row.created_at, row.updated_at]
  );

  const saved = rowToSavedSearch(row);
  if (!saved) throw new Error('Failed to parse saved search after create');
  return saved;
}

export async function updateSavedSearch(
  id: string,
  patch: Partial<SavedSearchInput>
): Promise<SavedSearch> {
  const existing = await getSavedSearch(id);
  if (!existing) throw new Error(`SavedSearch "${id}" not found`);

  const now = new Date().toISOString();
  const merged: SavedSearchInput & { legacy?: unknown } = {
    userId: patch.userId !== undefined ? patch.userId : existing.userId,
    provider: patch.provider ?? existing.provider,
    name: patch.name ?? existing.name,
    scope: patch.scope ?? existing.scope,
    datePattern: patch.datePattern ?? existing.datePattern,
    filters: patch.filters ?? existing.filters,
    alertEnabled: patch.alertEnabled !== undefined ? patch.alertEnabled : existing.alertEnabled,
    emailEnabled: patch.emailEnabled !== undefined ? patch.emailEnabled : existing.emailEnabled,
    // Carry legacy through: patch may update it explicitly, otherwise preserve the existing blob.
    legacy: patch.legacy !== undefined ? patch.legacy : existing.legacy,
  };

  const validatedMerged = SavedSearchInputSchema.parse(merged);
  const definition = toDefinition(validatedMerged);
  const sql = getSql();

  await sql.unsafe<SavedSearchRow[]>(
    `UPDATE saved_searches
     SET name = $1, definition = $2, provider = $3,
         alert_enabled = $4, email_enabled = $5, updated_at = $6
     WHERE id = $7`,
    [validatedMerged.name, sql.json(definitionAsJson(definition)), validatedMerged.provider, validatedMerged.alertEnabled, validatedMerged.emailEnabled, now, id]
  );

  const updated = rowToSavedSearch({
    id,
    user_id: validatedMerged.userId ?? null,
    provider: validatedMerged.provider,
    name: validatedMerged.name,
    definition,
    alert_enabled: validatedMerged.alertEnabled ?? false,
    email_enabled: validatedMerged.emailEnabled ?? true,
    created_at: existing.createdAt,
    updated_at: now,
  });

  if (!updated) throw new Error('Failed to parse saved search after update');
  return updated;
}

export async function upsertSavedSearch(search: SavedSearch): Promise<SavedSearch> {
  const validated = SavedSearchSchema.parse(search);
  const definition = toDefinition({
    scope: validated.scope,
    datePattern: validated.datePattern,
    filters: validated.filters,
    legacy: validated.legacy,
  });

  const sql = getSql();
  // NOTE: user_id is intentionally excluded from the ON CONFLICT update set.
  // Migration always runs in single-user mode (user_id IS NULL); the insert
  // already sets user_id on the initial row, and a re-run should never
  // reassign ownership. Future multi-user support must revisit this constraint.
  await sql.unsafe<SavedSearchRow[]>(
    `INSERT INTO saved_searches
       (id, user_id, provider, name, definition, alert_enabled, email_enabled, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       provider = EXCLUDED.provider,
       definition = EXCLUDED.definition,
       alert_enabled = EXCLUDED.alert_enabled,
       email_enabled = EXCLUDED.email_enabled,
       updated_at = EXCLUDED.updated_at`,
    [
      validated.id,
      validated.userId ?? null,
      validated.provider,
      validated.name,
      sql.json(definitionAsJson(definition)),
      validated.alertEnabled,
      validated.emailEnabled,
      validated.createdAt,
      validated.updatedAt,
    ]
  );

  const saved = rowToSavedSearch({
    id: validated.id,
    user_id: validated.userId ?? null,
    provider: validated.provider,
    name: validated.name,
    definition,
    alert_enabled: validated.alertEnabled ?? false,
    email_enabled: validated.emailEnabled ?? true,
    created_at: validated.createdAt,
    updated_at: validated.updatedAt,
  });

  if (!saved) throw new Error('Failed to parse saved search after upsert');
  return saved;
}

export async function deleteSavedSearch(id: string): Promise<void> {
  const sql = getSql();
  await sql.unsafe(
    `DELETE FROM saved_searches WHERE id = $1`,
    [id]
  );
}

export async function enableSavedSearchAlert(id: string): Promise<void> {
  const sql = getSql();
  await sql.unsafe(
    `UPDATE saved_searches SET alert_enabled = true, updated_at = $1 WHERE id = $2 AND alert_enabled = false`,
    [new Date().toISOString(), id]
  );
}

export async function listAlertEnabledSavedSearches(): Promise<SavedSearch[]> {
  const sql = getSql();
  const rows = await sql.unsafe<SavedSearchRow[]>(
    `SELECT id, user_id, provider, name, definition, alert_enabled, email_enabled,
            created_at::text, updated_at::text
     FROM saved_searches
     WHERE alert_enabled = true
     ORDER BY created_at`,
    []
  );

  const results: SavedSearch[] = [];
  for (const row of rows) {
    const parsed = rowToSavedSearch(row);
    if (parsed) results.push(parsed);
  }
  return results;
}
