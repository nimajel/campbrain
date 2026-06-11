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

  // Simulate sql.json(obj): wrap so dispatch can unwrap it.
  // The real postgres library sends JSONB as a typed value; we model it as { __json: value }.
  function jsonHelper(value: unknown) {
    return { __json: value };
  }

  // Unwrap sql.json() wrappers so dispatch sees plain objects.
  function unwrapJsonParams(params: unknown[]): unknown[] {
    return params.map((p) => {
      if (p !== null && typeof p === 'object' && '__json' in (p as Record<string, unknown>)) {
        return (p as Record<string, unknown>)['__json'];
      }
      return p;
    });
  }

  const mockSql = Object.assign(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => [] as Record<string, unknown>[],
    {
      unsafe(sqlStr: string, params: unknown[]) {
        return dispatch(sqlStr, unwrapJsonParams(params));
      },
      json: jsonHelper,
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
  upsertSavedSearch,
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

  it('getSavedSearch returns undefined for unknown id', async () => {
    const fetched = await getSavedSearch('nonexistent');
    expect(fetched).toBeUndefined();
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
    expect(fetched).toBeUndefined();
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
  // 4. Write-path zod validation
  // -------------------------------------------------------------------------

  it('createSavedSearch rejects input with empty name', async () => {
    await expect(createSavedSearch({ ...makeInput(), name: '' })).rejects.toThrow();
  });

  it('createSavedSearch rejects input with minNights out of range', async () => {
    const bad = {
      ...makeInput(),
      filters: { ...makeInput().filters, minNights: 5 as unknown as 1 },
    };
    await expect(createSavedSearch(bad)).rejects.toThrow();
  });

  it('updateSavedSearch rejects a patch that produces an invalid merged object', async () => {
    const created = await createSavedSearch(makeInput());
    await expect(
      updateSavedSearch(created.id, { name: '' })
    ).rejects.toThrow();
  });

  it('updateSavedSearch preserves the legacy blob when an unrelated field (name) is patched', async () => {
    const legacy = { acceptableSites: ['Site 1', 'Site 2'], maxNights: 3 };
    const created = await createSavedSearch({ ...makeInput(), legacy });
    const updated = await updateSavedSearch(created.id, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect((updated as Record<string, unknown>)['legacy']).toEqual(legacy);
  });

  // -------------------------------------------------------------------------
  // 5. Corrupt JSONB row is skipped, not thrown
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

// ---------------------------------------------------------------------------
// 6. upsertSavedSearch
// ---------------------------------------------------------------------------

describe('upsertSavedSearch', () => {
  beforeEach(() => {
    _rows = new Map();
  });

  it('inserts a new row when the id does not exist', async () => {
    const now = new Date().toISOString();
    const search = {
      id: 'fixed-id-001',
      userId: null as null,
      provider: 'california-parks' as const,
      name: 'Insert via upsert',
      scope: { region: null as null, parkPageIds: ['468'] },
      datePattern: { kind: 'fixed_range' as const, from: '2026-07-01', to: '2026-09-30' },
      filters: { access: [] as ('drive_in' | 'hike_in' | 'boat_in')[], kinds: [] as ('tent' | 'hookup' | 'cabin')[], hide: [] as ('group' | 'equestrian' | 'walk_up')[], minNights: 1 as const },
      alertEnabled: false,
      emailEnabled: true,
      createdAt: now,
      updatedAt: now,
    };

    await upsertSavedSearch(search);
    const fetched = await getSavedSearch('fixed-id-001');
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe('fixed-id-001');
    expect(fetched!.name).toBe('Insert via upsert');
  });

  it('updates an existing row when the id already exists (idempotent re-run)', async () => {
    const now = new Date().toISOString();
    const search = {
      id: 'fixed-id-002',
      userId: null as null,
      provider: 'california-parks' as const,
      name: 'Original name',
      scope: { region: null as null, parkPageIds: ['468'] },
      datePattern: { kind: 'any_weekend' as const, horizonDays: 90 as number },
      filters: { access: [] as ('drive_in' | 'hike_in' | 'boat_in')[], kinds: [] as ('tent' | 'hookup' | 'cabin')[], hide: [] as ('group' | 'equestrian' | 'walk_up')[], minNights: 1 as const },
      alertEnabled: false,
      emailEnabled: true,
      createdAt: now,
      updatedAt: now,
    };

    await upsertSavedSearch(search);
    // Re-run with same id but different name.
    await upsertSavedSearch({ ...search, name: 'Updated name' });

    const all = await listSavedSearches();
    expect(all.length).toBe(1);
    expect(all[0]!.name).toBe('Updated name');
  });

  it('preserves the legacy field through a write→read round-trip', async () => {
    const now = new Date().toISOString();
    const legacy = {
      enabled: true,
      acceptableSites: ['Site A', 'Site B'],
      bookingRule: { type: 'rolling_months_before', monthsBefore: 6, releaseTime: '08:00', timezone: 'America/Los_Angeles' },
      maxNights: 2,
      people: 4,
    };
    const search = {
      id: 'fixed-id-003',
      userId: null as null,
      provider: 'california-parks' as const,
      name: 'Round-trip legacy',
      scope: { region: null as null, parkPageIds: ['468'] },
      datePattern: { kind: 'fixed_range' as const, from: '2026-07-01', to: '2026-09-30' },
      filters: { access: [] as ('drive_in' | 'hike_in' | 'boat_in')[], kinds: [] as ('tent' | 'hookup' | 'cabin')[], hide: [] as ('group' | 'equestrian' | 'walk_up')[], minNights: 1 as const },
      alertEnabled: false,
      emailEnabled: true,
      createdAt: now,
      updatedAt: now,
      legacy,
    };

    await upsertSavedSearch(search as Parameters<typeof upsertSavedSearch>[0]);
    const fetched = await getSavedSearch('fixed-id-003');
    expect(fetched).toBeDefined();
    // The legacy field must survive the round-trip.
    const fetchedLegacy = (fetched as Record<string, unknown>)['legacy'] as typeof legacy;
    expect(fetchedLegacy).toEqual(legacy);
  });
});
