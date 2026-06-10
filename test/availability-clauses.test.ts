import { describe, it, expect } from 'vitest';
import { buildAvailabilityClauses } from '../src/cache/availability-cache.js';

describe('buildAvailabilityClauses', () => {
  it('always includes the status and current-date clauses', () => {
    const { clauses, params } = buildAvailabilityClauses();
    expect(clauses).toContain("a.status = 'available'");
    expect(clauses).toContain('a.date >= CURRENT_DATE');
    expect(params).toEqual([]);
  });

  it('adds from/to as ordered parameters', () => {
    const { clauses, params } = buildAvailabilityClauses('2026-07-01', '2026-07-14');
    expect(clauses).toContain('a.date >= $1');
    expect(clauses).toContain('a.date <= $2');
    expect(params).toEqual(['2026-07-01', '2026-07-14']);
  });

  it('adds the weekend arrival clause when weekendsOnly', () => {
    const { clauses } = buildAvailabilityClauses(null, null, [], true);
    expect(clauses).toContain('EXTRACT(DOW FROM a.date)::int IN (5, 6)');
  });

  it('translates exclude filters into NOT regex clauses', () => {
    const { clauses } = buildAvailabilityClauses(null, null, ['exclude_group']);
    expect(clauses.some((c) => c.startsWith('NOT (') && c.includes('group'))).toBe(true);
  });

  it('applies hike_in_only as a positive match', () => {
    const { clauses } = buildAvailabilityClauses(null, null, ['hike_in_only']);
    expect(clauses.some((c) => !c.startsWith('NOT') && c.includes('hike.in'))).toBe(true);
  });

  it('ignores unknown filter ids', () => {
    const base = buildAvailabilityClauses().clauses.length;
    expect(buildAvailabilityClauses(null, null, ['bogus']).clauses.length).toBe(base);
  });

  it('flags exclude_walk_up without adding a clause', () => {
    const base = buildAvailabilityClauses().clauses.length;
    const result = buildAvailabilityClauses(null, null, ['exclude_walk_up']);
    expect(result.excludeWalkUp).toBe(true);
    expect(result.clauses.length).toBe(base);
    expect(buildAvailabilityClauses().excludeWalkUp).toBe(false);
  });
});
