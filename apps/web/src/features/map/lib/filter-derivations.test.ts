import { describe, it, expect } from "vitest";
import type { MapPark } from "@campbrain/core";
import { EMPTY_TAXONOMY } from "@/lib/site-taxonomy";
import type { ParkAvailabilitySummary } from "./types";
import {
  computeActiveFilterCount, buildAvailByPark, computeFilteredParks, buildListRows, availKey, derivePinState,
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
  it("keys ParkAvailabilityCount[] by providerId:parkPageId", () => {
    const m = buildAvailByPark([
      { providerId: "california-parks", parkPageId: "1", siteCount: 3, walkUpCount: 0, soonestDate: "2026-07-01" },
      { providerId: "california-parks", parkPageId: "2", siteCount: 0, walkUpCount: 2, soonestDate: null },
    ])!;
    expect(m.get("california-parks:1")).toEqual({ siteCount: 3, walkUpCount: 0, soonestDate: "2026-07-01" });
    expect(m.get("california-parks:2")?.walkUpCount).toBe(2);
  });
  it("returns null for null input", () => {
    expect(buildAvailByPark(null)).toBeNull();
  });
  it("keeps counts separate when a federal park shares a parkPageId with a CA park", () => {
    const m = buildAvailByPark([
      { providerId: "california-parks", parkPageId: "500", siteCount: 3, walkUpCount: 0, soonestDate: "2026-07-01" },
      { providerId: "recreation-gov", parkPageId: "500", siteCount: 9, walkUpCount: 1, soonestDate: "2026-07-02" },
    ])!;
    expect(m.get("california-parks:500")).toEqual({ siteCount: 3, walkUpCount: 0, soonestDate: "2026-07-01" });
    expect(m.get("recreation-gov:500")).toEqual({ siteCount: 9, walkUpCount: 1, soonestDate: "2026-07-02" });
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
      ["california-parks:1", { siteCount: 3, walkUpCount: 0, soonestDate: null }],
      ["california-parks:2", { siteCount: 0, walkUpCount: 5, soonestDate: null }],
    ]);
    expect(computeFilteredParks(parks, null, null, avail).map((p) => p.parkPageId)).toEqual(["1"]);
  });
  it("does not pick up a CA park's counts for a federal park sharing the same parkPageId", () => {
    const federalPark = park({ provider: "recreation-gov", parkPageId: "1", latitude: 37, longitude: -122 });
    const avail = new Map<string, ParkAvailabilitySummary>([
      ["california-parks:1", { siteCount: 3, walkUpCount: 0, soonestDate: null }],
    ]);
    expect(computeFilteredParks([federalPark], null, null, avail)).toEqual([]);
  });
});

describe("buildListRows", () => {
  const parks = [park({ parkPageId: "1", latitude: 37, longitude: -122 })];
  it("includes walk-up-only parks (siteCount 0, walkUpCount > 0)", () => {
    const avail = new Map<string, ParkAvailabilitySummary>([["california-parks:1", { siteCount: 0, walkUpCount: 4, soonestDate: null }]]);
    const rows = buildListRows(parks, avail, { lat: 37, lon: -122, name: "x" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.walkUpCount).toBe(4);
    expect(rows[0]!.distanceMi).toBeCloseTo(0, 1);
  });
  it("excludes parks with no availability at all", () => {
    const avail = new Map<string, ParkAvailabilitySummary>([["california-parks:1", { siteCount: 0, walkUpCount: 0, soonestDate: null }]]);
    expect(buildListRows(parks, avail, null)).toEqual([]);
  });
  it("returns [] when availByPark is null", () => {
    expect(buildListRows(parks, null, null)).toEqual([]);
  });
  it("does not pick up a CA park's counts for a federal park sharing the same parkPageId", () => {
    const federalPark = park({ provider: "recreation-gov", parkPageId: "1", latitude: 37, longitude: -122 });
    const avail = new Map<string, ParkAvailabilitySummary>([["california-parks:1", { siteCount: 3, walkUpCount: 0, soonestDate: null }]]);
    expect(buildListRows([federalPark], avail, null)).toEqual([]);
  });
});

describe("availKey", () => {
  it("joins provider and parkPageId with a colon", () => {
    expect(availKey("california-parks", "413")).toBe("california-parks:413");
  });
});

describe("derivePinState", () => {
  const p = park({ parkPageId: "413" });

  it("shows every pin as match before the summary loads", () => {
    expect(derivePinState(p, null)).toEqual({ state: "match", count: undefined });
  });

  it("lights a pin whose park has bookable sites (regression: summary map is keyed by provider:parkPageId)", () => {
    const avail = buildAvailByPark([
      { providerId: "california-parks", parkPageId: "413", siteCount: 62, walkUpCount: 0, soonestDate: "2026-07-13" },
    ])!;
    expect(derivePinState(p, avail)).toEqual({ state: "match", count: 62 });
  });

  it("marks walk-up-only parks", () => {
    const avail = buildAvailByPark([
      { providerId: "california-parks", parkPageId: "413", siteCount: 0, walkUpCount: 2, soonestDate: null },
    ])!;
    expect(derivePinState(p, avail)).toEqual({ state: "walk-up", count: 2 });
  });

  it("greys parks absent from the summary", () => {
    expect(derivePinState(p, new Map())).toEqual({ state: "none", count: undefined });
  });

  it("does not light a federal pin from a CA park sharing the parkPageId", () => {
    const federal = park({ provider: "recreation-gov", parkPageId: "413" });
    const avail = buildAvailByPark([
      { providerId: "california-parks", parkPageId: "413", siteCount: 62, walkUpCount: 0, soonestDate: null },
    ])!;
    expect(derivePinState(federal, avail)).toEqual({ state: "none", count: undefined });
  });
});
