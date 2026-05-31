// ---------------------------------------------------------------------------
// Pure query functions over AvailabilityWindowEntry data.
// No Node.js imports — safe to use in client components.
// ---------------------------------------------------------------------------

import type { AvailabilityWindowEntry } from '../../src/cache/types';

export type { AvailabilityWindowEntry };

export interface CampgroundStayResult {
  campgroundId: string;
  campgroundName: string;
  nightlyFee?: number;
  bookingUrl?: string;
  availableSites: string[];
}

/**
 * Given all window entries for a single park, returns campgrounds whose sites
 * are fully available for the requested stay (arrivalDate + nights).
 * Handles stays that cross window boundaries by merging date data.
 */
export function getAvailableSitesForStay(
  windows: AvailabilityWindowEntry[],
  arrivalDate: string,
  nights: number
): CampgroundStayResult[] {
  // Required dates: arrivalDate through arrivalDate+nights-1 (NOT checkout)
  const requiredDates = buildRequiredDates(arrivalDate, nights);

  const coveringWindows = windows.filter((w) =>
    requiredDates.some((d) => d >= w.windowStart && d <= w.windowEnd)
  );
  if (coveringWindows.length === 0) return [];

  // Merge campground data across windows (handles cross-boundary stays)
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

function buildRequiredDates(arrivalDate: string, nights: number): string[] {
  const dates: string[] = [];
  const [y, m, d] = arrivalDate.split('-').map(Number);
  const start = new Date(y!, m! - 1, d!);
  for (let i = 0; i < nights; i++) {
    const cur = new Date(start);
    cur.setDate(cur.getDate() + i);
    dates.push(cur.toISOString().slice(0, 10));
  }
  return dates;
}
