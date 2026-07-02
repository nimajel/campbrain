import { describe, it, expect } from "vitest";
import type { AvailabilityWindowEntry } from "./types";
import { addDays, buildParkAvailability } from "./map-transforms";
import type { MapAvailabilityFilters } from "./map-transforms";
import { buildSiteClassMap, filterDigest } from "./digest";

const PARK_ID = "p";
const NOW = new Date("2026-06-22T12:00:00Z"); // Monday 2026-06-22

// Weekend anchor: 2026-08-14 is a Friday, 08-15 Sat, 08-16 Sun.
const FRI = "2026-08-14";
const SAT = "2026-08-15";
const SUN = "2026-08-16";
const WEEKDAY = "2026-08-19"; // Wednesday

type Status = "available" | "unavailable" | "unknown";

function site(name: string, dates: Record<string, Status>) {
  return { name, dates };
}

function entry(
  cgName: string,
  sites: { name: string; dates: Record<string, Status> }[],
  windowStart: string,
): AvailabilityWindowEntry {
  return {
    parkPageId: PARK_ID,
    parkName: "Big Park",
    windowStart,
    windowEnd: addDays(windowStart, 7),
    scannedAt: "2026-06-22T00:00:00Z",
    sourceUrl: "x",
    campgrounds: [{ id: cgName, name: cgName, bookingUrl: "http://b", nightlyFee: 35, sites }],
  };
}

// A representative fixture: two campgrounds; tent/hookup/cabin/NULL-kind/group/
// equestrian/walk-up/hike-in/boat-in sites; overlapping windows; weekend + weekday.
function makeEntries(): AvailabilityWindowEntry[] {
  const weekendDates: Record<string, Status> = {
    [FRI]: "available",
    [SAT]: "available",
    [SUN]: "available",
  };
  const weekdayDates: Record<string, Status> = { [WEEKDAY]: "available" };

  // Window A (starts 2026-08-14) — full weekend grid.
  const windowA = entry(
    "River Campground",
    [
      site("Tent Site #1", weekendDates),
      site("Full Hookup Site #2", weekendDates),
      site("Camping Cabin #3", weekendDates),
      site("Standard Site #4", weekendDates), // NULL kind, drive_in
      site("Group Tent Campsite #G1", weekendDates),
      site("Equestrian Site #E1", weekendDates),
      site("Hike/Bike Campsite #HB1", weekendDates), // walk-up, Fri+Sat+Sun
      site("Hike/Bike Campsite #HB2", { [FRI]: "available" }), // walk-up, FRIDAY ONLY
      site("Hike/Bike Campsite #HB3", { [SAT]: "available", [SUN]: "available" }), // walk-up, SATURDAY ONLY
      site("Hike In Environmental Site #7", weekendDates), // hike_in
      site("Boat In Primitive Campsite #8", weekendDates), // boat_in
      site("Day Use Picnic Area #9", weekendDates), // day-use, must be omitted
    ],
    FRI,
  );

  // Window B (starts 2026-08-11) — OVERLAPS window A on the weekend dates plus
  // adds a weekday date. Repeats some site names to exercise dedupe.
  const windowB = entry(
    "River Campground",
    [
      site("Tent Site #1", { ...weekendDates, ...weekdayDates }),
      site("Full Hookup Site #2", weekdayDates),
      site("Standard Site #4", weekdayDates),
      site("Hike/Bike Campsite #HB1", weekdayDates),
    ],
    "2026-08-11",
  );

  // A second campground with only a NULL-kind + tent site on the weekend.
  const windowC = entry(
    "Meadow Campground",
    [
      site("Meadow Tent Site #1", weekendDates),
      site("Meadow Standard Site #2", weekendDates), // NULL kind
    ],
    FRI,
  );

  return [windowA, windowB, windowC];
}

const FILTER_MATRIX: { label: string; f: MapAvailabilityFilters }[] = [
  { label: "empty {}", f: {} },
  { label: "access drive_in", f: { access: ["drive_in"] } },
  { label: "access hike_in", f: { access: ["hike_in"] } },
  { label: "access boat_in", f: { access: ["boat_in"] } },
  { label: "kind tent", f: { kinds: ["tent"] } },
  { label: "kind hookup", f: { kinds: ["hookup"] } },
  { label: "kind cabin", f: { kinds: ["cabin"] } },
  { label: "hide group", f: { hide: ["group"] } },
  { label: "hide equestrian", f: { hide: ["equestrian"] } },
  { label: "hide walk_up", f: { hide: ["walk_up"] } },
  {
    label: "combined access+kinds+hide",
    f: { access: ["drive_in"], kinds: ["tent", "hookup"], hide: ["group", "walk_up"] },
  },
  { label: "date range sub-window", f: { from: WEEKDAY, to: WEEKDAY } },
  { label: "date range weekend only", f: { from: FRI, to: SAT } },
  { label: "date range from Saturday", f: { from: SAT } },
  { label: "date range Saturday only", f: { from: SAT, to: SAT } },
];

describe("buildSiteClassMap", () => {
  it("classifies every distinct non-day-use site and omits day-use", () => {
    const map = buildSiteClassMap(makeEntries(), PARK_ID);

    expect("Day Use Picnic Area #9" in map).toBe(false);

    expect(map["Tent Site #1"]).toMatchObject({ access: "drive_in", siteKind: "tent" });
    expect(map["Full Hookup Site #2"]).toMatchObject({ access: "drive_in", siteKind: "hookup" });
    expect(map["Camping Cabin #3"]).toMatchObject({ access: "drive_in", siteKind: "cabin" });
    expect(map["Standard Site #4"]).toMatchObject({ access: "drive_in", siteKind: null });
    expect(map["Group Tent Campsite #G1"]).toMatchObject({ isGroup: true });
    expect(map["Equestrian Site #E1"]).toMatchObject({ isEquestrian: true });
    expect(map["Hike/Bike Campsite #HB1"]).toMatchObject({ isWalkUp: true });
    expect(map["Hike/Bike Campsite #HB2"]).toMatchObject({ isWalkUp: true });
    expect(map["Hike/Bike Campsite #HB3"]).toMatchObject({ isWalkUp: true });
    expect(map["Hike In Environmental Site #7"]).toMatchObject({ access: "hike_in" });
    expect(map["Boat In Primitive Campsite #8"]).toMatchObject({ access: "boat_in" });
    expect(map["Meadow Standard Site #2"]).toMatchObject({ siteKind: null });
  });

  it("respects PARK_ACCESS_OVERRIDES (Angel Island 468)", () => {
    const entries = [
      entry("Angel Island", [site("Campsite #7", { [FRI]: "available" })], FRI),
    ];
    const plain = buildSiteClassMap(entries);
    expect(plain["Campsite #7"]!.access).toBe("drive_in");

    const overridden = buildSiteClassMap(entries, "468");
    expect(overridden["Campsite #7"]!.access).toBe("hike_in");
  });
});

describe("filterDigest equivalence vs buildParkAvailability", () => {
  const entries = makeEntries();
  const siteClass = buildSiteClassMap(entries, PARK_ID);
  const unfiltered = buildParkAvailability(entries, {}, PARK_ID, NOW);

  for (const { label, f } of FILTER_MATRIX) {
    it(`matches for filter: ${label}`, () => {
      const direct = buildParkAvailability(entries, f, PARK_ID, NOW);
      const viaDigest = filterDigest(unfiltered, siteClass, f, NOW);
      expect(viaDigest).toEqual(direct);
      // Non-vacuity: every matrix case must yield real availability so the
      // equivalence proves something (empty === empty is meaningless).
      expect(direct.nextAvailableDates.length).toBeGreaterThan(0);
    });
  }

  it("hide walk_up drops walkUpSites arrays", () => {
    const viaDigest = filterDigest(unfiltered, siteClass, { hide: ["walk_up"] }, NOW);
    for (const d of viaDigest.nextAvailableDates) {
      for (const cg of d.campgrounds) expect(cg.walkUpSites).toHaveLength(0);
    }
    for (const w of viaDigest.nextAvailableWeekends) {
      for (const cg of w.campgrounds) expect(cg.walkUpSites).toHaveLength(0);
    }
  });

  it("weekend walk-up split: Friday-only site excluded when Friday is out of range", () => {
    // Regression for the merged-walkUpSites leak: HB2 is Friday-only. When the
    // filter range starts Saturday, the reference (buildParkAvailability) must
    // NOT surface HB2 in the weekend's walkUpSites.
    const f: MapAvailabilityFilters = { from: SAT };
    const direct = buildParkAvailability(entries, f, PARK_ID, NOW);
    const viaDigest = filterDigest(unfiltered, siteClass, f, NOW);
    const directWk = direct.nextAvailableWeekends.find((w) => w.fridayDate === FRI);
    const digestWk = viaDigest.nextAvailableWeekends.find((w) => w.fridayDate === FRI);
    const directCg = directWk?.campgrounds.find((c) => c.name === "River Campground");
    const digestCg = digestWk?.campgrounds.find((c) => c.name === "River Campground");

    expect(directCg?.walkUpSites).not.toContain("Hike/Bike Campsite #HB2");
    expect(digestCg?.walkUpSites).toEqual(directCg?.walkUpSites);
    // Saturday-only HB3 must still be present (proves this isn't just an
    // over-broad drop).
    expect(directCg?.walkUpSites).toContain("Hike/Bike Campsite #HB3");
  });

  it("weekend tiers survive (3N/2N/1N)", () => {
    const direct = buildParkAvailability(entries, {}, PARK_ID, NOW);
    const wk = direct.nextAvailableWeekends.find((w) => w.fridayDate === FRI);
    expect(wk).toBeDefined();
    const cg = wk!.campgrounds.find((c) => c.name === "River Campground");
    expect(cg!.sites3Night.length).toBeGreaterThan(0);
    expect(cg!.sites2NightFri.length).toBeGreaterThan(0);
    expect(cg!.sites1NightFri.length).toBeGreaterThan(0);
  });
});
