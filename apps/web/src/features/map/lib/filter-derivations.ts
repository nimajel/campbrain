import type { MapPark } from "@campbrain/core";
import { haversine } from "./map-utils";
import { getParkType, type PinAvailability } from "./map-pins";
import type { ParkListRow } from "./park-list";
import type { ParkAvailabilitySummary, ResolvedLocation, MinNights } from "./types";
import type { TaxonomyState } from "@/lib/site-taxonomy";

export interface ParkCount {
  providerId: string;
  parkPageId: string;
  siteCount: number;
  walkUpCount: number;
  soonestDate: string | null;
}

export function computeActiveFilterCount(
  taxonomy: TaxonomyState,
  minNights: MinNights,
  resolvedLocation: ResolvedLocation | null,
  distanceMiles: number | null,
): number {
  return (
    taxonomy.access.length +
    taxonomy.kinds.length +
    taxonomy.hide.length +
    (minNights !== null ? 1 : 0) +
    (resolvedLocation && distanceMiles !== null ? 1 : 0)
  );
}

/** Sole key format for availability-summary maps: pins, list rows, and match
 *  counts must all build and look up entries through this helper. */
export function availKey(provider: string, parkPageId: string): string {
  return `${provider}:${parkPageId}`;
}

export function buildAvailByPark(parks: ParkCount[] | null): Map<string, ParkAvailabilitySummary> | null {
  if (!parks) return null;
  return new Map(
    parks.map((p) => [availKey(p.providerId, p.parkPageId), { siteCount: p.siteCount, walkUpCount: p.walkUpCount, soonestDate: p.soonestDate ?? null }]),
  );
}

export interface PinState {
  state: PinAvailability;
  count: number | undefined;
}

export function derivePinState(park: MapPark, availability: Map<string, ParkAvailabilitySummary> | null): PinState {
  if (!availability) return { state: "match", count: undefined };
  const summary = availability.get(availKey(park.provider, park.parkPageId));
  if (summary && summary.siteCount > 0) return { state: "match", count: summary.siteCount };
  if (summary && summary.walkUpCount > 0) return { state: "walk-up", count: summary.walkUpCount };
  return { state: "none", count: undefined };
}

function withinDistance(p: MapPark, loc: ResolvedLocation, miles: number): boolean {
  if (!p.latitude || !p.longitude) return false;
  return haversine(loc.lat, loc.lon, p.latitude, p.longitude) <= miles;
}

export function computeFilteredParks(
  parks: MapPark[],
  resolvedLocation: ResolvedLocation | null,
  distanceMiles: number | null,
  availByPark: Map<string, ParkAvailabilitySummary> | null,
): MapPark[] {
  let result = parks;
  if (resolvedLocation && distanceMiles !== null) {
    result = result.filter((p) => withinDistance(p, resolvedLocation, distanceMiles));
  }
  if (availByPark !== null) {
    result = result.filter((p) => (availByPark.get(availKey(p.provider, p.parkPageId))?.siteCount ?? 0) > 0);
  }
  return result;
}

export function buildListRows(
  displayedParks: MapPark[],
  availByPark: Map<string, ParkAvailabilitySummary> | null,
  resolvedLocation: ResolvedLocation | null,
): ParkListRow[] {
  if (!availByPark) return [];
  return displayedParks.flatMap((p) => {
    const a = availByPark.get(availKey(p.provider, p.parkPageId));
    if (!a || (a.siteCount === 0 && a.walkUpCount === 0)) return [];
    return [{
      parkPageId: p.parkPageId,
      parkName: p.parkName,
      isFederal: getParkType(p.provider) === "federal",
      siteCount: a.siteCount,
      walkUpCount: a.walkUpCount,
      distanceMi: resolvedLocation && p.latitude && p.longitude
        ? haversine(resolvedLocation.lat, resolvedLocation.lon, p.latitude, p.longitude)
        : null,
      soonestDate: a.soonestDate,
    }];
  });
}
