// ---------------------------------------------------------------------------
// Pure display-query logic for the /available page.
// No React, no browser APIs — safe to unit-test in Node.
// ---------------------------------------------------------------------------

import type { AvailableStay } from '../../src/cache/types.js';
import { passesSiteFilters, campgroundPassesFilters } from './site-filters.js';

export { type AvailableStay };

export function parseDateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function addDaysToIso(iso: string, n: number): string {
  const d = parseDateLocal(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isWeekendArrival(iso: string): boolean {
  const day = parseDateLocal(iso).getDay();
  return day === 5 || day === 6;
}

export type CampgroundResult = {
  id: string;
  name: string;
  nightlyFee?: number;
  bookingUrl?: string;
  nights: number;
  arrivalDate: string;
  departureDate: string;
  /** Reservable (bookable) sites only. */
  availableSites: string[];
  /** Walk-up / first-come sites — cannot be reserved online. */
  walkUpSites: string[];
};

export type ParkGroup = {
  parkName: string;
  parkPageId: string;
  campgrounds: CampgroundResult[];
  minNightlyFee?: number;
};

export type DateGroup = {
  arrivalDate: string;
  parks: ParkGroup[];
  totalAvailable: number;
};

export type Lookup = {
  byDate: Map<string, AvailableStay[]>;
  allDates: string[];
};

export function buildLookup(stays: AvailableStay[]): Lookup {
  const byDate = new Map<string, AvailableStay[]>();
  for (const s of stays) {
    let bucket = byDate.get(s.arrivalDate);
    if (!bucket) { bucket = []; byDate.set(s.arrivalDate, bucket); }
    bucket.push(s);
  }
  return { byDate, allDates: Array.from(byDate.keys()).sort() };
}

export function groupFromLookup(
  lookup: Lookup,
  opts: {
    activeFilters: string[];
    showUnavailable: boolean;
    weekendsOnly: boolean;
    nightsFilter: number | null;
    dateFrom: string;
    dateTo: string;
    limit: number;
  }
): { groups: DateGroup[]; hasMore: boolean; totalDatesChecked: number } {
  const { activeFilters, weekendsOnly, nightsFilter, dateFrom, dateTo, limit } = opts;

  const filterKey = activeFilters.join(',');
  const cgFilterCache = new Map<string, boolean>();
  function cgPasses(name: string): boolean {
    const k = `${name}::${filterKey}`;
    if (!cgFilterCache.has(k)) cgFilterCache.set(k, campgroundPassesFilters(name, activeFilters));
    return cgFilterCache.get(k)!;
  }

  const groups: DateGroup[] = [];
  let totalDatesChecked = 0;

  for (const date of lookup.allDates) {
    if (weekendsOnly && !isWeekendArrival(date)) continue;
    if (dateFrom && date < dateFrom) continue;
    if (dateTo && date > dateTo) continue;
    totalDatesChecked++;

    const bucket = lookup.byDate.get(date) ?? [];
    const dateStays = nightsFilter === null ? bucket : bucket.filter((s) => s.nights === nightsFilter);
    if (dateStays.length === 0) continue;

    const parkMap = new Map<string, ParkGroup>();
    for (const stay of dateStays) {
      if (!cgPasses(stay.campgroundName)) continue;

      const filteredSites = activeFilters.length
        ? stay.availableSites.filter((s) => passesSiteFilters(s, stay.campgroundName, activeFilters))
        : stay.availableSites;

      // Walk-up sites are shown alongside bookable ones but excluded from counts.
      // A row is only included if it has at least one bookable site.
      if (filteredSites.length === 0) continue;

      const filteredWalkUp = activeFilters.length
        ? (stay.walkUpSites ?? []).filter((s) => passesSiteFilters(s, stay.campgroundName, activeFilters))
        : (stay.walkUpSites ?? []);

      if (!parkMap.has(stay.parkPageId)) {
        parkMap.set(stay.parkPageId, {
          parkPageId: stay.parkPageId,
          parkName: stay.parkName,
          campgrounds: [],
        });
      }
      const park = parkMap.get(stay.parkPageId)!;
      if (stay.nightlyFee !== null && (park.minNightlyFee === undefined || stay.nightlyFee < park.minNightlyFee)) {
        park.minNightlyFee = stay.nightlyFee;
      }

      park.campgrounds.push({
        id: stay.campgroundName,
        name: stay.campgroundName,
        ...(stay.nightlyFee !== null && { nightlyFee: stay.nightlyFee }),
        ...(stay.bookingUrl !== null && { bookingUrl: stay.bookingUrl }),
        nights: stay.nights,
        arrivalDate: stay.arrivalDate,
        departureDate: addDaysToIso(stay.arrivalDate, stay.nights),
        availableSites: filteredSites,
        walkUpSites: filteredWalkUp,
      });
    }

    if (parkMap.size === 0) continue;

    const parkGroups = Array.from(parkMap.values()).sort((a, b) => a.parkName.localeCompare(b.parkName));
    const totalAvailable = parkGroups.reduce((n, p) => n + p.campgrounds.reduce((m, c) => m + c.availableSites.length, 0), 0);
    if (totalAvailable === 0) continue;

    groups.push({ arrivalDate: date, parks: parkGroups, totalAvailable });

    if (groups.length >= limit) {
      const remaining = lookup.allDates.filter((d) => {
        if (d <= date) return false;
        if (weekendsOnly && !isWeekendArrival(d)) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
      return { groups, hasMore: remaining.length > 0, totalDatesChecked };
    }
  }

  return { groups, hasMore: false, totalDatesChecked };
}
