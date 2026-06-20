import dayjs from 'dayjs';
import type { AvailabilityWindowEntry } from './types';

export interface MinStayOptions {
  minNights: 1 | 2 | 3;
  from?: string | null;
  to?: string | null;
  weekendsOnly?: boolean;
}

/** DOW of an ISO date: 0=Sun … 5=Fri, 6=Sat (UTC-safe, date-only). */
function isoDow(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * Earliest arrival date d (or null) where the site supports a stay of `minNights`
 * consecutive available nights with d >= from, d + minNights - 1 <= to, and
 * (when weekendsOnly) DOW(d) in {5,6}.
 * Dedupes input dates (overlapping scan windows can repeat a date).
 */
export function firstMatchingArrival(availableDates: string[], opts: MinStayOptions): string | null {
  const { minNights, from, to, weekendsOnly = false } = opts;
  const set = new Set(availableDates);
  const sorted = [...set].sort();
  for (const arrival of sorted) {
    if (from && arrival < from) continue;
    const lastNight = addDaysIso(arrival, minNights - 1);
    if (to && lastNight > to) continue;
    if (weekendsOnly) {
      const dow = isoDow(arrival);
      if (dow !== 5 && dow !== 6) continue;
    }
    let ok = true;
    for (let i = 0; i < minNights; i++) {
      if (!set.has(addDaysIso(arrival, i))) { ok = false; break; }
    }
    if (ok) return arrival;
  }
  return null;
}

/** True if the site supports at least one qualifying min-stay window. */
export function siteMatchesMinStay(availableDates: string[], opts: MinStayOptions): boolean {
  return firstMatchingArrival(availableDates, opts) !== null;
}

export interface CampgroundStayResult {
  campgroundId: string;
  campgroundName: string;
  nightlyFee?: number;
  bookingUrl?: string;
  availableSites: string[];
}

export function getAvailableSitesForStay(
  windows: AvailabilityWindowEntry[],
  arrivalDate: string,
  nights: number
): CampgroundStayResult[] {
  const requiredDates: string[] = [];
  let cur = dayjs(arrivalDate);
  for (let i = 0; i < nights; i++) {
    requiredDates.push(cur.format('YYYY-MM-DD'));
    cur = cur.add(1, 'day');
  }

  const coveringWindows = windows.filter((w) =>
    requiredDates.some((d) => d >= w.windowStart && d <= w.windowEnd)
  );
  if (coveringWindows.length === 0) return [];

  type MergedCg = {
    id: string;
    name: string;
    nightlyFee: number | undefined;
    bookingUrl: string | undefined;
    sites: Map<string, Record<string, string>>;
  };
  const cgMap = new Map<string, MergedCg>();

  for (const w of coveringWindows) {
    for (const cg of w.campgrounds) {
      if (!cgMap.has(cg.name)) {
        cgMap.set(cg.name, {
          id: cg.id,
          name: cg.name,
          nightlyFee: cg.nightlyFee,
          bookingUrl: cg.bookingUrl,
          sites: new Map(),
        });
      }
      const merged = cgMap.get(cg.name)!;
      for (const site of cg.sites) {
        const existing = merged.sites.get(site.name) ?? {};
        Object.assign(existing, site.dates);
        merged.sites.set(site.name, existing);
      }
    }
  }

  const results: CampgroundStayResult[] = [];
  for (const cg of cgMap.values()) {
    const availableSites: string[] = [];
    for (const [siteName, dateLookup] of cg.sites) {
      if (requiredDates.every((d) => dateLookup[d] === 'available')) {
        availableSites.push(siteName);
      }
    }
    const result: CampgroundStayResult = {
      campgroundId: cg.id,
      campgroundName: cg.name,
      availableSites,
    };
    if (cg.nightlyFee !== undefined) result.nightlyFee = cg.nightlyFee;
    if (cg.bookingUrl !== undefined) result.bookingUrl = cg.bookingUrl;
    results.push(result);
  }
  return results;
}
