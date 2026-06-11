import { describe, it, expect, vi } from 'vitest';
import { expandStayWindows, matchSavedSearch } from '../src/saved-search/match.js';
import type { SavedSearch, SavedSearchOpening } from '../src/saved-search/match.js';
import type { AvailabilityWindowEntry } from '../src/cache/types.js';
import type { SearchParkResult } from '../src/cache/availability-cache.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSearch(overrides: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: 'search-1',
    userId: null,
    provider: 'california-parks',
    name: 'Test Search',
    scope: { region: null, parkPageIds: [] },
    datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-05' },
    filters: { access: [], kinds: [], hide: [], minNights: 1 },
    alertEnabled: false,
    emailEnabled: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeWindow(
  windowStart: string,
  windowEnd: string,
  scannedAt = '2026-06-01T00:00:00.000Z',
): AvailabilityWindowEntry {
  return {
    parkPageId: 'park-1',
    parkName: 'Test Park',
    windowStart,
    windowEnd,
    scannedAt,
    sourceUrl: 'https://example.com',
    campgrounds: [],
  };
}

const emptySearchAvailableStays = vi.fn(async () => []);
const emptyParkRegionOf = vi.fn(() => null);
const emptyGetEntriesForPark = vi.fn(async () => []);

// ---------------------------------------------------------------------------
// expandStayWindows — fixed_range
// ---------------------------------------------------------------------------

describe('expandStayWindows — fixed_range', () => {
  it('minNights=1: produces an arrival for each night in [from, to-1]', () => {
    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-04' },
      filters: { access: [], kinds: [], hide: [], minNights: 1 },
    });
    const windows = expandStayWindows(search, '2026-06-10');
    const arrivals = windows.map((w) => w.from);
    // Arrivals: 07-01, 07-02, 07-03 (last departs 07-04 = to, exactly fits 1N)
    expect(arrivals).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    for (const w of windows) {
      expect(w.nights).toBe(1);
    }
  });

  it('minNights=2: last arrival is to-2 (departure of last window = to)', () => {
    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-04' },
      filters: { access: [], kinds: [], hide: [], minNights: 2 },
    });
    const windows = expandStayWindows(search, '2026-06-10');
    const arrivals = windows.map((w) => w.from);
    // Arrivals: 07-01 (departs 07-03), 07-02 (departs 07-04 = to)
    expect(arrivals).toEqual(['2026-07-01', '2026-07-02']);
    for (const w of windows) {
      expect(w.nights).toBe(2);
    }
    // Last window departs exactly on 'to'
    const lastWindow = windows[windows.length - 1]!;
    expect(lastWindow.to).toBe('2026-07-04');
  });

  it('minNights=3: arrivals 07-01 and 07-02 for from=07-01 to=07-04', () => {
    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-04' },
      filters: { access: [], kinds: [], hide: [], minNights: 3 },
    });
    const windows = expandStayWindows(search, '2026-06-10');
    const arrivals = windows.map((w) => w.from);
    // from=07-01 to=07-04, minNights=3: 07-01 departs 07-04 (ok), 07-02 departs 07-05 > to (excluded)
    expect(arrivals).toEqual(['2026-07-01']);
    for (const w of windows) {
      expect(w.nights).toBe(3);
    }
  });

  it('minNights=2 with exactly 2-night range produces one window', () => {
    // from=2026-07-01 to=2026-07-03, minNights=2 → arrival 07-01 only (departs 07-03 = to)
    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-03' },
      filters: { access: [], kinds: [], hide: [], minNights: 2 },
    });
    const windows = expandStayWindows(search, '2026-06-10');
    expect(windows).toHaveLength(1);
    expect(windows[0]?.from).toBe('2026-07-01');
    expect(windows[0]?.to).toBe('2026-07-03');
    expect(windows[0]?.nights).toBe(2);
  });

  it('returns empty when range is too short for minNights', () => {
    // from=2026-07-01 to=2026-07-02 minNights=3 → no room
    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-02' },
      filters: { access: [], kinds: [], hide: [], minNights: 3 },
    });
    const windows = expandStayWindows(search, '2026-06-10');
    expect(windows).toHaveLength(0);
  });

  it('each window.to = window.from + nights days', () => {
    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-05' },
      filters: { access: [], kinds: [], hide: [], minNights: 2 },
    });
    const windows = expandStayWindows(search, '2026-06-10');
    for (const w of windows) {
      const departure = new Date(w.from + 'T00:00:00Z');
      departure.setUTCDate(departure.getUTCDate() + w.nights);
      expect(w.to).toBe(departure.toISOString().slice(0, 10));
    }
  });
});

// ---------------------------------------------------------------------------
// expandStayWindows — any_weekend
// ---------------------------------------------------------------------------

describe('expandStayWindows — any_weekend', () => {
  // today = Thursday 2026-05-28
  const today = '2026-05-28';

  it('yields only Friday and Saturday arrivals', () => {
    const search = makeSearch({
      datePattern: { kind: 'any_weekend', horizonDays: 30 },
      filters: { access: [], kinds: [], hide: [], minNights: 1 },
    });
    const windows = expandStayWindows(search, today);
    for (const w of windows) {
      const dow = new Date(w.from + 'T00:00:00').getDay();
      expect(dow === 5 || dow === 6).toBe(true);
    }
  });

  it('Sat arrivals are dropped when minNights > 1', () => {
    const search = makeSearch({
      datePattern: { kind: 'any_weekend', horizonDays: 30 },
      filters: { access: [], kinds: [], hide: [], minNights: 2 },
    });
    const windows = expandStayWindows(search, today);
    const satArrivals = windows.filter(
      (w) => new Date(w.from + 'T00:00:00').getDay() === 6,
    );
    expect(satArrivals).toHaveLength(0);
  });

  it('stays within horizon (horizonDays=14)', () => {
    const search = makeSearch({
      datePattern: { kind: 'any_weekend', horizonDays: 14 },
      filters: { access: [], kinds: [], hide: [], minNights: 1 },
    });
    const windows = expandStayWindows(search, today);
    const arrivals = windows.map((w) => w.from);
    // today+14 = 2026-06-11; no arrival should be beyond that
    for (const a of arrivals) {
      expect(a <= '2026-06-11').toBe(true);
    }
    // Second weekend (2026-06-05 Fri, 2026-06-06 Sat) is within 14 days
    expect(arrivals).toContain('2026-06-05');
    expect(arrivals).toContain('2026-06-06');
    // Third weekend (2026-06-12) is beyond 14 days
    expect(arrivals).not.toContain('2026-06-12');
  });

  it('horizonDays max is 180', () => {
    const search = makeSearch({
      datePattern: { kind: 'any_weekend', horizonDays: 180 },
      filters: { access: [], kinds: [], hide: [], minNights: 1 },
    });
    const windows = expandStayWindows(search, today);
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      const horizonLimit = new Date(today + 'T00:00:00Z');
      horizonLimit.setUTCDate(horizonLimit.getUTCDate() + 180);
      expect(w.from <= horizonLimit.toISOString().slice(0, 10)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// matchSavedSearch — scope filtering
// ---------------------------------------------------------------------------

describe('matchSavedSearch — scope filtering', () => {
  function makeSearchParkResult(parkPageId: string, siteName: string, isWalkUp = false): SearchParkResult {
    return {
      parkPageId,
      parkName: `Park ${parkPageId}`,
      campgrounds: [{
        name: 'Main Campground',
        nightlyFee: 35,
        bookingUrl: `https://example.com/park/${parkPageId}`,
        availableSites: isWalkUp ? [] : [siteName],
        walkUpSites: isWalkUp ? [siteName] : [],
      }],
    };
  }

  it('returns openings for all parks when scope has no region and no parkPageIds', async () => {
    const searchFn = vi.fn(async () => [
      makeSearchParkResult('park-a', 'Site 1'),
      makeSearchParkResult('park-b', 'Site 2'),
    ]);
    const entriesFn = vi.fn(async () => []);
    const regionOf = vi.fn(() => null);

    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-02' },
      filters: { access: [], kinds: [], hide: [], minNights: 1 },
      scope: { region: null, parkPageIds: [] },
    });

    const openings = await matchSavedSearch(search, {
      searchAvailableStays: searchFn,
      parkRegionOf: regionOf,
      getEntriesForPark: entriesFn,
    }, '2026-06-10');

    const parkIds = openings.map((o) => o.parkPageId);
    expect(parkIds).toContain('park-a');
    expect(parkIds).toContain('park-b');
  });

  it('filters to region when scope.region is set', async () => {
    const searchFn = vi.fn(async () => [
      makeSearchParkResult('park-a', 'Site 1'),
      makeSearchParkResult('park-b', 'Site 2'),
    ]);
    const entriesFn = vi.fn(async () => []);
    const regionOf = vi.fn((id: string) => {
      if (id === 'park-a') return 'bay-area' as const;
      return 'sierra' as const;
    });

    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-02' },
      filters: { access: [], kinds: [], hide: [], minNights: 1 },
      scope: { region: 'bay-area', parkPageIds: [] },
    });

    const openings = await matchSavedSearch(search, {
      searchAvailableStays: searchFn,
      parkRegionOf: regionOf,
      getEntriesForPark: entriesFn,
    }, '2026-06-10');

    const parkIds = openings.map((o) => o.parkPageId);
    expect(parkIds).toContain('park-a');
    expect(parkIds).not.toContain('park-b');
  });

  it('explicit parkPageIds overrides region', async () => {
    const searchFn = vi.fn(async () => [
      makeSearchParkResult('park-a', 'Site 1'),
      makeSearchParkResult('park-b', 'Site 2'),
      makeSearchParkResult('park-c', 'Site 3'),
    ]);
    const entriesFn = vi.fn(async () => []);
    // parkRegionOf not called when parkPageIds is non-empty
    const regionOf = vi.fn(() => 'sierra' as const);

    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-02' },
      filters: { access: [], kinds: [], hide: [], minNights: 1 },
      scope: { region: null, parkPageIds: ['park-b'] },
    });

    const openings = await matchSavedSearch(search, {
      searchAvailableStays: searchFn,
      parkRegionOf: regionOf,
      getEntriesForPark: entriesFn,
    }, '2026-06-10');

    const parkIds = openings.map((o) => o.parkPageId);
    expect(parkIds).toContain('park-b');
    expect(parkIds).not.toContain('park-a');
    expect(parkIds).not.toContain('park-c');
    // regionOf should not be called when parkPageIds is non-empty
    expect(regionOf).not.toHaveBeenCalled();
  });

  it('walk-up sites never become openings', async () => {
    const searchFn = vi.fn(async () => [
      {
        parkPageId: 'park-a',
        parkName: 'Park A',
        campgrounds: [{
          name: 'Main',
          nightlyFee: null,
          bookingUrl: null,
          availableSites: ['Site 1'],
          walkUpSites: ['Hike-Bike 1', 'Hike-Bike 2'],
        }],
      } satisfies SearchParkResult,
    ]);
    const entriesFn = vi.fn(async () => []);
    const regionOf = vi.fn(() => null);

    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-02' },
      filters: { access: [], kinds: [], hide: [], minNights: 1 },
      scope: { region: null, parkPageIds: [] },
    });

    const openings = await matchSavedSearch(search, {
      searchAvailableStays: searchFn,
      parkRegionOf: regionOf,
      getEntriesForPark: entriesFn,
    }, '2026-06-10');

    const siteNames = openings.map((o) => o.siteName);
    expect(siteNames).toContain('Site 1');
    expect(siteNames).not.toContain('Hike-Bike 1');
    expect(siteNames).not.toContain('Hike-Bike 2');
  });

  it('passes access/kinds/hide from filters to searchAvailableStays', async () => {
    const searchFn = vi.fn(async () => []);
    const entriesFn = vi.fn(async () => []);
    const regionOf = vi.fn(() => null);

    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-02' },
      filters: {
        access: ['hike_in'],
        kinds: ['tent'],
        hide: ['group'],
        minNights: 1,
      },
      scope: { region: null, parkPageIds: [] },
    });

    await matchSavedSearch(search, {
      searchAvailableStays: searchFn,
      parkRegionOf: regionOf,
      getEntriesForPark: entriesFn,
    }, '2026-06-10');

    expect(searchFn).toHaveBeenCalledWith(
      expect.objectContaining({
        access: ['hike_in'],
        kinds: ['tent'],
        hide: ['group'],
      }),
    );
  });

  it('empty cache returns no openings', async () => {
    const searchFn = vi.fn(async () => []);
    const entriesFn = vi.fn(async () => []);
    const regionOf = vi.fn(() => null);

    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-02' },
      filters: { access: [], kinds: [], hide: [], minNights: 1 },
    });

    const openings = await matchSavedSearch(search, {
      searchAvailableStays: searchFn,
      parkRegionOf: regionOf,
      getEntriesForPark: entriesFn,
    }, '2026-06-10');

    expect(openings).toHaveLength(0);
  });

  it('availabilityAsOf reflects oldest covering window scannedAt', async () => {
    const searchFn = vi.fn(async () => [
      makeSearchParkResult('park-a', 'Site 1'),
    ]);

    const earlierWindow = makeWindow('2026-07-01', '2026-07-08', '2026-06-01T10:00:00.000Z');
    const laterWindow = makeWindow('2026-07-05', '2026-07-12', '2026-06-02T10:00:00.000Z');
    const entriesFn = vi.fn(async () => [earlierWindow, laterWindow]);
    const regionOf = vi.fn(() => null);

    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-02' },
      filters: { access: [], kinds: [], hide: [], minNights: 1 },
      scope: { region: null, parkPageIds: [] },
    });

    const openings = await matchSavedSearch(search, {
      searchAvailableStays: searchFn,
      parkRegionOf: regionOf,
      getEntriesForPark: entriesFn,
    }, '2026-06-10');

    expect(openings).toHaveLength(1);
    // The oldest covering window is the one scanned at 2026-06-01
    expect(openings[0]?.availabilityAsOf).toBe('2026-06-01T10:00:00.000Z');
  });

  it('availabilityAsOf is undefined when no covering windows', async () => {
    const searchFn = vi.fn(async () => [
      makeSearchParkResult('park-a', 'Site 1'),
    ]);
    // windows do not cover the stay dates
    const entriesFn = vi.fn(async () => [
      makeWindow('2026-08-01', '2026-08-08', '2026-06-01T10:00:00.000Z'),
    ]);
    const regionOf = vi.fn(() => null);

    const search = makeSearch({
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-02' },
      filters: { access: [], kinds: [], hide: [], minNights: 1 },
    });

    const openings = await matchSavedSearch(search, {
      searchAvailableStays: searchFn,
      parkRegionOf: regionOf,
      getEntriesForPark: entriesFn,
    }, '2026-06-10');

    expect(openings).toHaveLength(1);
    expect(openings[0]?.availabilityAsOf).toBeUndefined();
  });

  it('maps opening fields correctly', async () => {
    const searchFn = vi.fn(async () => [
      {
        parkPageId: 'park-a',
        parkName: 'Beautiful Park',
        campgrounds: [{
          name: 'Lakeside',
          nightlyFee: 45,
          bookingUrl: 'https://example.com/book',
          availableSites: ['Site 5'],
          walkUpSites: [],
        }],
      } satisfies SearchParkResult,
    ]);
    const entriesFn = vi.fn(async () => []);
    const regionOf = vi.fn(() => null);

    const search = makeSearch({
      id: 'my-search-id',
      datePattern: { kind: 'fixed_range', from: '2026-07-01', to: '2026-07-02' },
      filters: { access: [], kinds: [], hide: [], minNights: 1 },
    });

    const openings = await matchSavedSearch(search, {
      searchAvailableStays: searchFn,
      parkRegionOf: regionOf,
      getEntriesForPark: entriesFn,
    }, '2026-06-10');

    expect(openings).toHaveLength(1);
    const o = openings[0]!;
    expect(o.savedSearchId).toBe('my-search-id');
    expect(o.parkPageId).toBe('park-a');
    expect(o.parkName).toBe('Beautiful Park');
    expect(o.campgroundName).toBe('Lakeside');
    expect(o.siteName).toBe('Site 5');
    expect(o.arrivalDate).toBe('2026-07-01');
    expect(o.departureDate).toBe('2026-07-02');
    expect(o.nights).toBe(1);
    expect(o.bookingUrl).toBe('https://example.com/book');
  });
});
