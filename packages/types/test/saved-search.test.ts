import { describe, it, expect } from 'vitest';
import {
  SavedSearchScopeSchema,
  SavedSearchDatePatternSchema,
  SavedSearchFiltersSchema,
  SavedSearchSchema,
} from '../src/saved-search';
import type { SavedSearch } from '../src/saved-search';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSavedSearch(overrides: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: 'test-id',
    userId: null,
    provider: 'california-parks',
    name: 'Weekend near Tahoe',
    scope: { region: 'sierra', parkPageIds: [] },
    datePattern: { kind: 'any_weekend', horizonDays: 90 },
    filters: { access: [], kinds: [], hide: [], minNights: 1 },
    alertEnabled: false,
    emailEnabled: true,
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. SavedSearchScopeSchema
// ---------------------------------------------------------------------------

describe('SavedSearchScopeSchema', () => {
  it('accepts region with empty parkPageIds', () => {
    const result = SavedSearchScopeSchema.safeParse({ region: 'sierra', parkPageIds: [] });
    expect(result.success).toBe(true);
  });

  it('accepts null region with empty parkPageIds (all parks)', () => {
    const result = SavedSearchScopeSchema.safeParse({ region: null, parkPageIds: [] });
    expect(result.success).toBe(true);
  });

  it('accepts null region with non-empty parkPageIds', () => {
    const result = SavedSearchScopeSchema.safeParse({ region: null, parkPageIds: ['123', '456'] });
    expect(result.success).toBe(true);
  });

  it('rejects when both region and parkPageIds are non-empty', () => {
    const result = SavedSearchScopeSchema.safeParse({ region: 'sierra', parkPageIds: ['123'] });
    expect(result.success).toBe(false);
  });

  it('defaults parkPageIds to empty array when omitted', () => {
    const result = SavedSearchScopeSchema.parse({ region: null });
    expect(result.parkPageIds).toEqual([]);
  });

  it('rejects an unknown region value', () => {
    const result = SavedSearchScopeSchema.safeParse({ region: 'midwest', parkPageIds: [] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. SavedSearchDatePatternSchema
// ---------------------------------------------------------------------------

describe('SavedSearchDatePatternSchema', () => {
  it('accepts fixed_range with valid from/to', () => {
    const result = SavedSearchDatePatternSchema.safeParse({
      kind: 'fixed_range',
      from: '2026-08-14',
      to: '2026-08-16',
    });
    expect(result.success).toBe(true);
  });

  it('accepts any_weekend with explicit horizonDays', () => {
    const result = SavedSearchDatePatternSchema.safeParse({ kind: 'any_weekend', horizonDays: 60 });
    expect(result.success).toBe(true);
  });

  it('defaults horizonDays to 90 for any_weekend', () => {
    const result = SavedSearchDatePatternSchema.parse({ kind: 'any_weekend' });
    expect(result.kind).toBe('any_weekend');
    if (result.kind === 'any_weekend') {
      expect(result.horizonDays).toBe(90);
    }
  });

  it('rejects fixed_range with invalid date format', () => {
    const result = SavedSearchDatePatternSchema.safeParse({
      kind: 'fixed_range',
      from: '08/14/2026',
      to: '2026-08-16',
    });
    expect(result.success).toBe(false);
  });

  it('rejects any_weekend with horizonDays > 180', () => {
    const result = SavedSearchDatePatternSchema.safeParse({ kind: 'any_weekend', horizonDays: 181 });
    expect(result.success).toBe(false);
  });

  it('rejects unknown kind', () => {
    const result = SavedSearchDatePatternSchema.safeParse({ kind: 'rolling_window' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. SavedSearchFiltersSchema defaults
// ---------------------------------------------------------------------------

describe('SavedSearchFiltersSchema', () => {
  it('defaults all arrays and minNights when empty object passed', () => {
    const result = SavedSearchFiltersSchema.parse({});
    expect(result.access).toEqual([]);
    expect(result.kinds).toEqual([]);
    expect(result.hide).toEqual([]);
    expect(result.minNights).toBe(1);
  });

  it('accepts valid filter values', () => {
    const result = SavedSearchFiltersSchema.parse({
      access: ['drive_in', 'hike_in'],
      kinds: ['tent'],
      hide: ['group'],
      minNights: 2,
    });
    expect(result.access).toEqual(['drive_in', 'hike_in']);
    expect(result.minNights).toBe(2);
  });

  it('rejects invalid access value', () => {
    const result = SavedSearchFiltersSchema.safeParse({ access: ['helicopter'] });
    expect(result.success).toBe(false);
  });

  it('rejects minNights value not in 1|2|3', () => {
    const result = SavedSearchFiltersSchema.safeParse({ minNights: 4 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. SavedSearchSchema — top-level
// ---------------------------------------------------------------------------

describe('SavedSearchSchema', () => {
  it('parses a complete valid saved search', () => {
    const result = SavedSearchSchema.safeParse(makeSavedSearch());
    expect(result.success).toBe(true);
  });

  it('applies default alertEnabled=false', () => {
    const input = makeSavedSearch();
    delete (input as Record<string, unknown>)['alertEnabled'];
    const result = SavedSearchSchema.parse(input);
    expect(result.alertEnabled).toBe(false);
  });

  it('applies default emailEnabled=true', () => {
    const input = makeSavedSearch();
    delete (input as Record<string, unknown>)['emailEnabled'];
    const result = SavedSearchSchema.parse(input);
    expect(result.emailEnabled).toBe(true);
  });

  it('applies default provider=california-parks', () => {
    const input = makeSavedSearch();
    delete (input as Record<string, unknown>)['provider'];
    const result = SavedSearchSchema.parse(input);
    expect(result.provider).toBe('california-parks');
  });

  it('rejects when name is empty string', () => {
    const result = SavedSearchSchema.safeParse(makeSavedSearch({ name: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects when both region and parkPageIds are non-empty (scope refinement)', () => {
    const result = SavedSearchSchema.safeParse(
      makeSavedSearch({ scope: { region: 'sierra', parkPageIds: ['999'] } })
    );
    expect(result.success).toBe(false);
  });

  it('accepts fixed_range date pattern', () => {
    const result = SavedSearchSchema.safeParse(
      makeSavedSearch({ datePattern: { kind: 'fixed_range', from: '2026-08-01', to: '2026-08-03' } })
    );
    expect(result.success).toBe(true);
  });
});
