import type { AvailabilityWindowEntry } from "./types";
import { classifySite, isWalkUpSite } from "../catalog/site-classifier";
import type { SiteAccess, SiteKind } from "../catalog/site-classifier";

export type HideTarget = "group" | "equestrian" | "walk_up";

export interface MapAvailabilityFilters {
  from?: string | null;
  to?: string | null;
  access?: SiteAccess[];
  kinds?: SiteKind[];
  hide?: HideTarget[];
}

export interface AvailableDateCampground {
  name: string;
  bookingUrl?: string;
  nightlyFee: number | null;
  availableSiteCount: number;
  sites: string[];        // bookable, sorted
  walkUpSites: string[];  // walk-up/first-come, sorted
}

export interface AvailableDateEntry {
  date: string;       // YYYY-MM-DD
  dayLabel: string;   // "Fri, Jun 6"
  isWeekend: boolean; // DOW is Fri(5) or Sat(6)
  campgrounds: AvailableDateCampground[];
}

export interface WeekendCampground {
  name: string;
  bookingUrl?: string;
  nightlyFee: number | null;
  sites3Night: string[];
  sites2NightFri: string[];
  sites2NightSat: string[];
  sites1NightFri: string[];
  sites1NightSat: string[];
  walkUpSites: string[];
}

export interface WeekendEntry {
  label: string;        // "Fri, Jun 6–Sun, Jun 8"
  fridayDate: string;
  saturdayDate: string;
  sundayDate: string;
  campgrounds: WeekendCampground[];
}

export interface ParkAvailabilityResponse {
  parkPageId: string;
  parkName: string;
  asOf: string | null;
  nextAvailableDates: AvailableDateEntry[];
  nextAvailableWeekends: WeekendEntry[];
  earliestAvailableDate: string | null;
}

// --- catalog transforms ---

export interface CatalogParkInput {
  providerId: string;
  parkPageId: string;
  parkName: string;
  latitude: number | null;
  longitude: number | null;
  campgrounds: { name: string; siteCount: number }[];
}

export interface MapPark {
  provider: string;
  parkName: string;
  parkPageId: string;
  latitude: number | null;
  longitude: number | null;
  campgroundCount: number;
  siteCount: number;
  campgrounds: { name: string; siteCount: number }[];
}

export function toMapPark(p: CatalogParkInput): MapPark {
  return {
    provider: p.providerId,
    parkName: p.parkName,
    parkPageId: p.parkPageId,
    latitude: p.latitude,
    longitude: p.longitude,
    campgroundCount: p.campgrounds.length,
    siteCount: p.campgrounds.reduce((sum, c) => sum + c.siteCount, 0),
    campgrounds: [...p.campgrounds],
  };
}

// --- date utils ---
// Local-time Date construction, ported verbatim from the legacy route so the new
// tRPC path matches it exactly. parse + DOW + label are all local-tz-consistent.
// Correct in the deployment target (Cloudflare Workers = UTC) and CA-local dev
// (UTC-8). A holistic switch to UTC-based DOW math is tracked as a follow-up.

export function parseDateLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export function addDays(iso: string, n: number): string {
  const d = parseDateLocal(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function dowLabel(iso: string): string {
  return parseDateLocal(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function isWeekendArrival(iso: string): boolean {
  const dow = parseDateLocal(iso).getDay();
  return dow === 5 || dow === 6;
}

export function isInRange(iso: string, from: string, to: string | null | undefined): boolean {
  return iso >= from && (!to || iso <= to);
}

// --- taxonomy predicate (closes over the filter arrays) ---

export function makeTaxonomyPredicate(
  f: MapAvailabilityFilters,
  parkPageId?: string,
): (siteName: string, cgName: string) => boolean {
  const access = f.access ?? [];
  const kinds = f.kinds ?? [];
  const hide = f.hide ?? [];
  return (siteName, cgName) => {
    const info = classifySite(siteName, cgName, undefined, parkPageId);
    if (info.isDayUse) return false;
    if (access.length > 0 && !access.includes(info.access)) return false;
    if (kinds.length > 0 && (info.siteKind === null || !kinds.includes(info.siteKind))) return false;
    if (hide.includes("group") && info.isGroup) return false;
    if (hide.includes("equestrian") && info.isEquestrian) return false;
    if (hide.includes("walk_up") && info.isWalkUp) return false;
    return true;
  };
}

export interface CampgroundSiteEntry {
  sites: string[];
  bookingUrl?: string;
  nightlyFee: number | null;
}

export type DateSiteMap = Map<string, Map<string, CampgroundSiteEntry>>;

/** Pivot park→cg→site→dates into date→cg→sites[], applying `passes` per site and
 *  deduping site names across overlapping scan windows. Only 'available' dates. */
export function buildDateSiteMap(
  entries: AvailabilityWindowEntry[],
  passes: (siteName: string, cgName: string) => boolean,
): DateSiteMap {
  const dateMap: DateSiteMap = new Map();
  for (const entry of entries) {
    for (const cg of entry.campgrounds) {
      for (const site of cg.sites) {
        if (!passes(site.name, cg.name)) continue;
        for (const [date, status] of Object.entries(site.dates)) {
          if (status !== "available") continue;
          if (!dateMap.has(date)) dateMap.set(date, new Map());
          const cgMap = dateMap.get(date)!;
          if (!cgMap.has(cg.name)) {
            const cgEntry: CampgroundSiteEntry = { sites: [], bookingUrl: cg.bookingUrl, nightlyFee: cg.nightlyFee ?? null };
            cgMap.set(cg.name, cgEntry);
          }
          const cgSites = cgMap.get(cg.name)!.sites;
          if (!cgSites.includes(site.name)) cgSites.push(site.name);
        }
      }
    }
  }
  return dateMap;
}

/** Sites available on ALL of `dates` for `cgName` (intersection). */
export function sitesAvailableForDates(dateMap: DateSiteMap, cgName: string, dates: string[]): string[] {
  if (dates.length === 0) return [];
  const setsPerDate = dates.map((d) => {
    const cgMap = dateMap.get(d);
    if (!cgMap || !cgMap.has(cgName)) return new Set<string>();
    return new Set(cgMap.get(cgName)!.sites);
  });
  const first = setsPerDate[0]!;
  return [...first].filter((s) => setsPerDate.every((set) => set.has(s)));
}

/** Split site names into bookable vs walk-up (first-come), each sorted. */
export function splitWalkUp(
  names: string[],
  cgName: string,
  isWalkUp: (name: string, cgName: string) => boolean,
): { bookable: string[]; walkUp: string[] } {
  const bookable: string[] = [];
  const walkUp: string[] = [];
  for (const name of names) (isWalkUp(name, cgName) ? walkUp : bookable).push(name);
  return { bookable: bookable.sort(), walkUp: walkUp.sort() };
}

// --- park availability assembly ---

/**
 * Given a set of available dates, derive the unique Fridays that anchor weekends
 * where at least one of Fri/Sat/Sun has available sites. Ported verbatim from the
 * legacy route. Returns up to `maxCount` Fridays sorted ascending.
 */
export function weekendFridaysFromAvailableDates(
  availableDates: string[],
  today: string,
  maxCount: number,
): string[] {
  const fridaySet = new Set<string>();
  for (const iso of availableDates) {
    // Safety net for direct callers; in the buildParkAvailability path the input
    // is already range-filtered to dates >= today.
    if (iso < today) continue;
    const d = parseDateLocal(iso);
    const dow = d.getDay(); // 0=Sun,5=Fri,6=Sat
    if (dow !== 5 && dow !== 6 && dow !== 0) continue;
    if (dow === 6) d.setDate(d.getDate() - 1);
    else if (dow === 0) d.setDate(d.getDate() - 2);
    fridaySet.add(d.toISOString().slice(0, 10));
  }
  return [...fridaySet].sort().slice(0, maxCount);
}

/**
 * Assemble scanner entries + taxonomy/date filters into a ParkAvailabilityResponse.
 * Pure port of the legacy GET handler body (web/app/api/map/availability/route.ts):
 * param parsing is hoisted into the `filters`/`responseId`/`now` args.
 */
export function buildParkAvailability(
  entries: AvailabilityWindowEntry[],
  filters: MapAvailabilityFilters,
  responseId: string,
  now: Date = new Date(),
): ParkAvailabilityResponse {
  if (entries.length === 0) {
    return {
      parkPageId: responseId,
      parkName: "",
      asOf: null,
      nextAvailableDates: [],
      nextAvailableWeekends: [],
      earliestAvailableDate: null,
    };
  }

  const parkName = entries[0]!.parkName;
  const asOf = entries.reduce(
    (latest, e) => (e.scannedAt > latest ? e.scannedAt : latest),
    entries[0]!.scannedAt,
  );

  const passesTaxonomy = makeTaxonomyPredicate(filters, entries[0]!.parkPageId);
  const dateMap = buildDateSiteMap(entries, passesTaxonomy);
  const today = todayIso(now);
  const allAvailableDates = [...dateMap.keys()].filter((d) => d >= today).sort();
  const earliestAvailableDate = allAvailableDates[0] ?? null;

  const from = filters.from ?? null;
  const to = filters.to ?? null;
  const rangeStart = from && from > today ? from : today;
  const sortedAvailableDates = allAvailableDates.filter((d) => d >= rangeStart && (!to || d <= to));

  // First-seen booking metadata per campground across all entries.
  const cgMeta = new Map<string, { bookingUrl?: string; nightlyFee: number | null }>();
  for (const entry of entries) {
    for (const cg of entry.campgrounds) {
      if (!cgMeta.has(cg.name)) {
        cgMeta.set(cg.name, { bookingUrl: cg.bookingUrl, nightlyFee: cg.nightlyFee ?? null });
      }
    }
  }
  const allCgNames = [...cgMeta.keys()];

  // 1. Next available dates — booking metadata sourced from the dateMap cg entry.
  const nextAvailableDates: AvailableDateEntry[] = [];
  for (const date of sortedAvailableDates) {
    const cgMap = dateMap.get(date)!;
    const campgrounds = [...cgMap.entries()]
      .map(([name, { sites, bookingUrl, nightlyFee }]) => {
        const { bookable, walkUp } = splitWalkUp(sites, name, isWalkUpSite);
        return {
          name,
          bookingUrl,
          nightlyFee,
          availableSiteCount: bookable.length,
          sites: bookable,
          walkUpSites: walkUp,
        };
      })
      .filter((cg) => cg.availableSiteCount > 0 || cg.walkUpSites.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (campgrounds.length > 0) {
      nextAvailableDates.push({
        date,
        dayLabel: dowLabel(date),
        isWeekend: isWeekendArrival(date),
        campgrounds,
      });
    }
  }

  // 2. Next available weekends — Fridays derived from the range-filtered dates.
  const nextAvailableWeekends: WeekendEntry[] = [];
  const fridays = weekendFridaysFromAvailableDates(sortedAvailableDates, today, Infinity);

  for (const fri of fridays) {
    const sat = addDays(fri, 1);
    const sun = addDays(fri, 2);
    const allowFridayArrival = isInRange(fri, rangeStart, to);
    const allowSaturdayArrival = isInRange(sat, rangeStart, to);

    const weekendCampgrounds: WeekendCampground[] = [];

    for (const cgName of allCgNames) {
      const sites3Night = allowFridayArrival
        ? splitWalkUp(sitesAvailableForDates(dateMap, cgName, [fri, sat, sun]), cgName, isWalkUpSite).bookable
        : [];
      const sites2NightFri = allowFridayArrival
        ? splitWalkUp(sitesAvailableForDates(dateMap, cgName, [fri, sat]), cgName, isWalkUpSite).bookable
        : [];
      const sites2NightSat = allowSaturdayArrival
        ? splitWalkUp(sitesAvailableForDates(dateMap, cgName, [sat, sun]), cgName, isWalkUpSite).bookable
        : [];

      const friSplit = allowFridayArrival
        ? splitWalkUp([...(dateMap.get(fri)?.get(cgName)?.sites ?? [])], cgName, isWalkUpSite)
        : { bookable: [], walkUp: [] };
      const satSplit = allowSaturdayArrival
        ? splitWalkUp([...(dateMap.get(sat)?.get(cgName)?.sites ?? [])], cgName, isWalkUpSite)
        : { bookable: [], walkUp: [] };
      const sites1NightFri = friSplit.bookable;
      const sites1NightSat = satSplit.bookable;
      const walkUpSites = [...new Set([...friSplit.walkUp, ...satSplit.walkUp])].sort();

      if (sites1NightFri.length === 0 && sites1NightSat.length === 0 && walkUpSites.length === 0) {
        continue;
      }

      weekendCampgrounds.push({
        name: cgName,
        bookingUrl: cgMeta.get(cgName)?.bookingUrl,
        nightlyFee: cgMeta.get(cgName)?.nightlyFee ?? null,
        sites3Night,
        sites2NightFri,
        sites2NightSat,
        sites1NightFri,
        sites1NightSat,
        walkUpSites,
      });
    }

    if (weekendCampgrounds.length > 0) {
      nextAvailableWeekends.push({
        label: `${dowLabel(fri)}–${dowLabel(sun)}`,
        fridayDate: fri,
        saturdayDate: sat,
        sundayDate: sun,
        campgrounds: weekendCampgrounds.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
  }

  return {
    parkPageId: responseId,
    parkName,
    asOf,
    nextAvailableDates,
    nextAvailableWeekends,
    earliestAvailableDate,
  };
}
