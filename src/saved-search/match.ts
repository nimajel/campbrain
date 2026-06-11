import dayjs from 'dayjs';
import { weekendArrivals } from '../rules/weekend-arrivals.js';
import { oldestCoveringScan } from '../cache/freshness.js';
import type { SavedSearch } from './types.js';
import type { AvailabilityWindowEntry } from '../cache/types.js';
import type {
  searchAvailableStays,
  getEntriesForPark,
  SearchParkResult,
} from '../cache/availability-cache.js';

export type { SavedSearch };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StayWindow {
  from: string;   // YYYY-MM-DD arrival
  to: string;     // YYYY-MM-DD departure (from + nights)
  nights: number;
}

export interface SavedSearchOpening {
  savedSearchId: string;
  parkPageId: string;
  parkName: string;
  campgroundName: string;
  siteName: string;
  arrivalDate: string;       // YYYY-MM-DD
  departureDate: string;     // arrival + nights
  nights: number;
  bookingUrl: string | null;
  availabilityAsOf?: string; // oldest covering-window scannedAt
}

type Region = NonNullable<SavedSearch['scope']['region']>;

export interface MatchDeps {
  searchAvailableStays: typeof searchAvailableStays;
  parkRegionOf: (parkPageId: string) => Region | null;
  getEntriesForPark: typeof getEntriesForPark;
}

// ---------------------------------------------------------------------------
// expandStayWindows
// ---------------------------------------------------------------------------

export function expandStayWindows(search: SavedSearch, today: string): StayWindow[] {
  const { datePattern, filters } = search;
  const minNights = filters.minNights;

  if (datePattern.kind === 'fixed_range') {
    const { from, to } = datePattern;
    const windows: StayWindow[] = [];
    let arrival = dayjs(from);
    const lastArrival = dayjs(to).subtract(minNights, 'day');

    while (!arrival.isAfter(lastArrival)) {
      const departure = arrival.add(minNights, 'day');
      windows.push({
        from: arrival.format('YYYY-MM-DD'),
        to: departure.format('YYYY-MM-DD'),
        nights: minNights,
      });
      arrival = arrival.add(1, 'day');
    }

    return windows;
  }

  // any_weekend
  const { horizonDays } = datePattern;
  const arrivals = weekendArrivals(today, horizonDays, minNights);

  return arrivals.map((a) => {
    const departure = dayjs(a.arrivalDate).add(a.nights, 'day');
    return {
      from: a.arrivalDate,
      to: departure.format('YYYY-MM-DD'),
      nights: a.nights,
    };
  });
}

// ---------------------------------------------------------------------------
// matchSavedSearch
// ---------------------------------------------------------------------------

function parkPassesScope(
  parkPageId: string,
  scope: SavedSearch['scope'],
  parkRegionOf: (parkPageId: string) => Region | null,
): boolean {
  if (scope.parkPageIds.length > 0) {
    return scope.parkPageIds.includes(parkPageId);
  }
  if (scope.region === null) return true;
  return parkRegionOf(parkPageId) === scope.region;
}

function stayDates(window: StayWindow): string[] {
  const dates: string[] = [];
  let cur = dayjs(window.from);
  const last = dayjs(window.to).subtract(1, 'day');
  while (!cur.isAfter(last)) {
    dates.push(cur.format('YYYY-MM-DD'));
    cur = cur.add(1, 'day');
  }
  return dates;
}

export async function matchSavedSearch(
  search: SavedSearch,
  deps: MatchDeps,
  today: string,
): Promise<SavedSearchOpening[]> {
  const windows = expandStayWindows(search, today);
  if (windows.length === 0) return [];

  const { searchAvailableStays: searchStays, parkRegionOf, getEntriesForPark } = deps;
  const { filters, scope } = search;

  // Memo: at most one getEntriesForPark call per parkPageId per invocation.
  const entriesCache = new Map<string, Promise<AvailabilityWindowEntry[]>>();
  function cachedGetEntries(parkPageId: string): Promise<AvailabilityWindowEntry[]> {
    if (!entriesCache.has(parkPageId)) {
      entriesCache.set(parkPageId, getEntriesForPark(parkPageId));
    }
    return entriesCache.get(parkPageId)!;
  }

  const openings: SavedSearchOpening[] = [];

  for (const window of windows) {
    const searchParams: Parameters<typeof searchStays>[0] = {
      from: window.from,
      to: window.to,
    };
    if (filters.access.length > 0) searchParams.access = filters.access;
    if (filters.kinds.length > 0) searchParams.kinds = filters.kinds;
    if (filters.hide.length > 0) searchParams.hide = filters.hide;

    const parkResults: SearchParkResult[] = await searchStays(searchParams);

    for (const park of parkResults) {
      if (!parkPassesScope(park.parkPageId, scope, parkRegionOf)) continue;

      const dates = stayDates(window);
      const entries: AvailabilityWindowEntry[] = await cachedGetEntries(park.parkPageId);
      const availabilityAsOf = oldestCoveringScan(entries, dates);

      for (const cg of park.campgrounds) {
        for (const siteName of cg.availableSites) {
          const opening: SavedSearchOpening = {
            savedSearchId: search.id,
            parkPageId: park.parkPageId,
            parkName: park.parkName,
            campgroundName: cg.name,
            siteName,
            arrivalDate: window.from,
            departureDate: window.to,
            nights: window.nights,
            bookingUrl: cg.bookingUrl ?? null,
          };
          if (availabilityAsOf !== undefined) {
            opening.availabilityAsOf = availabilityAsOf;
          }
          openings.push(opening);
        }
        // walkUpSites are intentionally excluded
      }
    }
  }

  return openings;
}
