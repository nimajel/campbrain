// ---------------------------------------------------------------------------
// Site filters — pure name-pattern logic, usable anywhere in the app
// ---------------------------------------------------------------------------
// All data relies on site/campground name text since the catalog currently
// does not populate type, capacity, or attributes fields.

export interface SiteFilter {
  id: string;
  label: string;
  description: string;
  /** Return true to KEEP the site, false to exclude it */
  test: (siteName: string, campgroundName: string) => boolean;
}

/**
 * True for sites that are walk-up / first-come-first-served only and therefore
 * cannot be reserved online (e.g. CA State Parks "Hike/Bike" sites). These show
 * as "Available" on the parks.ca.gov grid but are NOT bookable on ReserveCalifornia,
 * so they must never count toward bookable availability.
 */
export function isWalkUpSite(siteName: string, campgroundName = ''): boolean {
  return /\bhike\s*[/&]?\s*bike\b/i.test(`${siteName} ${campgroundName}`);
}

export const AVAILABLE_FILTERS: SiteFilter[] = [
  {
    id: 'exclude_group',
    label: 'Exclude group sites',
    description: 'Hide group campgrounds, group tent sites, and group picnic areas',
    test: (site, cg) => !/\bgroup\b/i.test(`${site} ${cg}`),
  },
  {
    id: 'exclude_walk_up',
    label: 'Exclude walk-up sites',
    description: 'Hide walk-up / first-come hike-bike sites that cannot be reserved online',
    test: (site, cg) => !isWalkUpSite(site, cg),
  },
  {
    id: 'exclude_day_use',
    label: 'Exclude day-use & picnic areas',
    description: 'Hide day-use facilities, picnic areas, and non-overnight sites',
    test: (site, cg) => !/\b(day.?use|dailyuse|picnic)\b/i.test(`${site} ${cg}`),
  },
  {
    id: 'hike_in_only',
    label: 'Hike-in sites only',
    description: 'Show only sites labelled as hike-in or walk-in',
    test: (site, cg) => /\b(hike.?in|walk.?in)\b/i.test(`${site} ${cg}`),
  },
  {
    id: 'exclude_equestrian',
    label: 'Exclude equestrian sites',
    description: 'Hide sites intended for equestrian use',
    test: (site, cg) => !/\b(equestrian|horse)\b/i.test(`${site} ${cg}`),
  },
];

export function getFilter(id: string): SiteFilter | undefined {
  return AVAILABLE_FILTERS.find((f) => f.id === id);
}

/**
 * Returns true if the site passes all active filters (should be shown).
 * An empty activeFilterIds array means no filtering — all sites pass.
 */
export function passesSiteFilters(
  siteName: string,
  campgroundName: string,
  activeFilterIds: string[]
): boolean {
  if (activeFilterIds.length === 0) return true;
  return activeFilterIds.every((id) => {
    const filter = getFilter(id);
    return filter ? filter.test(siteName, campgroundName) : true;
  });
}

/**
 * Returns true if any site in the campground name passes filters.
 * Used to decide whether to show the campground row at all.
 */
export function campgroundPassesFilters(
  campgroundName: string,
  activeFilterIds: string[]
): boolean {
  if (activeFilterIds.length === 0) return true;
  // A campground passes if at least one hypothetical site would pass.
  // Since we don't have site-level data at the campground-header stage,
  // we test the campground name itself as if it were a site.
  return passesSiteFilters(campgroundName, campgroundName, activeFilterIds);
}
