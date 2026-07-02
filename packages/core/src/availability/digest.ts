import type { AvailabilityWindowEntry } from "./types";
import type { SiteAccess, SiteKind } from "../catalog/site-classifier";
import { classifySite } from "../catalog/site-classifier";
import { isInRange, todayIso } from "./map-transforms";
import type {
  AvailableDateCampground,
  AvailableDateEntry,
  MapAvailabilityFilters,
  ParkAvailabilityResponse,
  WeekendCampground,
  WeekendEntry,
} from "./map-transforms";

export interface SiteClassEntry {
  access: SiteAccess;
  siteKind: SiteKind | null;
  isGroup: boolean;
  isEquestrian: boolean;
  isWalkUp: boolean;
}

export function buildSiteClassMap(
  entries: AvailabilityWindowEntry[],
  parkPageId?: string,
): Record<string, SiteClassEntry> {
  const map: Record<string, SiteClassEntry> = {};
  for (const entry of entries) {
    for (const cg of entry.campgrounds) {
      for (const s of cg.sites) {
        // Passes recGovCampsiteType intentionally — parity with upsert-time
        // classification. makeTaxonomyPredicate omits it; that omission is the anomaly.
        const info = classifySite(s.name, cg.name, s.recGovCampsiteType, parkPageId);
        if (info.isDayUse) continue;
        map[s.name] = {
          access: info.access,
          siteKind: info.siteKind,
          isGroup: info.isGroup,
          isEquestrian: info.isEquestrian,
          isWalkUp: info.isWalkUp,
        };
      }
    }
  }
  return map;
}

function makePredicate(
  siteClass: Record<string, SiteClassEntry>,
  filters: MapAvailabilityFilters,
): (siteName: string) => boolean {
  const access = filters.access ?? [];
  const kinds = filters.kinds ?? [];
  const hide = filters.hide ?? [];
  return (siteName) => {
    const entry = siteClass[siteName];
    if (!entry) return false;
    if (access.length > 0 && !access.includes(entry.access)) return false;
    if (kinds.length > 0 && (entry.siteKind === null || !kinds.includes(entry.siteKind))) return false;
    if (hide.includes("group") && entry.isGroup) return false;
    if (hide.includes("equestrian") && entry.isEquestrian) return false;
    if (hide.includes("walk_up") && entry.isWalkUp) return false;
    return true;
  };
}

function filterDateCampground(
  cg: AvailableDateCampground,
  passes: (name: string) => boolean,
  hideWalkUp: boolean,
): AvailableDateCampground | null {
  const sites = cg.sites.filter(passes);
  const walkUpSites = hideWalkUp ? [] : cg.walkUpSites.filter(passes);
  if (sites.length === 0 && walkUpSites.length === 0) return null;
  return {
    ...cg,
    availableSiteCount: sites.length,
    sites,
    walkUpSites,
  };
}

/** Per-date, per-campground walk-up sites, read from the unfiltered digest's
 *  nextAvailableDates — the same dateMap source buildParkAvailability's weekend
 *  splits are derived from (map-transforms.ts:340-347). Missing date/campground
 *  is correctly empty (buildParkAvailability only keeps a date-campground when
 *  it has bookable or walk-up sites). */
function walkUpSitesForDate(
  nextAvailableDates: AvailableDateEntry[],
  date: string,
  cgName: string,
): string[] {
  const dateEntry = nextAvailableDates.find((d) => d.date === date);
  const cg = dateEntry?.campgrounds.find((c) => c.name === cgName);
  return cg?.walkUpSites ?? [];
}

function filterWeekendCampground(
  cg: WeekendCampground,
  cgName: string,
  unfilteredNextAvailableDates: AvailableDateEntry[],
  fridayDate: string,
  saturdayDate: string,
  passes: (name: string) => boolean,
  hideWalkUp: boolean,
  allowFriday: boolean,
  allowSaturday: boolean,
): WeekendCampground | null {
  const sites3Night = allowFriday ? cg.sites3Night.filter(passes) : [];
  const sites2NightFri = allowFriday ? cg.sites2NightFri.filter(passes) : [];
  const sites2NightSat = allowSaturday ? cg.sites2NightSat.filter(passes) : [];
  const sites1NightFri = allowFriday ? cg.sites1NightFri.filter(passes) : [];
  const sites1NightSat = allowSaturday ? cg.sites1NightSat.filter(passes) : [];

  // Reconstruct per-day walk-up sets (the merged WeekendCampground.walkUpSites has
  // no per-day breakdown) then gate + merge exactly as map-transforms.ts:339-347.
  const friWalkUp = allowFriday ? walkUpSitesForDate(unfilteredNextAvailableDates, fridayDate, cgName) : [];
  const satWalkUp = allowSaturday ? walkUpSitesForDate(unfilteredNextAvailableDates, saturdayDate, cgName) : [];
  const walkUpSites = hideWalkUp
    ? []
    : [...new Set([...friWalkUp, ...satWalkUp].filter(passes))].sort();

  if (sites1NightFri.length === 0 && sites1NightSat.length === 0 && walkUpSites.length === 0) {
    return null;
  }

  return {
    ...cg,
    sites3Night,
    sites2NightFri,
    sites2NightSat,
    sites1NightFri,
    sites1NightSat,
    walkUpSites,
  };
}

export function filterDigest(
  digest: ParkAvailabilityResponse,
  siteClass: Record<string, SiteClassEntry>,
  filters: MapAvailabilityFilters,
  now: Date = new Date(),
): ParkAvailabilityResponse {
  const passes = makePredicate(siteClass, filters);
  const hideWalkUp = (filters.hide ?? []).includes("walk_up");

  const today = todayIso(now);
  const from = filters.from ?? null;
  const to = filters.to ?? null;
  const rangeStart = from && from > today ? from : today;

  // earliestAvailableDate mirrors buildParkAvailability: the earliest date >= today
  // with any taxonomy-passing site (bookable OR walk-up), NOT range- or drop-limited.
  let earliestAvailableDate: string | null = null;
  for (const dateEntry of digest.nextAvailableDates) {
    if (dateEntry.date < today) continue;
    const anyPasses = dateEntry.campgrounds.some((cg) => {
      const bookableHit = cg.sites.some(passes);
      const walkUpHit = !hideWalkUp && cg.walkUpSites.some(passes);
      return bookableHit || walkUpHit;
    });
    if (anyPasses) {
      earliestAvailableDate = dateEntry.date;
      break;
    }
  }

  const nextAvailableDates: AvailableDateEntry[] = [];
  for (const dateEntry of digest.nextAvailableDates) {
    if (!(dateEntry.date >= rangeStart && (!to || dateEntry.date <= to))) continue;
    const campgrounds = dateEntry.campgrounds
      .map((cg) => filterDateCampground(cg, passes, hideWalkUp))
      .filter((cg): cg is AvailableDateCampground => cg !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (campgrounds.length > 0) {
      nextAvailableDates.push({ ...dateEntry, campgrounds });
    }
  }

  const nextAvailableWeekends: WeekendEntry[] = [];
  for (const wk of digest.nextAvailableWeekends) {
    const allowFriday = isInRange(wk.fridayDate, rangeStart, to);
    const allowSaturday = isInRange(wk.saturdayDate, rangeStart, to);
    if (!allowFriday && !allowSaturday) continue;
    const campgrounds = wk.campgrounds
      .map((cg) =>
        filterWeekendCampground(
          cg,
          cg.name,
          digest.nextAvailableDates,
          wk.fridayDate,
          wk.saturdayDate,
          passes,
          hideWalkUp,
          allowFriday,
          allowSaturday,
        ),
      )
      .filter((cg): cg is WeekendCampground => cg !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (campgrounds.length > 0) {
      nextAvailableWeekends.push({ ...wk, campgrounds });
    }
  }

  return {
    parkPageId: digest.parkPageId,
    parkName: digest.parkName,
    asOf: digest.asOf,
    nextAvailableDates,
    nextAvailableWeekends,
    earliestAvailableDate,
  };
}
