import { useState, useEffect, useCallback } from "react";
import { EMPTY_TAXONOMY, isTaxonomyDefault } from "@/lib/site-taxonomy";
import type { TaxonomyState, SiteAccess } from "@/lib/site-taxonomy";
import { upcomingWeekendRange } from "../lib/upcoming-weekend";
import { todayIso, addDaysIso, formatDate } from "../lib/map-utils";
import { computeActiveFilterCount } from "../lib/filter-derivations";
import type { Preset, MinNights, ResolvedLocation } from "../lib/types";

const ACCESS_LABEL: Record<SiteAccess, string> = {
  drive_in: "drive-in",
  hike_in: "hike-in",
  boat_in: "boat-in",
};

export interface MapFilters {
  taxonomy: TaxonomyState;
  setTaxonomy: (t: TaxonomyState) => void;
  minNights: MinNights;
  setMinNights: (n: MinNights) => void;
  preset: Preset;
  applyPreset: (p: Preset) => void;
  weekendsOnly: boolean;
  setWeekendsOnly: (v: boolean | ((prev: boolean) => boolean)) => void;
  availFrom: string;
  availTo: string;
  setDates: (from: string, to: string) => void;
  locationQuery: string;
  setLocationQuery: (q: string) => void;
  resolvedLocation: ResolvedLocation | null;
  setResolvedLocation: (l: ResolvedLocation | null) => void;
  distanceMiles: number | null;
  setDistanceMiles: (d: number | null) => void;
  geocoding: boolean;
  geocodeError: string | null;
  setGeocodeError: (e: string | null) => void;
  handleGeocode: () => Promise<void>;
  handleCurrentLocation: () => void;
  reset: () => void;
  activeFilterCount: number;
  isDefaultState: boolean;
  summaryParts: string[];
  summaryDateClause: string;
  summaryNearClause: string;
}

export function useMapFilters(): MapFilters {
  const [taxonomy, setTaxonomy] = useState<TaxonomyState>(EMPTY_TAXONOMY);
  const [minNights, setMinNights] = useState<MinNights>(null);
  const [preset, setPreset] = useState<Preset>("this_weekend");
  const [weekendsOnly, setWeekendsOnly] = useState(true);
  const [availFrom, setAvailFrom] = useState("");
  const [availTo, setAvailTo] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [resolvedLocation, setResolvedLocation] = useState<ResolvedLocation | null>(null);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  const applyPreset = useCallback((p: Preset) => {
    setPreset(p);
    if (p === "this_weekend") {
      const { from, to } = upcomingWeekendRange(new Date());
      setAvailFrom(from);
      setAvailTo(to);
      setWeekendsOnly(true);
    } else if (p === "next_2_weeks") {
      setAvailFrom(todayIso());
      setAvailTo(addDaysIso(todayIso(), 14));
    } else if (p === "next_month") {
      setAvailFrom(todayIso());
      setAvailTo(addDaysIso(todayIso(), 30));
    } else {
      setAvailFrom(todayIso());
      setAvailTo("");
    }
  }, []);

  // Default to the upcoming weekend on first mount (legacy :655-659).
  useEffect(() => {
    const { from, to } = upcomingWeekendRange(new Date());
    setAvailFrom(from);
    setAvailTo(to);
  }, []);

  const derivePreset = useCallback((from: string, to: string): Preset | null => {
    const wk = upcomingWeekendRange(new Date());
    if (from === wk.from && to === wk.to) return "this_weekend";
    const today = todayIso();
    if (from === today && to === addDaysIso(today, 14)) return "next_2_weeks";
    if (from === today && to === addDaysIso(today, 30)) return "next_month";
    if (from === today && to === "") return "anytime";
    return null;
  }, []);

  const setDates = useCallback((from: string, to: string) => {
    setAvailFrom(from);
    setAvailTo(to);
    const derived = derivePreset(from, to);
    if (derived) setPreset(derived);
  }, [derivePreset]);

  const handleGeocode = useCallback(async () => {
    const q = locationQuery.trim();
    if (!q) return;
    setGeocoding(true);
    setGeocodeError(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`;
      const res = await fetch(url, { headers: { "User-Agent": "CampBrain/1.0 (personal camping assistant)" } });
      const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (!data[0]) {
        setGeocodeError("Location not found — try a city name");
        return;
      }
      setResolvedLocation({
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
        name: data[0].display_name.split(",").slice(0, 2).join(",").trim(),
      });
    } catch {
      setGeocodeError("Geocoding failed");
    } finally {
      setGeocoding(false);
    }
  }, [locationQuery]);

  const handleCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeocodeError("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setResolvedLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: "My location" });
        setLocationQuery("My location");
        setGeocodeError(null);
      },
      () => setGeocodeError("Location access denied"),
    );
  }, []);

  const reset = useCallback(() => {
    setTaxonomy(EMPTY_TAXONOMY);
    setMinNights(null);
    setWeekendsOnly(true);
    setLocationQuery("");
    setResolvedLocation(null);
    setDistanceMiles(null);
    setGeocodeError(null);
    applyPreset("this_weekend");
  }, [applyPreset]);

  const isDefaultState =
    preset === "this_weekend" && weekendsOnly && minNights === null &&
    isTaxonomyDefault(taxonomy) && resolvedLocation === null;

  const activeFilterCount = computeActiveFilterCount(taxonomy, minNights, resolvedLocation, distanceMiles);

  const summaryParts: string[] = [];
  if (minNights) summaryParts.push(`${minNights}-night`);
  if (taxonomy.access.length === 1) summaryParts.push(ACCESS_LABEL[taxonomy.access[0]!]);
  if (weekendsOnly) summaryParts.push("weekend");
  summaryParts.push("stay");
  const summaryDateClause = availTo ? ` ${formatDate(availFrom)} – ${formatDate(availTo)}` : " anytime";
  const summaryNearClause = resolvedLocation && distanceMiles ? ` within ${distanceMiles} mi of ${resolvedLocation.name}` : "";

  return {
    taxonomy, setTaxonomy, minNights, setMinNights, preset, applyPreset,
    weekendsOnly, setWeekendsOnly, availFrom, availTo, setDates,
    locationQuery, setLocationQuery, resolvedLocation, setResolvedLocation,
    distanceMiles, setDistanceMiles, geocoding, geocodeError, setGeocodeError,
    handleGeocode, handleCurrentLocation, reset,
    activeFilterCount, isDefaultState, summaryParts, summaryDateClause, summaryNearClause,
  };
}
