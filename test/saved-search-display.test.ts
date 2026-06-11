import { describe, it, expect } from 'vitest';
import {
  scopeSummary,
  datePatternSummary,
  suggestSearchName,
  buildRunUrl,
} from '../web/lib/saved-search-display.js';
import type { SavedSearch } from '../src/saved-search/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSearch(overrides: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: 'test-id',
    userId: null,
    provider: 'california-parks',
    name: 'Test',
    scope: { region: null, parkPageIds: [] },
    datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-07' },
    filters: { access: [], kinds: [], hide: [], minNights: 1 },
    alertEnabled: false,
    emailEnabled: true,
    createdAt: '2026-06-10T00:00:00Z',
    updatedAt: '2026-06-10T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scopeSummary
// ---------------------------------------------------------------------------

describe('scopeSummary', () => {
  it('returns region label when region is set', () => {
    expect(scopeSummary({ region: 'bay-area', parkPageIds: [] })).toBe('Bay Area');
  });

  it('returns park count when parkPageIds are set', () => {
    expect(scopeSummary({ region: null, parkPageIds: ['a', 'b', 'c'] })).toBe('3 parks');
  });

  it('returns singular park count for 1 park', () => {
    expect(scopeSummary({ region: null, parkPageIds: ['a'] })).toBe('1 park');
  });

  it('returns "All parks" when both are empty', () => {
    expect(scopeSummary({ region: null, parkPageIds: [] })).toBe('All parks');
  });
});

// ---------------------------------------------------------------------------
// datePatternSummary
// ---------------------------------------------------------------------------

describe('datePatternSummary', () => {
  it('formats fixed_range', () => {
    const result = datePatternSummary({ kind: 'fixed_range', from: '2026-07-01', to: '2026-07-07' });
    expect(result).toContain('Jul');
  });

  it('formats any_weekend with horizon', () => {
    const result = datePatternSummary({ kind: 'any_weekend', horizonDays: 90 });
    expect(result).toBe('Any weekend, next 90 days');
  });
});

// ---------------------------------------------------------------------------
// suggestSearchName
// ---------------------------------------------------------------------------

describe('suggestSearchName', () => {
  it('includes region label when region provided', () => {
    const name = suggestSearchName('bay-area', '2026-07-01', '2026-07-07');
    expect(name).toContain('Bay Area');
    expect(name).toContain('Jul');
  });

  it('returns just the date range when no region', () => {
    const name = suggestSearchName(null, '2026-07-01', '2026-07-07');
    expect(name).toContain('Jul');
    expect(name).not.toContain('Bay Area');
  });

  it('returns fallback when no date', () => {
    expect(suggestSearchName(null, '', '')).toBe('My search');
    expect(suggestSearchName('bay-area', '', '')).toBe('Bay Area');
  });
});

// ---------------------------------------------------------------------------
// buildRunUrl
// ---------------------------------------------------------------------------

describe('buildRunUrl', () => {
  it('builds /explore URL for fixed_range', () => {
    const url = buildRunUrl(makeSearch());
    expect(url).toMatch(/^\/explore\?/);
    expect(url).toContain('from=2026-07-01');
    expect(url).toContain('to=2026-07-07');
    expect(url).toContain('savedSearch=test-id');
  });

  it('builds /map URL for any_weekend', () => {
    const url = buildRunUrl(
      makeSearch({ datePattern: { kind: 'any_weekend', horizonDays: 60 } })
    );
    expect(url).toMatch(/^\/map\?/);
    expect(url).toContain('weekendsOnly=true');
    expect(url).toContain('savedSearch=test-id');
  });

  it('includes region param when scope has region', () => {
    const url = buildRunUrl(makeSearch({ scope: { region: 'sierra', parkPageIds: [] } }));
    expect(url).toContain('region=sierra');
  });

  it('includes minNights param only when > 1', () => {
    const urlDefault = buildRunUrl(makeSearch());
    expect(urlDefault).not.toContain('minNights');

    const urlWith = buildRunUrl(
      makeSearch({ filters: { access: [], kinds: [], hide: [], minNights: 2 } })
    );
    expect(urlWith).toContain('minNights=2');
  });

  it('includes taxonomy filter params', () => {
    const url = buildRunUrl(
      makeSearch({
        filters: { access: ['hike_in'], kinds: ['tent'], hide: ['group'], minNights: 1 },
      })
    );
    expect(url).toContain('access=hike_in');
    expect(url).toContain('kinds=tent');
    expect(url).toContain('hide=group');
  });
});
