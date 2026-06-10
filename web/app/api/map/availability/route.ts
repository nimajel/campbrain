import { NextRequest, NextResponse } from 'next/server';
import { getEntriesForParks } from '../../../../lib/availability-cache';
import type { AvailabilityWindowEntry } from '../../../../lib/availability-cache';
import { parseFilterParams } from '../../../../lib/filter-params';
import type { SiteAccess, SiteKind, HideTarget } from '../../../../lib/availability-cache';
import { classifySite } from '../../../../../src/catalog/site-classifier';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AvailableDateEntry = {
  date: string;         // YYYY-MM-DD
  dayLabel: string;     // e.g. "Fri, Jun 6"
  isWeekend: boolean;   // Friday or Saturday arrival
  campgrounds: {
    name: string;
    bookingUrl?: string;
    nightlyFee: number | null;
    availableSiteCount: number; // bookable (reservable) sites only
    sites: string[];            // bookable site names (deduped)
    walkUpSites: string[];      // walk-up / first-come sites (not reservable)
  }[];
};

export type WeekendEntry = {
  label: string;         // e.g. "Jun 6–8"
  fridayDate: string;    // YYYY-MM-DD
  saturdayDate: string;  // YYYY-MM-DD
  sundayDate: string;    // YYYY-MM-DD
  campgrounds: {
    name: string;
    bookingUrl?: string;
    nightlyFee: number | null;
    // The tier arrays below are all bookable (walk-up excluded) and deduped.
    // Sites open the whole Fri+Sat+Sun weekend (3 nights)
    sites3Night: string[];
    // Sites open Fri+Sat (2 nights)
    sites2NightFri: string[];
    // Sites open Sat+Sun (2 nights)
    sites2NightSat: string[];
    // Sites open Friday night only (1 night)
    sites1NightFri: string[];
    // Sites open Saturday night only (1 night)
    sites1NightSat: string[];
    // Walk-up / first-come sites open Fri or Sat (not reservable)
    walkUpSites: string[];
  }[];
};

export type ParkAvailabilityResponse = {
  parkPageId: string;
  parkName: string;
  asOf: string | null;
  nextAvailableDates: AvailableDateEntry[];
  nextAvailableWeekends: WeekendEntry[];
  /** First date with any available site in the entire cache window, or null if none. */
  earliestAvailableDate: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function addDays(iso: string, n: number): string {
  const d = parseDateLocal(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dowLabel(iso: string): string {
  return parseDateLocal(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/** Friday = 5, Saturday = 6 */
function isWeekendArrival(iso: string): boolean {
  const dow = parseDateLocal(iso).getDay();
  return dow === 5 || dow === 6;
}

function isInRange(iso: string, from: string, to: string | null): boolean {
  return iso >= from && (!to || iso <= to);
}

/**
 * Given a set of available dates, derive the unique Fridays that anchor weekends
 * where at least one of Fri/Sat/Sun has available sites.
 * Returns up to `maxCount` Fridays sorted ascending.
 */
function weekendFridaysFromAvailableDates(
  availableDates: string[],
  today: string,
  maxCount: number
): string[] {
  const fridaySet = new Set<string>();

  for (const iso of availableDates) {
    if (iso < today) continue;
    const dow = parseDateLocal(iso).getDay(); // 0=Sun,5=Fri,6=Sat
    if (dow !== 5 && dow !== 6 && dow !== 0) continue;

    // Find the Friday of this weekend
    const d = parseDateLocal(iso);
    if (dow === 5) {
      // already Friday
    } else if (dow === 6) {
      d.setDate(d.getDate() - 1);
    } else {
      // Sunday
      d.setDate(d.getDate() - 2);
    }
    fridaySet.add(d.toISOString().slice(0, 10));
  }

  return [...fridaySet].sort().slice(0, maxCount);
}

// Build a Map<date → Map<campgroundName → {sites, bookingUrl}>> from all entries.
// Caller is responsible for pre-filtering entries to the relevant facilities.
// The `passes` predicate is applied per-site so filtered sites never enter the map.
function buildDateSiteMap(
  entries: AvailabilityWindowEntry[],
  passes: (siteName: string, cgName: string) => boolean,
): Map<string, Map<string, { sites: string[]; bookingUrl?: string; nightlyFee: number | null }>> {
  const dateMap = new Map<string, Map<string, { sites: string[]; bookingUrl?: string; nightlyFee: number | null }>>();

  for (const entry of entries) {
    for (const cg of entry.campgrounds) {
      for (const site of cg.sites) {
        if (!passes(site.name, cg.name)) continue;
        for (const [date, status] of Object.entries(site.dates)) {
          if (status !== 'available') continue;
          if (!dateMap.has(date)) dateMap.set(date, new Map());
          const cgMap = dateMap.get(date)!;
          if (!cgMap.has(cg.name)) {
            cgMap.set(cg.name, { sites: [], bookingUrl: cg.bookingUrl, nightlyFee: cg.nightlyFee ?? null });
          }
          // Overlapping scan windows can cover the same date, so the same site
          // may appear more than once — dedupe to keep counts and lists accurate.
          const cgSites = cgMap.get(cg.name)!.sites;
          if (!cgSites.includes(site.name)) cgSites.push(site.name);
        }
      }
    }
  }

  return dateMap;
}

function sitesAvailableForDates(
  dateMap: Map<string, Map<string, { sites: string[]; bookingUrl?: string; nightlyFee: number | null }>>,
  cgName: string,
  dates: string[]
): string[] {
  if (dates.length === 0) return [];
  // Find sites available on ALL of the given dates for this campground
  const setsPerDate = dates.map((d) => {
    const cgMap = dateMap.get(d);
    if (!cgMap || !cgMap.has(cgName)) return new Set<string>();
    return new Set(cgMap.get(cgName)!.sites);
  });
  const first = setsPerDate[0]!;
  return [...first].filter((s) => setsPerDate.every((set) => set.has(s)));
}

/** Split site names into bookable (reservable) vs walk-up (first-come) buckets, sorted. */
function splitWalkUp(
  names: string[],
  cgName: string,
  isWalkUp: (name: string, cgName: string) => boolean,
): { bookable: string[]; walkUp: string[] } {
  const bookable: string[] = [];
  const walkUp: string[] = [];
  for (const name of names) {
    (isWalkUp(name, cgName) ? walkUp : bookable).push(name);
  }
  return { bookable: bookable.sort(), walkUp: walkUp.sort() };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest
): Promise<NextResponse<ParkAvailabilityResponse | { error: string }>> {
  // Accept either a single parkPageId OR a comma-separated facilityIds list.
  // facilityIds supports parent-grouped rec-gov parks (multiple facilities per pin).
  const parkPageId = req.nextUrl.searchParams.get('parkPageId');
  const facilityIdsParam = req.nextUrl.searchParams.get('facilityIds');
  const facilityIds = facilityIdsParam
    ? facilityIdsParam.split(',').filter(Boolean)
    : parkPageId
      ? [parkPageId]
      : null;

  if (!facilityIds || facilityIds.length === 0) {
    return NextResponse.json({ error: 'parkPageId or facilityIds is required' }, { status: 400 });
  }

  // The canonical ID for this response — the caller's park identifier (parentId or facilityId)
  const responseId = parkPageId ?? facilityIds[0]!;

  // Optional provider scoping — prevents cross-provider park_page_id collisions
  const providerName = req.nextUrl.searchParams.get('provider') ?? undefined;

  // Optional date-range filter — constrains the dates/weekends shown so the panel
  // matches the user's search. earliestAvailableDate stays global so the empty-state
  // can still surface the next opening outside the requested range.
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');

  // Taxonomy filters — applied server-side so filtered sites never reach the response.
  // minNights is intentionally NOT applied here: min-stay is a stay-shape constraint
  // handled by the client (dates-view consecutive intersection, weekend tier logic).
  const { access, kinds, hide } = parseFilterParams(req.nextUrl.searchParams);

  function passesTaxonomy(siteName: string, cgName: string): boolean {
    const info = classifySite(siteName, cgName);
    if (info.isDayUse) return false;
    if (access.length > 0 && !access.includes(info.access)) return false;
    if (kinds.length > 0 && (info.siteKind === null || !kinds.includes(info.siteKind))) return false;
    if (hide.includes('group') && info.isGroup) return false;
    if (hide.includes('equestrian') && info.isEquestrian) return false;
    if (hide.includes('walk_up') && info.isWalkUp) return false;
    return true;
  }

  const parkEntries = await getEntriesForParks(facilityIds, providerName);

  if (parkEntries.length === 0) {
    return NextResponse.json({
      parkPageId: responseId,
      parkName: '',
      asOf: null,
      nextAvailableDates: [],
      nextAvailableWeekends: [],
      earliestAvailableDate: null,
    });
  }

  const parkName = parkEntries[0]!.parkName;
  const asOf = parkEntries.reduce(
    (latest, e) => (e.scannedAt > latest ? e.scannedAt : latest),
    parkEntries[0]!.scannedAt
  );

  const dateMap = buildDateSiteMap(parkEntries, passesTaxonomy);
  const today = todayIso();
  const allAvailableDates = [...dateMap.keys()].filter((d) => d >= today).sort();
  const earliestAvailableDate = allAvailableDates[0] ?? null;

  // Range-filtered view used for the dates/weekends lists. A weekend is kept if any
  // of its Fri/Sat/Sun nights falls inside the range, so the `from`/`to` bounds are
  // applied loosely to the date list and tightened per-weekend below.
  const rangeStart = from && from > today ? from : today;
  const sortedAvailableDates = allAvailableDates.filter(
    (d) => d >= rangeStart && (!to || d <= to)
  );

  // Collect all campground names + booking metadata (for reference)
  const cgMeta = new Map<string, { bookingUrl?: string; nightlyFee: number | null }>();
  for (const entry of parkEntries) {
    for (const cg of entry.campgrounds) {
      if (!cgMeta.has(cg.name)) {
        cgMeta.set(cg.name, { bookingUrl: cg.bookingUrl, nightlyFee: cg.nightlyFee ?? null });
      }
    }
  }
  const allCgNames = [...cgMeta.keys()];

  // Walk-up detector for the split — used to separate bookable vs walk-up within
  // the already-taxonomy-filtered site lists. Sites that fail passesTaxonomy are
  // never in the dateMap; isWalkUp here only splits remaining sites for display.
  function isWalkUpForSplit(siteName: string, cgName: string): boolean {
    return classifySite(siteName, cgName).isWalkUp;
  }

  // -------------------------------------------------------------------------
  // 1. Next available dates — any date from today onward with at least 1 open site
  // -------------------------------------------------------------------------
  const nextAvailableDates: AvailableDateEntry[] = [];

  for (const date of sortedAvailableDates) {
    const cgMap = dateMap.get(date)!;
    const campgrounds = [...cgMap.entries()]
      .map(([name, { sites, bookingUrl, nightlyFee }]) => {
        const { bookable, walkUp } = splitWalkUp(sites, name, isWalkUpForSplit);
        return {
          name,
          bookingUrl,
          nightlyFee,
          availableSiteCount: bookable.length,
          sites: bookable,
          walkUpSites: walkUp,
        };
      })
      // Keep a campground if it has bookable sites or walk-up sites to surface.
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

  // -------------------------------------------------------------------------
  // 2. Next available weekends — derived from actual available dates in cache
  //    so we find real openings regardless of how far out they are
  // -------------------------------------------------------------------------
  const nextAvailableWeekends: WeekendEntry[] = [];
  const fridays = weekendFridaysFromAvailableDates(sortedAvailableDates, today, Infinity);

  for (const fri of fridays) {
    const sat = addDays(fri, 1);
    const sun = addDays(fri, 2);
    const allowFridayArrival = isInRange(fri, rangeStart, to);
    const allowSaturdayArrival = isInRange(sat, rangeStart, to);

    const weekendCampgrounds: WeekendEntry['campgrounds'] = [];

    for (const cgName of allCgNames) {
      // Each tier is split so walk-up (non-reservable) sites never appear as bookable.
      const sites3Night = allowFridayArrival
        ? splitWalkUp(sitesAvailableForDates(dateMap, cgName, [fri, sat, sun]), cgName, isWalkUpForSplit).bookable
        : [];
      const sites2NightFri = allowFridayArrival
        ? splitWalkUp(sitesAvailableForDates(dateMap, cgName, [fri, sat]), cgName, isWalkUpForSplit).bookable
        : [];
      const sites2NightSat = allowSaturdayArrival
        ? splitWalkUp(sitesAvailableForDates(dateMap, cgName, [sat, sun]), cgName, isWalkUpForSplit).bookable
        : [];

      // Single-night Fri / Sat options. Sunday-only availability is omitted —
      // arriving Sunday means a Mon check-out, not a useful "weekend" trip.
      const friSplit = allowFridayArrival
        ? splitWalkUp([...(dateMap.get(fri)?.get(cgName)?.sites ?? [])], cgName, isWalkUpForSplit)
        : { bookable: [], walkUp: [] };
      const satSplit = allowSaturdayArrival
        ? splitWalkUp([...(dateMap.get(sat)?.get(cgName)?.sites ?? [])], cgName, isWalkUpForSplit)
        : { bookable: [], walkUp: [] };
      const sites1NightFri = friSplit.bookable;
      const sites1NightSat = satSplit.bookable;
      const walkUpSites = [...new Set([...friSplit.walkUp, ...satSplit.walkUp])].sort();

      if (
        sites1NightFri.length === 0 &&
        sites1NightSat.length === 0 &&
        walkUpSites.length === 0
      ) {
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

  return NextResponse.json({
    parkPageId: responseId,
    parkName,
    asOf,
    nextAvailableDates,
    nextAvailableWeekends,
    earliestAvailableDate,
  });
}
