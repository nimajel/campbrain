import { describe, it, expect } from 'vitest';
import { buildAvailabilityClauses } from '../src/cache/availability-cache.js';

describe('buildAvailabilityClauses', () => {
  it('always includes status, current-date, and is_day_use guards', () => {
    const { clauses, params } = buildAvailabilityClauses({});
    expect(clauses).toContain("a.status = 'available'");
    expect(clauses).toContain('a.date >= CURRENT_DATE');
    expect(clauses).toContain('s.is_day_use = false');
    expect(params).toEqual([]);
  });

  it('adds from/to as ordered parameters', () => {
    const { clauses, params } = buildAvailabilityClauses({ from: '2026-07-01', to: '2026-07-14' });
    expect(clauses).toContain('a.date >= $1');
    expect(clauses).toContain('a.date <= $2');
    expect(params).toEqual(['2026-07-01', '2026-07-14']);
  });

  it('puts the weekend DOW clause in dowClauses, not clauses', () => {
    const { clauses, dowClauses } = buildAvailabilityClauses({ weekendsOnly: true });
    expect(dowClauses).toContain('EXTRACT(DOW FROM a.date)::int IN (5, 6)');
    expect(clauses).not.toContain('EXTRACT(DOW FROM a.date)::int IN (5, 6)');
  });

  it('returns empty dowClauses when weekendsOnly is false', () => {
    const { dowClauses } = buildAvailabilityClauses({});
    expect(dowClauses).toEqual([]);
  });

  it('filters access with = ANY when access values given; omits when empty', () => {
    const empty = buildAvailabilityClauses({ access: [] });
    expect(empty.clauses.some((c) => c.includes('s.access'))).toBe(false);
    const some = buildAvailabilityClauses({ access: ['hike_in', 'boat_in'] });
    expect(some.clauses.some((c) => c.includes("s.access = ANY('{hike_in,boat_in}')"))).toBe(true);
  });

  it('filters site_kind with = ANY (excludes NULL kinds by design)', () => {
    const some = buildAvailabilityClauses({ kinds: ['tent'] });
    expect(some.clauses.some((c) => c.includes("s.site_kind = ANY('{tent}')"))).toBe(true);
  });

  it('translates hide ids into NOT column clauses', () => {
    const { clauses } = buildAvailabilityClauses({ hide: ['group', 'equestrian'] });
    expect(clauses).toContain('NOT s.is_group');
    expect(clauses).toContain('NOT s.is_equestrian');
  });

  it('reports excludeWalkUp when walk_up is hidden, without a clause', () => {
    const r = buildAvailabilityClauses({ hide: ['walk_up'] });
    expect(r.excludeWalkUp).toBe(true);
    expect(r.clauses).not.toContain('NOT s.is_walk_up');
    expect(buildAvailabilityClauses({}).excludeWalkUp).toBe(false);
  });

  it('passes minNights through on the result for the caller to apply', () => {
    expect(buildAvailabilityClauses({ minNights: 2 }).minNights).toBe(2);
    expect(buildAvailabilityClauses({}).minNights).toBeUndefined();
  });
});
