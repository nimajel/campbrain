import { describe, it, expect } from "vitest";
import {
  haversine, todayIso, addDaysIso, formatDate, relativeDate, isoDow, rangeHasWeekendDay,
} from "./map-utils";

describe("haversine", () => {
  it("returns ~0 for identical points", () => {
    expect(haversine(37.7, -122.4, 37.7, -122.4)).toBeCloseTo(0, 5);
  });
  it("returns ~347 miles SF→LA", () => {
    expect(haversine(37.77, -122.42, 34.05, -118.24)).toBeGreaterThan(340);
    expect(haversine(37.77, -122.42, 34.05, -118.24)).toBeLessThan(355);
  });
});

describe("addDaysIso", () => {
  it("adds days across a month boundary", () => {
    expect(addDaysIso("2026-06-30", 2)).toBe("2026-07-02");
  });
  it("subtracts with negatives", () => {
    expect(addDaysIso("2026-07-01", -1)).toBe("2026-06-30");
  });
});

describe("formatDate", () => {
  it("formats an ISO date as 'Fri, Jun 5'", () => {
    expect(formatDate("2026-06-05")).toBe("Fri, Jun 5");
  });
  it("returns '' for empty input", () => {
    expect(formatDate("")).toBe("");
  });
});

describe("relativeDate", () => {
  it("returns the day before, month+day only", () => {
    expect(relativeDate("2026-06-05")).toBe("Jun 4");
  });
});

describe("isoDow", () => {
  it("returns 5 for a Friday", () => {
    expect(isoDow("2026-06-05")).toBe(5);
  });
  it("returns 0 for a Sunday", () => {
    expect(isoDow("2026-06-07")).toBe(0);
  });
});

describe("rangeHasWeekendDay", () => {
  it("true when the range spans a Fri/Sat", () => {
    expect(rangeHasWeekendDay("2026-06-05", "2026-06-08")).toBe(true);
  });
  it("false for a Mon–Thu range", () => {
    expect(rangeHasWeekendDay("2026-06-08", "2026-06-11")).toBe(false);
  });
  it("true (open range) when from or to missing", () => {
    expect(rangeHasWeekendDay("", "2026-06-08")).toBe(true);
  });
});

describe("todayIso", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
