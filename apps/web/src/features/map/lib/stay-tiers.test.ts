import { describe, it, expect } from "vitest";
import type { WeekendCampground, AvailableDateEntry } from "@campbrain/core";
import { selectWeekendTiers, intersectConsecutiveDates } from "./stay-tiers";

function cg(over: Partial<WeekendCampground>): WeekendCampground {
  return {
    name: "Loop A",
    nightlyFee: 35,
    sites3Night: [],
    sites2NightFri: [],
    sites2NightSat: [],
    sites1NightFri: [],
    sites1NightSat: [],
    walkUpSites: [],
    ...over,
  };
}

describe("selectWeekendTiers", () => {
  it("minNights=null: full 3N suppresses the shorter tiers", () => {
    const r = selectWeekendTiers(cg({ sites3Night: ["1"], sites2NightFri: ["1"], sites1NightFri: ["1"] }), null);
    expect(r).toEqual({ line3: true, line2Fri: false, line2Sat: false, line1Fri: false, line1Sat: false });
  });
  it("minNights=null: with no 3N, a 2N-Fri suppresses 1N", () => {
    const r = selectWeekendTiers(cg({ sites2NightFri: ["1"], sites1NightFri: ["1"], sites1NightSat: ["2"] }), null);
    expect(r).toEqual({ line3: false, line2Fri: true, line2Sat: false, line1Fri: false, line1Sat: false });
  });
  it("minNights=null: only 1N available shows both 1N lines", () => {
    const r = selectWeekendTiers(cg({ sites1NightFri: ["1"], sites1NightSat: ["2"] }), null);
    expect(r).toEqual({ line3: false, line2Fri: false, line2Sat: false, line1Fri: true, line1Sat: true });
  });
  it("minNights=1: forces 1N lines even when longer stays exist", () => {
    const r = selectWeekendTiers(cg({ sites3Night: ["1"], sites1NightFri: ["1"] }), 1);
    expect(r).toEqual({ line3: false, line2Fri: false, line2Sat: false, line1Fri: true, line1Sat: false });
  });
  it("minNights=2: shows 3N and 2N, never 1N", () => {
    const r = selectWeekendTiers(cg({ sites2NightSat: ["1"], sites1NightSat: ["1"] }), 2);
    expect(r).toEqual({ line3: false, line2Fri: false, line2Sat: true, line1Fri: false, line1Sat: false });
  });
  it("minNights=3: only the 3N tier, never 2N/1N", () => {
    const r = selectWeekendTiers(cg({ sites3Night: ["1"], sites2NightFri: ["1"], sites1NightFri: ["1"] }), 3);
    expect(r).toEqual({ line3: true, line2Fri: false, line2Sat: false, line1Fri: false, line1Sat: false });
  });
  it("minNights=3 with no 3N stay: nothing visible", () => {
    const r = selectWeekendTiers(cg({ sites2NightFri: ["1"], sites1NightFri: ["1"] }), 3);
    expect(r).toEqual({ line3: false, line2Fri: false, line2Sat: false, line1Fri: false, line1Sat: false });
  });
});

describe("intersectConsecutiveDates", () => {
  function entry(date: string, sites: string[]): AvailableDateEntry {
    return {
      date,
      dayLabel: date,
      isWeekend: false,
      campgrounds: [
        { name: "Loop A", nightlyFee: 35, availableSiteCount: sites.length, sites, walkUpSites: [] },
      ],
    };
  }

  it("returns input unchanged for minNights null", () => {
    const dates = [entry("2026-06-05", ["1"])];
    expect(intersectConsecutiveDates(dates, null)).toBe(dates);
  });
  it("returns input unchanged for minNights 1", () => {
    const dates = [entry("2026-06-05", ["1"])];
    expect(intersectConsecutiveDates(dates, 1)).toBe(dates);
  });
  it("minNights=2: keeps only dates with a 2-night chain, intersecting sites", () => {
    const dates = [
      entry("2026-06-05", ["1", "2"]),
      entry("2026-06-06", ["1"]),
    ];
    const out = intersectConsecutiveDates(dates, 2);
    expect(out).toHaveLength(1);
    expect(out[0]!.date).toBe("2026-06-05");
    expect(out[0]!.campgrounds[0]!.sites).toEqual(["1"]);
    expect(out[0]!.campgrounds[0]!.availableSiteCount).toBe(1);
    expect(out[0]!.campgrounds[0]!.walkUpSites).toEqual([]);
  });
  it("minNights=2: drops a date when the next day is missing entirely", () => {
    const dates = [entry("2026-06-05", ["1"])];
    expect(intersectConsecutiveDates(dates, 2)).toEqual([]);
  });
  it("minNights=3: requires three consecutive days; site available all three survives", () => {
    const dates = [
      entry("2026-06-05", ["1"]),
      entry("2026-06-06", ["1"]),
      entry("2026-06-07", ["1"]),
    ];
    const out = intersectConsecutiveDates(dates, 3);
    expect(out).toHaveLength(1);
    expect(out[0]!.date).toBe("2026-06-05");
    expect(out[0]!.campgrounds[0]!.sites).toEqual(["1"]);
  });
  it("minNights=3: a Fri-only site does not survive a 3-night chain", () => {
    const dates = [
      entry("2026-06-05", ["1"]),
      entry("2026-06-06", []),
      entry("2026-06-07", ["1"]),
    ];
    expect(intersectConsecutiveDates(dates, 3)).toEqual([]);
  });
});
