import { describe, it, expect } from 'vitest';
import { siteMatchesMinStay } from '../src/cache/availability-cache.js';

const opts = (o: Partial<Parameters<typeof siteMatchesMinStay>[1]> = {}) => ({
  minNights: 2 as 1 | 2 | 3,
  from: '2026-06-01',
  to: '2026-06-30',
  weekendsOnly: false,
  ...o,
});

describe('siteMatchesMinStay', () => {
  it('matches a 2-night island inside the window', () => {
    expect(siteMatchesMinStay(['2026-06-05', '2026-06-06'], opts())).toBe(true);
  });
  it('rejects a single isolated night when minNights=2', () => {
    expect(siteMatchesMinStay(['2026-06-05', '2026-06-08'], opts())).toBe(false);
  });
  it('requires the whole stay to end on/before `to`', () => {
    // arrival 06-30 needs 07-01 too — out of window
    expect(siteMatchesMinStay(['2026-06-30', '2026-07-01'], opts({ to: '2026-06-30' }))).toBe(false);
  });
  it('requires the arrival to be on/after `from`', () => {
    expect(siteMatchesMinStay(['2026-05-31', '2026-06-01'], opts({ from: '2026-06-01' }))).toBe(false);
  });
  it('weekendsOnly requires a Fri or Sat arrival', () => {
    // 2026-06-05 is a Friday
    expect(siteMatchesMinStay(['2026-06-05', '2026-06-06'], opts({ weekendsOnly: true }))).toBe(true);
    // 2026-06-09 is a Tuesday — island exists but not a weekend arrival
    expect(siteMatchesMinStay(['2026-06-09', '2026-06-10'], opts({ weekendsOnly: true }))).toBe(false);
  });
  it('finds a 3-night island and rejects a 2-night gap for minNights=3', () => {
    const dates = ['2026-06-12', '2026-06-13', '2026-06-14']; // Fri,Sat,Sun
    expect(siteMatchesMinStay(dates, opts({ minNights: 3, weekendsOnly: true }))).toBe(true);
    expect(siteMatchesMinStay(['2026-06-12', '2026-06-13'], opts({ minNights: 3 }))).toBe(false);
  });
  it('dedupes duplicate dates (overlapping scan windows) before island detection', () => {
    expect(siteMatchesMinStay(['2026-06-05', '2026-06-05', '2026-06-06'], opts())).toBe(true);
  });
});
