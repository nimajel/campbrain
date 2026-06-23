import { useMemo } from "react";
import type { MapPark } from "@campbrain/core";
import { computeFilteredParks, buildListRows } from "../lib/filter-derivations";
import type { ParkListRow } from "../lib/park-list";
import type { ParkAvailabilitySummary, ResolvedLocation } from "../lib/types";

interface Args {
  parks: MapPark[];
  resolvedLocation: ResolvedLocation | null;
  distanceMiles: number | null;
  availByPark: Map<string, ParkAvailabilitySummary> | null;
}

export function useFilteredParks(args: Args): {
  displayedParks: MapPark[];
  matchCount: number;
  listRows: ParkListRow[];
} {
  const { parks, resolvedLocation, distanceMiles, availByPark } = args;

  // displayedParks = distance-filtered, with coords (pins). Availability greys pins
  // out in MapView; it does NOT remove them, so do not pass availByPark here.
  const displayedParks = useMemo(() => {
    const withCoords = parks.filter((p) => p.latitude && p.longitude);
    return computeFilteredParks(withCoords, resolvedLocation, distanceMiles, null);
  }, [parks, resolvedLocation, distanceMiles]);

  // matchCount = parks with bookable availability (for the summary sentence).
  const matchCount = useMemo(
    () => computeFilteredParks(parks, resolvedLocation, distanceMiles, availByPark).length,
    [parks, resolvedLocation, distanceMiles, availByPark],
  );

  const listRows = useMemo(
    () => buildListRows(displayedParks, availByPark, resolvedLocation),
    [displayedParks, availByPark, resolvedLocation],
  );

  return { displayedParks, matchCount, listRows };
}
