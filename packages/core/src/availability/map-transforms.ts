import type { AvailabilityWindowEntry } from "./types";
import { classifySite } from "../catalog/site-classifier";
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

export function makeTaxonomyPredicate(f: MapAvailabilityFilters): (siteName: string, cgName: string) => boolean {
  const access = f.access ?? [];
  const kinds = f.kinds ?? [];
  const hide = f.hide ?? [];
  return (siteName, cgName) => {
    const info = classifySite(siteName, cgName);
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
