import { describe, it, expect } from 'vitest';
import { matchCandidates } from '../src/scanner/match-candidates.js';
import { AlertSchema } from '../src/config/alerts.js';
import type { Alert } from '../src/config/alerts.js';
import type { AvailabilityWindowEntry } from '../src/cache/types.js';
import type { ScanCandidate } from '../src/types/scanner.js';

const NOW = '2026-06-10T12:00:00.000Z';

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return AlertSchema.parse({
    id: 't1',
    name: 'Angel Island Ridge',
    provider: 'california-parks',
    parkName: 'Angel Island SP',
    parkPageId: '468',
    campgroundName: 'Ridge (sites 4-6)',
    acceptableSites: ['Campsite #4', 'Campsite #5'],
    preferredSites: ['Campsite #4'],
    campingType: 'hike-in',
    people: 2,
    dateMode: 'exact_dates',
    exactStartDate: '2026-07-10',
    exactEndDate: '2026-07-12',
    minNights: 2,
    maxNights: 2,
    weekendsOnly: false,
    bookingRule: {
      type: 'rolling_months_before',
      monthsBefore: 6,
      releaseTime: '08:00',
      timezone: 'America/Los_Angeles',
    },
    ...overrides,
  });
}

function makeWindow(
  sites: Array<{ name: string; dates: Record<string, string> }>,
  overrides: Partial<AvailabilityWindowEntry> = {},
): AvailabilityWindowEntry {
  return {
    parkPageId: '468',
    parkName: 'Angel Island SP',
    windowStart: '2026-07-08',
    windowEnd: '2026-07-15',
    scannedAt: '2026-06-10T11:00:00.000Z',
    sourceUrl: 'https://www.parks.ca.gov/AvailabilityInfo?page_id=468',
    campgrounds: [
      {
        id: 'cg1',
        name: 'Ridge (sites 4-6)',
        bookingUrl: 'https://reservecalifornia.com/book/ridge',
        sites: sites as AvailabilityWindowEntry['campgrounds'][number]['sites'],
      },
    ],
    ...overrides,
  } as AvailabilityWindowEntry;
}

const candidate: ScanCandidate = {
  arrivalDate: '2026-07-10',
  nights: 2,
  endDate: '2026-07-12',
};

describe('matchCandidates', () => {
  it('emits a hit when an acceptable site is available for the whole stay', () => {
    const windows = [makeWindow([
      { name: 'Campsite #4', dates: { '2026-07-10': 'available', '2026-07-11': 'available' } },
    ])];
    const results = matchCandidates(makeAlert(), [candidate], windows, NOW);

    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.hits.map((h) => h.siteName)).toEqual(['Campsite #4']);
    expect(r.bookingUrl).toBe('https://reservecalifornia.com/book/ridge');
    expect(r.scannedAt).toBe(NOW);
    expect(r.availabilityAsOf).toBe('2026-06-10T11:00:00.000Z');
    expect(r.parsingNotes).toBe('cache-backed');
    expect(r.debugHtmlPath).toBe('');
  });

  it('yields no hit when one stay night is unavailable', () => {
    const windows = [makeWindow([
      { name: 'Campsite #4', dates: { '2026-07-10': 'available', '2026-07-11': 'unavailable' } },
    ])];
    const results = matchCandidates(makeAlert(), [candidate], windows, NOW);
    expect(results[0]!.hits).toEqual([]);
  });

  it('matches stays spanning two windows and reports the oldest scannedAt', () => {
    const w1 = makeWindow(
      [{ name: 'Campsite #4', dates: { '2026-07-10': 'available' } }],
      { windowStart: '2026-07-04', windowEnd: '2026-07-10', scannedAt: '2026-06-10T09:00:00.000Z' },
    );
    const w2 = makeWindow(
      [{ name: 'Campsite #4', dates: { '2026-07-11': 'available' } }],
      { windowStart: '2026-07-11', windowEnd: '2026-07-18', scannedAt: '2026-06-10T11:30:00.000Z' },
    );
    const results = matchCandidates(makeAlert(), [candidate], [w1, w2], NOW);
    expect(results[0]!.hits.map((h) => h.siteName)).toEqual(['Campsite #4']);
    expect(results[0]!.availabilityAsOf).toBe('2026-06-10T09:00:00.000Z');
  });

  it('ignores available sites not in acceptableSites', () => {
    const windows = [makeWindow([
      { name: 'Campsite #6', dates: { '2026-07-10': 'available', '2026-07-11': 'available' } },
    ])];
    const results = matchCandidates(makeAlert(), [candidate], windows, NOW);
    expect(results[0]!.hits).toEqual([]);
  });

  it('yields no hits when the campground name does not match', () => {
    const windows = [makeWindow([
      { name: 'Campsite #4', dates: { '2026-07-10': 'available', '2026-07-11': 'available' } },
    ])];
    const alert = makeAlert({ campgroundName: 'Sunrise (sites 7-9)' });
    const results = matchCandidates(alert, [candidate], windows, NOW);
    expect(results[0]!.hits).toEqual([]);
  });

  it('never emits walk-up sites as hits', () => {
    const windows = [makeWindow([
      { name: 'Hike/Bike Campsite #HB1', dates: { '2026-07-10': 'available', '2026-07-11': 'available' } },
    ])];
    const alert = makeAlert({ acceptableSites: ['Hike/Bike Campsite #HB1'] });
    const results = matchCandidates(alert, [candidate], windows, NOW);
    expect(results[0]!.hits).toEqual([]);
  });

  it('returns empty-hit results (not errors) when the park has no cached windows', () => {
    const results = matchCandidates(makeAlert(), [candidate], [], NOW);
    expect(results).toHaveLength(1);
    expect(results[0]!.hits).toEqual([]);
    expect(results[0]!.availabilityAsOf).toBeUndefined();
  });
});
