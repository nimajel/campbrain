import { describe, it, expect } from 'vitest';
import { upcomingWeekendRange } from '../web/lib/upcoming-weekend.js';

// 2026-06-09 is a Tuesday.
describe('upcomingWeekendRange', () => {
  it('mid-week (Tue) → next Fri through Mon', () => {
    expect(upcomingWeekendRange(new Date(2026, 5, 9))).toEqual({
      from: '2026-06-12', to: '2026-06-15',
    });
  });

  it('Friday → today through Mon', () => {
    expect(upcomingWeekendRange(new Date(2026, 5, 12))).toEqual({
      from: '2026-06-12', to: '2026-06-15',
    });
  });

  it('Saturday → today through Mon (weekend in progress)', () => {
    expect(upcomingWeekendRange(new Date(2026, 5, 13))).toEqual({
      from: '2026-06-13', to: '2026-06-15',
    });
  });

  it('Sunday → next Fri through Mon', () => {
    expect(upcomingWeekendRange(new Date(2026, 5, 14))).toEqual({
      from: '2026-06-19', to: '2026-06-22',
    });
  });

  it('Monday → upcoming Fri through Mon', () => {
    expect(upcomingWeekendRange(new Date(2026, 5, 15))).toEqual({
      from: '2026-06-19', to: '2026-06-22',
    });
  });

  it('formats single-digit months/days with leading zeros', () => {
    // 2027-01-05 is a Tuesday → Fri 2027-01-08
    expect(upcomingWeekendRange(new Date(2027, 0, 5))).toEqual({
      from: '2027-01-08', to: '2027-01-11',
    });
  });
});
