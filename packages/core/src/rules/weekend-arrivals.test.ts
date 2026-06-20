import { describe, it, expect } from 'vitest';
import { weekendArrivals } from './weekend-arrivals';

describe('weekendArrivals', () => {
  // today = Thursday 2026-05-28 → next Friday = 2026-05-29, Saturday = 2026-05-30
  const TODAY = '2026-05-28';

  it('returns only Friday and Saturday arrivals', () => {
    const results = weekendArrivals(TODAY, 14, 1);
    const dows = results.map((r) => new Date(r.arrivalDate + 'T00:00:00').getDay());
    for (const dow of dows) {
      expect(dow === 5 || dow === 6).toBe(true);
    }
  });

  it('Sat arrivals are always 1N', () => {
    const results = weekendArrivals(TODAY, 14, 1);
    const satEntries = results.filter(
      (r) => new Date(r.arrivalDate + 'T00:00:00').getDay() === 6,
    );
    expect(satEntries.length).toBeGreaterThan(0);
    for (const entry of satEntries) {
      expect(entry.nights).toBe(1);
    }
  });

  it('Sat arrivals are dropped when minNights > 1', () => {
    const results = weekendArrivals(TODAY, 14, 2);
    const satEntries = results.filter(
      (r) => new Date(r.arrivalDate + 'T00:00:00').getDay() === 6,
    );
    expect(satEntries).toHaveLength(0);
  });

  it('Sat arrivals are dropped when minNights === 3', () => {
    const results = weekendArrivals(TODAY, 14, 3);
    const satEntries = results.filter(
      (r) => new Date(r.arrivalDate + 'T00:00:00').getDay() === 6,
    );
    expect(satEntries).toHaveLength(0);
  });

  it('Fri arrivals have exactly minNights nights', () => {
    const results = weekendArrivals(TODAY, 14, 2);
    const friEntries = results.filter(
      (r) => new Date(r.arrivalDate + 'T00:00:00').getDay() === 5,
    );
    expect(friEntries.length).toBeGreaterThan(0);
    for (const entry of friEntries) {
      expect(entry.nights).toBe(2);
    }
  });

  it('arrivals start from today+1 (today itself excluded)', () => {
    // today = 2026-05-28, so earliest possible arrival is 2026-05-29
    const results = weekendArrivals(TODAY, 14, 1);
    for (const r of results) {
      expect(r.arrivalDate > TODAY).toBe(true);
    }
  });

  it('arrivals stay within [today+1, today+horizonDays]', () => {
    const horizonDays = 10;
    const results = weekendArrivals(TODAY, horizonDays, 1);
    const limit = new Date(TODAY + 'T00:00:00');
    limit.setDate(limit.getDate() + horizonDays);
    const limitStr = limit.toISOString().slice(0, 10);
    for (const r of results) {
      expect(r.arrivalDate <= limitStr).toBe(true);
    }
  });

  it('respects horizon — does not include arrivals beyond horizonDays', () => {
    // With horizonDays=7, today=Thu 2026-05-28, only the first weekend (Fri 2026-05-29, Sat 2026-05-30) fits
    const results = weekendArrivals(TODAY, 7, 1);
    // Second Friday (2026-06-05) is day 8 — beyond horizon of 7
    const arrivals = results.map((r) => r.arrivalDate);
    expect(arrivals).not.toContain('2026-06-05');
    expect(arrivals).not.toContain('2026-06-06');
  });

  it('includes Friday within horizon', () => {
    const results = weekendArrivals(TODAY, 7, 1);
    const arrivals = results.map((r) => r.arrivalDate);
    expect(arrivals).toContain('2026-05-29');
  });

  it('includes Saturday within horizon', () => {
    const results = weekendArrivals(TODAY, 7, 1);
    const arrivals = results.map((r) => r.arrivalDate);
    expect(arrivals).toContain('2026-05-30');
  });

  it('returns empty when horizonDays is 0', () => {
    const results = weekendArrivals(TODAY, 0, 1);
    expect(results).toHaveLength(0);
  });

  it('handles today being a Friday — first arrival is the next Friday', () => {
    // today = Fri 2026-05-29, earliest arrival = 2026-05-30 (Sat)
    // but horizon=14 should include both Sat 2026-05-30 and the next Fri 2026-06-05
    const results = weekendArrivals('2026-05-29', 14, 1);
    const arrivals = results.map((r) => r.arrivalDate);
    expect(arrivals).not.toContain('2026-05-29'); // today excluded
    expect(arrivals).toContain('2026-05-30'); // Sat is tomorrow, within horizon
    expect(arrivals).toContain('2026-06-05'); // next Friday, day 7 — within horizon of 14
  });

  it('covers two weekends within horizonDays=14', () => {
    const results = weekendArrivals(TODAY, 14, 1);
    const arrivals = results.map((r) => r.arrivalDate);
    // Week 1
    expect(arrivals).toContain('2026-05-29');
    expect(arrivals).toContain('2026-05-30');
    // Week 2
    expect(arrivals).toContain('2026-06-05');
    expect(arrivals).toContain('2026-06-06');
  });
});
