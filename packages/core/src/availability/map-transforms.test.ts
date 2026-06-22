import { describe, it, expect } from "vitest";
import type { AvailabilityWindowEntry } from "./types";
import {
  buildDateSiteMap,
  sitesAvailableForDates,
  splitWalkUp,
  makeTaxonomyPredicate,
  addDays,
  isWeekendArrival,
  isInRange,
  parseDateLocal,
  dowLabel,
  todayIso,
  weekendFridaysFromAvailableDates,
  buildParkAvailability,
  toMapPark,
} from "./map-transforms";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const passAll = () => true;

function entry(
  cgName: string,
  sites: { name: string; dates: Record<string, "available" | "unavailable" | "unknown"> }[],
  windowStart = "2026-08-14",
  bookingUrl = "http://b",
  nightlyFee = 35,
): AvailabilityWindowEntry {
  return {
    parkPageId: "p",
    parkName: "P",
    windowStart,
    windowEnd: addDays(windowStart, 7),
    scannedAt: "2026-06-22T00:00:00Z",
    sourceUrl: "x",
    campgrounds: [{ id: "cg", name: cgName, bookingUrl, nightlyFee, sites }],
  };
}

// ---------------------------------------------------------------------------
// addDays
// ---------------------------------------------------------------------------

describe("addDays", () => {
  it("advances by N days", () => {
    expect(addDays("2026-08-14", 7)).toBe("2026-08-21");
  });

  it("handles month boundary", () => {
    expect(addDays("2026-01-29", 3)).toBe("2026-02-01");
  });

  it("n=0 returns same date", () => {
    expect(addDays("2026-06-22", 0)).toBe("2026-06-22");
  });
});

// ---------------------------------------------------------------------------
// isWeekendArrival
// ---------------------------------------------------------------------------

describe("isWeekendArrival", () => {
  it("Friday is a weekend arrival", () => {
    // 2026-06-19 is a Friday
    expect(isWeekendArrival("2026-06-19")).toBe(true);
  });

  it("Saturday is a weekend arrival", () => {
    // 2026-06-20 is a Saturday
    expect(isWeekendArrival("2026-06-20")).toBe(true);
  });

  it("Sunday is NOT a weekend arrival", () => {
    // 2026-06-21 is a Sunday
    expect(isWeekendArrival("2026-06-21")).toBe(false);
  });

  it("Monday is NOT a weekend arrival", () => {
    // 2026-06-22 is a Monday
    expect(isWeekendArrival("2026-06-22")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isInRange
// ---------------------------------------------------------------------------

describe("isInRange", () => {
  it("returns true when date equals from", () => {
    expect(isInRange("2026-08-01", "2026-08-01", "2026-08-10")).toBe(true);
  });

  it("returns true when date equals to", () => {
    expect(isInRange("2026-08-10", "2026-08-01", "2026-08-10")).toBe(true);
  });

  it("returns true when date is inside range", () => {
    expect(isInRange("2026-08-05", "2026-08-01", "2026-08-10")).toBe(true);
  });

  it("returns false when date is before from", () => {
    expect(isInRange("2026-07-31", "2026-08-01", "2026-08-10")).toBe(false);
  });

  it("returns false when date is after to", () => {
    expect(isInRange("2026-08-11", "2026-08-01", "2026-08-10")).toBe(false);
  });

  it("returns true with null to (open-ended)", () => {
    expect(isInRange("2026-12-31", "2026-08-01", null)).toBe(true);
  });

  it("returns true with undefined to (open-ended)", () => {
    expect(isInRange("2026-12-31", "2026-08-01", undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseDateLocal
// ---------------------------------------------------------------------------

describe("parseDateLocal", () => {
  it("returns correct year, month (0-based), and date for 2026-08-14", () => {
    const d = parseDateLocal("2026-08-14");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// dowLabel
// ---------------------------------------------------------------------------

describe("dowLabel", () => {
  it("formats 2026-06-06 as en-US short weekday+month+day", () => {
    expect(dowLabel("2026-06-06")).toBe("Sat, Jun 6");
  });
});

// ---------------------------------------------------------------------------
// todayIso
// ---------------------------------------------------------------------------

describe("todayIso", () => {
  it("returns YYYY-MM-DD from an injected Date", () => {
    expect(todayIso(new Date("2026-08-14T12:00:00Z"))).toBe("2026-08-14");
  });
});

// ---------------------------------------------------------------------------
// buildDateSiteMap
// ---------------------------------------------------------------------------

describe("buildDateSiteMap", () => {
  it("maps available sites by date and campground", () => {
    const e = entry("CG A", [
      { name: "Site 1", dates: { "2026-08-14": "available", "2026-08-15": "unavailable" } },
    ]);
    const map = buildDateSiteMap([e], passAll);
    expect(map.has("2026-08-14")).toBe(true);
    expect(map.has("2026-08-15")).toBe(false);
    expect(map.get("2026-08-14")?.get("CG A")?.sites).toEqual(["Site 1"]);
  });

  it("drops unavailable and unknown dates", () => {
    const e = entry("CG A", [
      { name: "Site 1", dates: { "2026-08-14": "unavailable", "2026-08-15": "unknown" } },
    ]);
    const map = buildDateSiteMap([e], passAll);
    expect(map.size).toBe(0);
  });

  it("dedupes a site that appears in two overlapping windows", () => {
    const e1 = entry("CG A", [
      { name: "Site 1", dates: { "2026-08-14": "available" } },
    ], "2026-08-10");
    const e2 = entry("CG A", [
      { name: "Site 1", dates: { "2026-08-14": "available" } },
    ], "2026-08-14");
    const map = buildDateSiteMap([e1, e2], passAll);
    expect(map.get("2026-08-14")?.get("CG A")?.sites).toEqual(["Site 1"]);
  });

  it("does not include sites filtered out by the passes predicate", () => {
    const e = entry("CG A", [
      { name: "Site 1", dates: { "2026-08-14": "available" } },
      { name: "Site 2", dates: { "2026-08-14": "available" } },
    ]);
    const map = buildDateSiteMap([e], (name) => name !== "Site 1");
    const sites = map.get("2026-08-14")?.get("CG A")?.sites ?? [];
    expect(sites).not.toContain("Site 1");
    expect(sites).toContain("Site 2");
  });

  it("preserves bookingUrl and nightlyFee on campground map entry", () => {
    const e = entry("CG A", [
      { name: "Site 1", dates: { "2026-08-14": "available" } },
    ], "2026-08-14", "http://booking", 55);
    const map = buildDateSiteMap([e], passAll);
    const cgEntry = map.get("2026-08-14")?.get("CG A");
    expect(cgEntry?.bookingUrl).toBe("http://booking");
    expect(cgEntry?.nightlyFee).toBe(55);
  });
});

// ---------------------------------------------------------------------------
// sitesAvailableForDates
// ---------------------------------------------------------------------------

describe("sitesAvailableForDates", () => {
  it("returns intersection: site available Fri+Sat but not Sun excluded from 3-night", () => {
    const e = entry("CG A", [
      { name: "Site 1", dates: { "2026-08-14": "available", "2026-08-15": "available", "2026-08-16": "unavailable" } },
      { name: "Site 2", dates: { "2026-08-14": "available", "2026-08-15": "available", "2026-08-16": "available" } },
    ]);
    const map = buildDateSiteMap([e], passAll);
    const twoNight = sitesAvailableForDates(map, "CG A", ["2026-08-14", "2026-08-15"]);
    const threeNight = sitesAvailableForDates(map, "CG A", ["2026-08-14", "2026-08-15", "2026-08-16"]);
    expect(twoNight).toContain("Site 1");
    expect(twoNight).toContain("Site 2");
    expect(threeNight).not.toContain("Site 1");
    expect(threeNight).toContain("Site 2");
  });

  it("returns empty array when dates is empty", () => {
    const map = new Map();
    expect(sitesAvailableForDates(map, "CG A", [])).toEqual([]);
  });

  it("returns empty array when campground not in map for a date", () => {
    const e = entry("CG A", [
      { name: "Site 1", dates: { "2026-08-14": "available" } },
    ]);
    const map = buildDateSiteMap([e], passAll);
    // "2026-08-15" has no entries
    expect(sitesAvailableForDates(map, "CG A", ["2026-08-14", "2026-08-15"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// splitWalkUp
// ---------------------------------------------------------------------------

describe("splitWalkUp", () => {
  it("routes hike/bike site to walkUp via injected predicate", () => {
    const isWalkUp = (name: string) => name.toLowerCase().includes("hike/bike");
    const { bookable, walkUp } = splitWalkUp(["Hike/Bike 1", "Site A", "Site B"], "CG", isWalkUp);
    expect(walkUp).toEqual(["Hike/Bike 1"]);
    expect(bookable).toEqual(["Site A", "Site B"]);
  });

  it("both arrays are sorted", () => {
    const isWalkUp = (name: string) => name.startsWith("W");
    const { bookable, walkUp } = splitWalkUp(["W-Beta", "B-Beta", "W-Alpha", "B-Alpha"], "CG", isWalkUp);
    expect(bookable).toEqual(["B-Alpha", "B-Beta"]);
    expect(walkUp).toEqual(["W-Alpha", "W-Beta"]);
  });

  it("returns all bookable when none match walk-up predicate", () => {
    const { bookable, walkUp } = splitWalkUp(["Site 1", "Site 2"], "CG", () => false);
    expect(bookable).toEqual(["Site 1", "Site 2"]);
    expect(walkUp).toEqual([]);
  });

  it("returns all walkUp when all match walk-up predicate", () => {
    const { bookable, walkUp } = splitWalkUp(["Site 1", "Site 2"], "CG", () => true);
    expect(bookable).toEqual([]);
    expect(walkUp).toEqual(["Site 1", "Site 2"]);
  });
});

// ---------------------------------------------------------------------------
// makeTaxonomyPredicate
// ---------------------------------------------------------------------------

describe("makeTaxonomyPredicate", () => {
  it("passes a normal drive-in site with no filters", () => {
    const pred = makeTaxonomyPredicate({});
    expect(pred("Site 1", "CG")).toBe(true);
  });

  it("drops day-use sites regardless of other filters", () => {
    const pred = makeTaxonomyPredicate({});
    // "Day Use Picnic" matches DAY_USE_RE
    expect(pred("Day Use Picnic", "CG")).toBe(false);
  });

  it("hide:walk_up removes hike/bike sites", () => {
    const pred = makeTaxonomyPredicate({ hide: ["walk_up"] });
    // "Hike/Bike 1" matches WALK_UP_RE → isWalkUp=true
    expect(pred("Hike/Bike 1", "CG")).toBe(false);
  });

  it("no hide filter passes hike/bike sites through", () => {
    const pred = makeTaxonomyPredicate({});
    // isWalkUp=true but not filtered out
    expect(pred("Hike/Bike 1", "CG")).toBe(true);
  });

  it("access filter: hike_in only — passes Environmental site, drops plain Site 1", () => {
    const pred = makeTaxonomyPredicate({ access: ["hike_in"] });
    // "Environmental Site 1" matches HIKE_IN_RE → access='hike_in'
    expect(pred("Environmental Site 1", "CG")).toBe(true);
    // "Site 1" → access='drive_in'
    expect(pred("Site 1", "CG")).toBe(false);
  });

  it("hike/bike site is drive_in access (not hike_in) — filtered out by access:hike_in", () => {
    const pred = makeTaxonomyPredicate({ access: ["hike_in"] });
    // WALK_UP_RE matches but HIKE_IN_RE does NOT match "Hike/Bike 1" → access='drive_in'
    expect(pred("Hike/Bike 1", "CG")).toBe(false);
  });

  it("kinds filter: tent only — passes tent site, drops NULL-kind site", () => {
    const pred = makeTaxonomyPredicate({ kinds: ["tent"] });
    // "Tent Site 1" matches TENT_RE → siteKind='tent'
    expect(pred("Tent Site 1", "CG")).toBe(true);
    // "Site 1" → siteKind=null → excluded when kinds is non-empty
    expect(pred("Site 1", "CG")).toBe(false);
  });

  it("kinds filter: hookup — drops tent site", () => {
    const pred = makeTaxonomyPredicate({ kinds: ["hookup"] });
    expect(pred("Tent Site 1", "CG")).toBe(false);
  });

  it("hide:group removes group sites", () => {
    const pred = makeTaxonomyPredicate({ hide: ["group"] });
    // "Group Site 1" matches GROUP_RE
    expect(pred("Group Site 1", "CG")).toBe(false);
    expect(pred("Site 1", "CG")).toBe(true);
  });

  it("hide:equestrian removes equestrian sites", () => {
    const pred = makeTaxonomyPredicate({ hide: ["equestrian"] });
    // "Equestrian Site 1" matches EQUESTRIAN_RE
    expect(pred("Equestrian Site 1", "CG")).toBe(false);
    expect(pred("Site 1", "CG")).toBe(true);
  });

  it("multiple filters compose (access:drive_in + hide:group)", () => {
    const pred = makeTaxonomyPredicate({ access: ["drive_in"], hide: ["group"] });
    expect(pred("Site 1", "CG")).toBe(true);
    expect(pred("Group Site 1", "CG")).toBe(false);
    // Environmental is hike_in → excluded by access filter
    expect(pred("Environmental Site 1", "CG")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// weekendFridaysFromAvailableDates
// ---------------------------------------------------------------------------

describe("weekendFridaysFromAvailableDates", () => {
  it("collapses Fri/Sat/Sun of one weekend to its anchor Friday", () => {
    // 2026-08-14 Fri, 2026-08-15 Sat, 2026-08-16 Sun → one Friday anchor
    expect(
      weekendFridaysFromAvailableDates(["2026-08-14", "2026-08-15", "2026-08-16"], "2026-08-01", Infinity),
    ).toEqual(["2026-08-14"]);
  });

  it("Saturday-only input rolls back one day to Friday anchor", () => {
    // 2026-08-15 is Saturday (dow=6) → subtract 1 → 2026-08-14
    expect(
      weekendFridaysFromAvailableDates(["2026-08-15"], "2026-08-01", Infinity),
    ).toEqual(["2026-08-14"]);
  });

  it("Sunday-only input rolls back two days to Friday anchor", () => {
    // 2026-08-16 is Sunday (dow=0) → subtract 2 → 2026-08-14
    expect(
      weekendFridaysFromAvailableDates(["2026-08-16"], "2026-08-01", Infinity),
    ).toEqual(["2026-08-14"]);
  });
});

// ---------------------------------------------------------------------------
// buildParkAvailability
// ---------------------------------------------------------------------------

describe("buildParkAvailability", () => {
  // 2026-08-14 is a Friday (getDay()===5), 08-15 Sat, 08-16 Sun.
  const friAnchorEntries: AvailabilityWindowEntry[] = [
    entry(
      "Loop A",
      [
        { name: "S1", dates: { "2026-08-14": "available", "2026-08-15": "available", "2026-08-16": "available" } },
        { name: "S2", dates: { "2026-08-14": "available" } },
        { name: "Hike/Bike 1", dates: { "2026-08-14": "available" } },
      ],
      "2026-08-14",
    ),
  ];

  // "now" before all the available dates so today=2026-08-01 keeps everything.
  const beforeWindow = new Date("2026-08-01T00:00:00Z");

  it("sets asOf to the latest scannedAt and earliestAvailableDate to the first date", () => {
    const res = buildParkAvailability(friAnchorEntries, {}, "p", beforeWindow);
    expect(res.asOf).toBe("2026-06-22T00:00:00Z");
    expect(res.earliestAvailableDate).toBe("2026-08-14");
    expect(res.parkName).toBe("P");
    expect(res.parkPageId).toBe("p");
  });

  it("nextAvailableDates: 08-14 entry splits bookable vs walk-up", () => {
    const res = buildParkAvailability(friAnchorEntries, {}, "p", beforeWindow);
    const day = res.nextAvailableDates.find((d) => d.date === "2026-08-14");
    expect(day).toBeDefined();
    expect(day!.isWeekend).toBe(true);
    expect(day!.campgrounds).toHaveLength(1);
    const cg = day!.campgrounds[0]!;
    expect(cg.name).toBe("Loop A");
    expect(cg.sites).toEqual(["S1", "S2"]);
    expect(cg.walkUpSites).toEqual(["Hike/Bike 1"]);
    expect(cg.availableSiteCount).toBe(2);
  });

  it("nextAvailableWeekends: one weekend with full tier breakdown", () => {
    const res = buildParkAvailability(friAnchorEntries, {}, "p", beforeWindow);
    expect(res.nextAvailableWeekends).toHaveLength(1);
    const wk = res.nextAvailableWeekends[0]!;
    expect(wk.fridayDate).toBe("2026-08-14");
    expect(wk.saturdayDate).toBe("2026-08-15");
    expect(wk.sundayDate).toBe("2026-08-16");
    expect(wk.campgrounds).toHaveLength(1);
    const cg = wk.campgrounds[0]!;
    expect(cg.name).toBe("Loop A");
    expect(cg.sites3Night).toEqual(["S1"]);
    expect(cg.sites2NightFri).toEqual(["S1"]);
    expect(cg.sites2NightSat).toEqual(["S1"]);
    expect(cg.sites1NightFri).toEqual(["S1", "S2"]);
    expect(cg.sites1NightSat).toEqual(["S1"]);
    expect(cg.walkUpSites).toEqual(["Hike/Bike 1"]);
  });

  it("range filter excluding all dates yields empty lists", () => {
    const res = buildParkAvailability(friAnchorEntries, { to: "2026-08-13" }, "p", beforeWindow);
    expect(res.nextAvailableDates).toEqual([]);
    expect(res.nextAvailableWeekends).toEqual([]);
    // earliestAvailableDate stays global (outside the requested range)
    expect(res.earliestAvailableDate).toBe("2026-08-14");
  });

  it("from=2026-08-15 (after the Friday) excludes 08-14 from dates and disables Friday-arrival tiers", () => {
    // rangeStart becomes "2026-08-15" since from > today.
    // nextAvailableDates only contains dates >= 08-15.
    // weekendFridaysFromAvailableDates still derives anchor 08-14 from Sat/Sun inputs,
    // but allowFridayArrival=false because 08-14 < rangeStart, so all Fri-arrival tiers
    // (sites3Night, sites2NightFri, sites1NightFri) are empty for that weekend.
    const res = buildParkAvailability(friAnchorEntries, { from: "2026-08-15" }, "p", beforeWindow);

    // 08-14 must not appear in nextAvailableDates
    expect(res.nextAvailableDates.map((d) => d.date)).not.toContain("2026-08-14");
    // 08-15 and 08-16 must appear (S1 is available on both)
    expect(res.nextAvailableDates.map((d) => d.date)).toContain("2026-08-15");
    expect(res.nextAvailableDates.map((d) => d.date)).toContain("2026-08-16");

    // One weekend entry anchored at 08-14
    expect(res.nextAvailableWeekends).toHaveLength(1);
    const wk = res.nextAvailableWeekends[0]!;
    expect(wk.fridayDate).toBe("2026-08-14");
    const cg = wk.campgrounds[0]!;
    expect(cg.name).toBe("Loop A");
    // Friday-arrival tiers all empty because 08-14 < rangeStart
    expect(cg.sites3Night).toEqual([]);
    expect(cg.sites2NightFri).toEqual([]);
    expect(cg.sites1NightFri).toEqual([]);
    // Saturday-arrival tiers still populated from S1 (available Sat+Sun)
    expect(cg.sites2NightSat).toEqual(["S1"]);
    expect(cg.sites1NightSat).toEqual(["S1"]);
  });

  it("empty entries returns the empty-shape response", () => {
    expect(buildParkAvailability([], {}, "p")).toEqual({
      parkPageId: "p",
      parkName: "",
      asOf: null,
      nextAvailableDates: [],
      nextAvailableWeekends: [],
      earliestAvailableDate: null,
    });
  });
});

// ---------------------------------------------------------------------------
// toMapPark
// ---------------------------------------------------------------------------

describe("toMapPark", () => {
  it("maps all fields correctly with multiple campgrounds", () => {
    const result = toMapPark({
      providerId: "california-parks",
      parkPageId: "468",
      parkName: "X",
      latitude: 38,
      longitude: -122,
      campgrounds: [
        { name: "A", siteCount: 3 },
        { name: "B", siteCount: 2 },
      ],
    });
    expect(result).toEqual({
      provider: "california-parks",
      parkName: "X",
      parkPageId: "468",
      latitude: 38,
      longitude: -122,
      campgroundCount: 2,
      siteCount: 5,
      campgrounds: [
        { name: "A", siteCount: 3 },
        { name: "B", siteCount: 2 },
      ],
    });
  });

  it("empty campgrounds yields campgroundCount=0 and siteCount=0", () => {
    expect(
      toMapPark({
        providerId: "california-parks",
        parkPageId: "1",
        parkName: "Empty Park",
        latitude: null,
        longitude: null,
        campgrounds: [],
      }),
    ).toEqual({
      provider: "california-parks",
      parkName: "Empty Park",
      parkPageId: "1",
      latitude: null,
      longitude: null,
      campgroundCount: 0,
      siteCount: 0,
      campgrounds: [],
    });
  });
});
