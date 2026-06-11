import { describe, it, expect } from 'vitest';
import { generateScanCandidates, generateNextAvailableWeekend } from '../src/rules/scan-candidates.js';
import type { Target } from '../src/config/schemas.js';

// Minimal shared booking rule
const bookingRule = {
  type: 'rolling_months_before' as const,
  monthsBefore: 6,
  releaseTime: '08:00',
  timezone: 'America/Los_Angeles',
};

// Base target shape for overriding per test
function makeTarget(overrides: Partial<Target>): Target {
  return {
    id: 'test',
    name: 'Test Target',
    provider: 'california-parks',
    parkName: 'Test Park',
    parkPageId: '999',
    campgroundName: 'Test Campground',
    acceptableSites: ['Site A'],
    preferredSites: ['Site A'],
    campingType: 'hike-in',
    people: 2,
    dateMode: 'next_available_weekend',
    minNights: 1,
    maxNights: 2,
    weekendsOnly: true,
    bookingRule,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// exact_dates
// ---------------------------------------------------------------------------

describe('generateScanCandidates — exact_dates', () => {
  it('returns one candidate when exactStartDate and exactEndDate are set', () => {
    const target = makeTarget({
      dateMode: 'exact_dates',
      exactStartDate: '2026-08-14',
      exactEndDate: '2026-08-16',
    });
    const candidates = generateScanCandidates(target);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      arrivalDate: '2026-08-14',
      nights: 2,
      endDate: '2026-08-16',
    });
  });

  it('generates one candidate per night count when only exactStartDate is given', () => {
    const target = makeTarget({
      dateMode: 'exact_dates',
      exactStartDate: '2026-08-14',
      minNights: 1,
      maxNights: 3,
    });
    const candidates = generateScanCandidates(target);
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toMatchObject({ arrivalDate: '2026-08-14', nights: 1 });
    expect(candidates[1]).toMatchObject({ arrivalDate: '2026-08-14', nights: 2 });
    expect(candidates[2]).toMatchObject({ arrivalDate: '2026-08-14', nights: 3 });
  });

  it('returns empty when exactStartDate is missing', () => {
    const target = makeTarget({ dateMode: 'exact_dates' });
    expect(generateScanCandidates(target)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// date_range
// ---------------------------------------------------------------------------

describe('generateScanCandidates — date_range', () => {
  it('generates candidates for all days in range', () => {
    const target = makeTarget({
      dateMode: 'date_range',
      rangeStart: '2026-05-29',
      rangeEnd: '2026-05-31',
      minNights: 1,
      maxNights: 1,
      weekendsOnly: false,
    });
    const candidates = generateScanCandidates(target);
    expect(candidates).toHaveLength(3);
    expect(candidates.map((c) => c.arrivalDate)).toEqual([
      '2026-05-29',
      '2026-05-30',
      '2026-05-31',
    ]);
  });

  it('respects weekendsOnly for date_range', () => {
    // 2026-05-29 = Friday, 2026-05-30 = Saturday, 2026-05-31 = Sunday
    const target = makeTarget({
      dateMode: 'date_range',
      rangeStart: '2026-05-29',
      rangeEnd: '2026-05-31',
      minNights: 1,
      maxNights: 1,
      weekendsOnly: true,
    });
    const candidates = generateScanCandidates(target);
    // Only Friday and Saturday arrivals
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.arrivalDate)).toEqual(['2026-05-29', '2026-05-30']);
  });

  it('generates one candidate per night count in range', () => {
    const target = makeTarget({
      dateMode: 'date_range',
      rangeStart: '2026-05-29',
      rangeEnd: '2026-05-29',
      minNights: 1,
      maxNights: 2,
      weekendsOnly: false,
    });
    const candidates = generateScanCandidates(target);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ nights: 1 });
    expect(candidates[1]).toMatchObject({ nights: 2 });
  });

  it('returns empty when rangeStart or rangeEnd is missing', () => {
    const target = makeTarget({ dateMode: 'date_range' });
    expect(generateScanCandidates(target)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// weekend_range
// ---------------------------------------------------------------------------

describe('generateScanCandidates — weekend_range', () => {
  it('generates Friday and Saturday candidates within range', () => {
    // 2026-05-29 = Fri, 2026-05-30 = Sat, 2026-05-31 = Sun
    const target = makeTarget({
      dateMode: 'weekend_range',
      rangeStart: '2026-05-29',
      rangeEnd: '2026-06-01',
      minNights: 1,
      maxNights: 2,
    });
    const candidates = generateScanCandidates(target);

    const arrivals = candidates.map((c) => `${c.arrivalDate}/${c.nights}N`);
    expect(arrivals).toContain('2026-05-29/2N'); // Fri-Sun
    expect(arrivals).toContain('2026-05-29/1N'); // Fri-Sat
    expect(arrivals).toContain('2026-05-30/1N'); // Sat-Sun
    expect(arrivals).not.toContain('2026-05-31/1N'); // Sunday — not included
  });

  it('skips Saturday 1N when minNights > 1', () => {
    const target = makeTarget({
      dateMode: 'weekend_range',
      rangeStart: '2026-05-29',
      rangeEnd: '2026-05-31',
      minNights: 2,
      maxNights: 2,
    });
    const candidates = generateScanCandidates(target);
    // Only Fri 2N; Saturday 1N skipped because minNights=2
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ arrivalDate: '2026-05-29', nights: 2 });
  });

  it('returns empty when rangeStart or rangeEnd is missing', () => {
    const target = makeTarget({ dateMode: 'weekend_range' });
    expect(generateScanCandidates(target)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// next_available_weekend
// ---------------------------------------------------------------------------

describe('generateScanCandidates — next_available_weekend', () => {
  // today = Thursday 2026-05-28 → next Friday = 2026-05-29
  const TODAY = '2026-05-28';

  it('generates Fri and Sat candidates for upcoming weekends', () => {
    const target = makeTarget({
      dateMode: 'next_available_weekend',
      nextWeeksCount: 2,
      minNights: 1,
      maxNights: 2,
    });
    const candidates = generateScanCandidates(target, TODAY);
    const arrivals = candidates.map((c) => `${c.arrivalDate}/${c.nights}N`);

    expect(arrivals).toContain('2026-05-29/2N'); // week 1 Fri 2N
    expect(arrivals).toContain('2026-05-29/1N'); // week 1 Fri 1N
    expect(arrivals).toContain('2026-05-30/1N'); // week 1 Sat 1N
    expect(arrivals).toContain('2026-06-05/2N'); // week 2 Fri 2N
    expect(arrivals).toContain('2026-06-05/1N'); // week 2 Fri 1N
    expect(arrivals).toContain('2026-06-06/1N'); // week 2 Sat 1N

    expect(candidates).toHaveLength(6);
  });

  it('respects nextWeeksCount', () => {
    const target = makeTarget({
      dateMode: 'next_available_weekend',
      nextWeeksCount: 3,
      minNights: 1,
      maxNights: 1,
    });
    const candidates = generateScanCandidates(target, TODAY);
    // 3 weeks × (1 Fri 1N + 1 Sat 1N) = 6 candidates
    expect(candidates).toHaveLength(6);
  });

  it('omits Saturday when minNights > 1', () => {
    const target = makeTarget({
      dateMode: 'next_available_weekend',
      nextWeeksCount: 1,
      minNights: 2,
      maxNights: 2,
    });
    const candidates = generateScanCandidates(target, TODAY);
    // Only Fri 2N; no Saturday (1N < minNights)
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ arrivalDate: '2026-05-29', nights: 2 });
  });

  it('starts from the next day when today is already a Friday', () => {
    // today = Fri 2026-05-29 → next Friday = 2026-06-05
    const target = makeTarget({
      dateMode: 'next_available_weekend',
      nextWeeksCount: 1,
      minNights: 2,
      maxNights: 2,
    });
    const candidates = generateScanCandidates(target, '2026-05-29');
    expect(candidates[0]?.arrivalDate).toBe('2026-06-05');
  });
});

// ---------------------------------------------------------------------------
// generateNextAvailableWeekend is also exported for unit tests
// ---------------------------------------------------------------------------

describe('generateNextAvailableWeekend export', () => {
  it('is accessible as a named export', () => {
    expect(typeof generateNextAvailableWeekend).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Ordering invariant: date-primary emission
// ---------------------------------------------------------------------------

describe('generateNextAvailableWeekend — date-primary ordering', () => {
  // today = Thursday 2026-05-28 → next Friday = 2026-05-29, Saturday = 2026-05-30
  const TODAY = '2026-05-28';

  it('emits candidates[0] and candidates[1] as the SAME arrival date with nights 1 then 2', () => {
    const target = makeTarget({
      dateMode: 'next_available_weekend',
      minNights: 1,
      maxNights: 2,
      nextWeeksCount: 2,
    });
    const candidates = generateNextAvailableWeekend(target, TODAY);
    // Date-primary: first arrival date (Fri 2026-05-29) with all night variants before moving on
    expect(candidates[0]?.arrivalDate).toBe('2026-05-29');
    expect(candidates[0]?.nights).toBe(1);
    expect(candidates[1]?.arrivalDate).toBe('2026-05-29');
    expect(candidates[1]?.nights).toBe(2);
  });

  it('emits Sat 1N immediately after all Fri variants for the same weekend', () => {
    const target = makeTarget({
      dateMode: 'next_available_weekend',
      minNights: 1,
      maxNights: 2,
      nextWeeksCount: 2,
    });
    const candidates = generateNextAvailableWeekend(target, TODAY);
    // After Fri 1N and Fri 2N, next should be Sat 1N (not the next week's Fri)
    expect(candidates[2]?.arrivalDate).toBe('2026-05-30');
    expect(candidates[2]?.nights).toBe(1);
  });

  it('produces no duplicates with maxNights=4', () => {
    const target = makeTarget({
      dateMode: 'next_available_weekend',
      minNights: 1,
      maxNights: 4,
      nextWeeksCount: 1,
    });
    const candidates = generateNextAvailableWeekend(target, TODAY);
    const keys = candidates.map((c) => `${c.arrivalDate}/${c.nights}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it('emits a Fri/4N candidate when maxNights=4', () => {
    const target = makeTarget({
      dateMode: 'next_available_weekend',
      minNights: 1,
      maxNights: 4,
      nextWeeksCount: 1,
    });
    const candidates = generateNextAvailableWeekend(target, TODAY);
    const keys = candidates.map((c) => `${c.arrivalDate}/${c.nights}`);
    expect(keys).toContain('2026-05-29/4');
  });
});
