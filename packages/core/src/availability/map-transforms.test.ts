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
