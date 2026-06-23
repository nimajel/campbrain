import { describe, it, expect } from "vitest";
import type { MapPark } from "@campbrain/core";
import { EMPTY_TAXONOMY } from "./site-taxonomy";
import type { ParkAvailabilitySummary } from "./types";
import {
  computeActiveFilterCount, buildAvailByPark, computeFilteredParks, buildListRows,
} from "./filter-derivations";

function park(over: Partial<MapPark>): MapPark {
  return {
    provider: "california-parks",
    parkName: "Park",
    parkPageId: "1",
    latitude: 37,
    longitude: -122,
    campgroundCount: 1,
    siteCount: 10,
    campgrounds: [{ name: "Loop A", siteCount: 10 }],
    ...over,
  };
}

describe("computeActiveFilterCount", () => {
  it("counts taxonomy + minNights + resolved distance", () => {
    const n = computeActiveFilterCount(
      { access: ["drive_in"], kinds: ["tent"], hide: [] },
      2,
      { lat: 1, lon: 2, name: "x" },
      50,
    );
    expect(n).toBe(4);
  });
  it("is 0 at defaults", () => {
    expect(computeActiveFilterCount(EMPTY_TAXONOMY, null, null, null)).toBe(0);
  });
});

describe("buildAvailByPark", () => {
  it("keys ParkAvailabilityCount[] by parkPageId", () => {
    const m = buildAvailByPark([
      { parkPageId: "1", siteCount: 3, walkUpCount: 0, soonestDate: "2026-07-01" },
      { parkPageId: "2", siteCount: 0, walkUpCount: 2, soonestDate: null },
    ])!;
    expect(m.get("1")).toEqual({ siteCount: 3, walkUpCount: 0, soonestDate: "2026-07-01" });
    expect(m.get("2")?.walkUpCount).toBe(2);
  });
  it("returns null for null input", () => {
    expect(buildAvailByPark(null)).toBeNull();
  });
});

describe("computeFilteredParks", () => {
  const parks = [park({ parkPageId: "1", latitude: 37, longitude: -122 }), park({ parkPageId: "2", latitude: 34, longitude: -118 })];
  it("returns all parks when no location + no availability", () => {
    expect(computeFilteredParks(parks, null, null, null).map((p) => p.parkPageId)).toEqual(["1", "2"]);
  });
  it("hard-filters by distance", () => {
    const out = computeFilteredParks(parks, { lat: 37, lon: -122, name: "x" }, 50, null);
    expect(out.map((p) => p.parkPageId)).toEqual(["1"]);
  });
  it("filters to parks with bookable availability", () => {
    const avail = new Map<string, ParkAvailabilitySummary>([
      ["1", { siteCount: 3, walkUpCount: 0, soonestDate: null }],
      ["2", { siteCount: 0, walkUpCount: 5, soonestDate: null }],
    ]);
    expect(computeFilteredParks(parks, null, null, avail).map((p) => p.parkPageId)).toEqual(["1"]);
  });
});

describe("buildListRows", () => {
  const parks = [park({ parkPageId: "1", latitude: 37, longitude: -122 })];
  it("includes walk-up-only parks (siteCount 0, walkUpCount > 0)", () => {
    const avail = new Map<string, ParkAvailabilitySummary>([["1", { siteCount: 0, walkUpCount: 4, soonestDate: null }]]);
    const rows = buildListRows(parks, avail, { lat: 37, lon: -122, name: "x" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.walkUpCount).toBe(4);
    expect(rows[0]!.distanceMi).toBeCloseTo(0, 1);
  });
  it("excludes parks with no availability at all", () => {
    const avail = new Map<string, ParkAvailabilitySummary>([["1", { siteCount: 0, walkUpCount: 0, soonestDate: null }]]);
    expect(buildListRows(parks, avail, null)).toEqual([]);
  });
  it("returns [] when availByPark is null", () => {
    expect(buildListRows(parks, null, null)).toEqual([]);
  });
});
