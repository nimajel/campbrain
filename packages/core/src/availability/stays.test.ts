import { describe, it, expect } from 'vitest';
import { siteMatchesMinStay } from './stays';

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

import { firstMatchingArrival } from './stays';

describe('firstMatchingArrival', () => {
  it('returns the first valid arrival date', () => {
    expect(firstMatchingArrival(['2026-06-12', '2026-06-13', '2026-06-14'], { minNights: 2 }))
      .toBe('2026-06-12');
  });
  it('skips arrivals whose stay would exceed `to`', () => {
    expect(firstMatchingArrival(['2026-06-14', '2026-06-15'], { minNights: 2, to: '2026-06-14' }))
      .toBeNull();
  });
  it('honors weekendsOnly arrival DOW', () => {
    expect(firstMatchingArrival(['2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13'], { minNights: 2, weekendsOnly: true }))
      .toBe('2026-06-12');
  });
  it('returns null when no window fits', () => {
    expect(firstMatchingArrival(['2026-06-12', '2026-06-15'], { minNights: 2 })).toBeNull();
  });
});

import { getAvailableSitesForStay } from './stays';
import type { AvailabilityWindowEntry } from './types';

describe('getAvailableSitesForStay', () => {
  const makeWindow = (windowStart: string, windowEnd: string): AvailabilityWindowEntry => ({
    parkPageId: 'park-1',
    parkName: 'Test Park',
    windowStart,
    windowEnd,
    scannedAt: new Date().toISOString(),
    sourceUrl: 'https://example.com',
    campgrounds: [
      {
        id: 'cg-1',
        name: 'Main Campground',
        nightlyFee: 35,
        bookingUrl: 'https://reservecalifornia.com/test',
        sites: [
          {
            name: 'Site A',
            dates: {
              '2026-07-10': 'available',
              '2026-07-11': 'available',
              '2026-07-12': 'available',
            },
          },
          {
            name: 'Site B',
            dates: {
              '2026-07-10': 'available',
              '2026-07-11': 'unavailable',
              '2026-07-12': 'available',
            },
          },
        ],
      },
    ],
  });

  it('returns only sites available on ALL required nights for a 2-night stay', () => {
    const windows = [makeWindow('2026-07-09', '2026-07-16')];
    const results = getAvailableSitesForStay(windows, '2026-07-10', 2);
    expect(results).toHaveLength(1);
    const cg = results[0]!;
    expect(cg.campgroundName).toBe('Main Campground');
    // Site A is available on both 07-10 and 07-11; Site B is unavailable on 07-11
    expect(cg.availableSites).toEqual(['Site A']);
  });

  it('returns [] when required dates fall outside every window', () => {
    const windows = [makeWindow('2026-07-09', '2026-07-16')];
    // Arrival 2026-08-01 is outside the window [07-09, 07-16]
    const results = getAvailableSitesForStay(windows, '2026-08-01', 2);
    expect(results).toEqual([]);
  });

  it('merges site dates across overlapping windows for the same campground', () => {
    // Two windows covering different parts of the stay
    const w1: AvailabilityWindowEntry = {
      parkPageId: 'park-1',
      parkName: 'Test Park',
      windowStart: '2026-07-10',
      windowEnd: '2026-07-17',
      scannedAt: new Date().toISOString(),
      sourceUrl: 'https://example.com',
      campgrounds: [
        {
          id: 'cg-1',
          name: 'Main Campground',
          sites: [{ name: 'Site A', dates: { '2026-07-10': 'available' } }],
        },
      ],
    };
    const w2: AvailabilityWindowEntry = {
      parkPageId: 'park-1',
      parkName: 'Test Park',
      windowStart: '2026-07-11',
      windowEnd: '2026-07-18',
      scannedAt: new Date().toISOString(),
      sourceUrl: 'https://example.com',
      campgrounds: [
        {
          id: 'cg-1',
          name: 'Main Campground',
          sites: [{ name: 'Site A', dates: { '2026-07-11': 'available' } }],
        },
      ],
    };
    const results = getAvailableSitesForStay([w1, w2], '2026-07-10', 2);
    expect(results).toHaveLength(1);
    // After merging, Site A has both 07-10 and 07-11 as available
    expect(results[0]!.availableSites).toEqual(['Site A']);
  });
});
