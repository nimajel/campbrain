import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared in-memory store backing the mock sql client.
// Using module-level let so the vi.mock factory and tests share the reference.
// ---------------------------------------------------------------------------

let _rows: Map<string, Record<string, unknown>> = new Map();

// ---------------------------------------------------------------------------
// Mock the DB module.
// The stable mock sql function always delegates to the current _rows map,
// so resetting _rows in beforeEach gives each test a clean slate.
// ---------------------------------------------------------------------------

vi.mock('../src/cache/db.js', () => {
  function dispatch(sqlStr: string, values: unknown[]): Record<string, unknown>[] {
    const s = sqlStr.trim().toUpperCase().replace(/\s+/g, ' ');

    // INSERT
    if (s.startsWith('INSERT INTO SAVED_SEARCHES')) {
      const [id, user_id, provider, name, definitionStr, alert_enabled, email_enabled, created_at, updated_at] = values as [string, string | null, string, string, string, boolean, boolean, string, string];
      // Postgres returns JSONB as a parsed object; simulate that by parsing the JSON string.
      const definition = typeof definitionStr === 'string' ? JSON.parse(definitionStr) : definitionStr;
      const row = { id, user_id, provider, name, definition, alert_enabled, email_enabled, created_at, updated_at };
      _rows.set(id, row);
      return [row];
    }

    // SELECT WHERE id = $1
    if (s.startsWith('SELECT') && s.includes('FROM SAVED_SEARCHES') && s.includes('WHERE ID =')) {
      const id = values[0] as string;
      const row = _rows.get(id);
      return row ? [row] : [];
    }

    // SELECT WHERE user_id IS NULL
    if (s.startsWith('SELECT') && s.includes('FROM SAVED_SEARCHES') && s.includes('USER_ID IS NULL')) {
      return Array.from(_rows.values()).filter((r) => r['user_id'] == null);
    }

    // SELECT WHERE user_id = $1
    if (s.startsWith('SELECT') && s.includes('FROM SAVED_SEARCHES') && s.includes('USER_ID =')) {
      const userId = values[0] as string;
      return Array.from(_rows.values()).filter((r) => r['user_id'] === userId);
    }

    // SELECT WHERE alert_enabled = true
    if (s.startsWith('SELECT') && s.includes('FROM SAVED_SEARCHES') && s.includes('ALERT_ENABLED = TRUE')) {
      return Array.from(_rows.values()).filter((r) => r['alert_enabled'] === true);
    }

    // UPDATE
    if (s.startsWith('UPDATE SAVED_SEARCHES')) {
      const id = values[6] as string;
      const existing = _rows.get(id);
      if (!existing) return [];
      const definitionRaw = values[1];
      const definition = typeof definitionRaw === 'string' ? JSON.parse(definitionRaw) : definitionRaw;
      const updated = {
        ...existing,
        name: values[0],
        definition,
        provider: values[2],
        alert_enabled: values[3],
        email_enabled: values[4],
        updated_at: values[5],
      };
      _rows.set(id, updated);
      return [updated];
    }

    // DELETE
    if (s.startsWith('DELETE FROM SAVED_SEARCHES')) {
      const id = values[0] as string;
      _rows.delete(id);
      return [];
    }

    return [];
  }

  const mockSql = Object.assign(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => [] as Record<string, unknown>[],
    {
      unsafe(sqlStr: string, params: unknown[]) {
        return dispatch(sqlStr, params);
      },
    }
  );

  return { getSql: () => mockSql };
});

// Import store AFTER mock is defined.
const {
  listSavedSearches,
  getSavedSearch,
  createSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  listAlertEnabledSavedSearches,
} = await import('../src/saved-search/store.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeInput() {
  return {
    userId: null as null,
    provider: 'california-parks' as const,
    name: 'Weekend near Tahoe',
    scope: { region: 'sierra' as const, parkPageIds: [] },
    datePattern: { kind: 'any_weekend' as const, horizonDays: 90 },
    filters: { access: [] as ('drive_in' | 'hike_in' | 'boat_in')[], kinds: [] as ('tent' | 'hookup' | 'cabin')[], hide: [] as ('group' | 'equestrian' | 'walk_up')[], minNights: 1 as const },
    alertEnabled: false,
    emailEnabled: true,
  };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('saved-search store', () => {
  beforeEach(() => {
    _rows = new Map();
  });

  // -------------------------------------------------------------------------
  // 1. create → get → list → update → delete round-trip
  // -------------------------------------------------------------------------

  it('create assigns an id and timestamps', async () => {
    const created = await createSavedSearch(makeInput());
    expect(created.id).toBeTruthy();
    expect(typeof created.id).toBe('string');
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBeTruthy();
    expect(created.name).toBe('Weekend near Tahoe');
  });

  it('getSavedSearch returns the created row', async () => {
    const created = await createSavedSearch(makeInput());
    const fetched = await getSavedSearch(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.name).toBe(created.name);
  });

  it('getSavedSearch returns null for unknown id', async () => {
    const fetched = await getSavedSearch('nonexistent');
    expect(fetched).toBeNull();
  });

  it('listSavedSearches returns all null-userId rows', async () => {
    await createSavedSearch(makeInput());
    await createSavedSearch({ ...makeInput(), name: 'Another search' });
    const list = await listSavedSearches();
    expect(list.length).toBe(2);
  });

  it('updateSavedSearch changes name and bumps updatedAt', async () => {
    const created = await createSavedSearch(makeInput());
    const originalUpdatedAt = created.updatedAt;

    // Small delay to ensure updatedAt differs.
    await new Promise((r) => setTimeout(r, 5));

    const updated = await updateSavedSearch(created.id, { name: 'Renamed search' });
    expect(updated.name).toBe('Renamed search');
    expect(updated.updatedAt).not.toBe(originalUpdatedAt);
  });

  it('deleteSavedSearch removes the row', async () => {
    const created = await createSavedSearch(makeInput());
    await deleteSavedSearch(created.id);
    const fetched = await getSavedSearch(created.id);
    expect(fetched).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. JSONB parse-back deep-equals input definition
  // -------------------------------------------------------------------------

  it('definition stored and parsed back equals input scope/datePattern/filters', async () => {
    const input = makeInput();
    const created = await createSavedSearch(input);
    const fetched = await getSavedSearch(created.id);
    expect(fetched?.scope).toEqual(input.scope);
    expect(fetched?.datePattern).toEqual(input.datePattern);
    expect(fetched?.filters).toEqual(input.filters);
  });

  // -------------------------------------------------------------------------
  // 3. listAlertEnabledSavedSearches
  // -------------------------------------------------------------------------

  it('listAlertEnabledSavedSearches returns only alert_enabled=true rows', async () => {
    await createSavedSearch({ ...makeInput(), alertEnabled: false });
    await createSavedSearch({ ...makeInput(), name: 'Alert search', alertEnabled: true });
    const alertRows = await listAlertEnabledSavedSearches();
    expect(alertRows.length).toBe(1);
    expect(alertRows[0]?.name).toBe('Alert search');
    expect(alertRows[0]?.alertEnabled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Corrupt JSONB row is skipped, not thrown
  // -------------------------------------------------------------------------

  it('listSavedSearches skips rows with invalid JSONB definitions', async () => {
    // Create a valid row first.
    const valid = await createSavedSearch(makeInput());

    // Inject a corrupt row directly into the mock store (simulates DB corruption).
    _rows.set('corrupt-id', {
      id: 'corrupt-id',
      user_id: null,
      provider: 'california-parks',
      name: 'Corrupt',
      // definition has null scope/datePattern/filters — fails SavedSearchSchema
      definition: { scope: null, datePattern: null, filters: null },
      alert_enabled: false,
      email_enabled: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const list = await listSavedSearches();
    // The corrupt row should be skipped; only the valid row is returned.
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe(valid.id);
  });
});
