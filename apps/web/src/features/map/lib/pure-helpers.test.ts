import { describe, it, expect } from "vitest";
import { injectBookingDates } from "@/lib/booking-url";
import { formatSiteName } from "./site-display";
import { upcomingWeekendRange } from "./upcoming-weekend";
import { sortParkRows, type ParkListRow } from "./park-list";
import { cycleDetent } from "./sheet-detent";

describe("injectBookingDates", () => {
  it("overwrites date + night params", () => {
    const out = injectBookingDates("https://x.com/r?date=2026-11-22&night=1", "2026-07-04", 3);
    expect(out).toContain("date=2026-07-04");
    expect(out).toContain("night=3");
  });
  it("returns the original string when the URL is unparseable", () => {
    expect(injectBookingDates("not-a-url", "2026-07-04", 2)).toBe("not-a-url");
  });
});

describe("formatSiteName", () => {
  it("title-cases all-caps words", () => {
    expect(formatSiteName("UPPER PINES")).toBe("Upper Pines");
  });
  it("leaves #-prefixed codes and digit tokens untouched", () => {
    expect(formatSiteName("#GTC 12B")).toBe("#GTC 12B");
  });
});

describe("upcomingWeekendRange", () => {
  it("returns Fri→Mon for a Wednesday", () => {
    const r = upcomingWeekendRange(new Date(2026, 5, 3));
    expect(r).toEqual({ from: "2026-06-05", to: "2026-06-08" });
  });
  it("keeps the in-progress weekend on Saturday (today→Mon)", () => {
    const r = upcomingWeekendRange(new Date(2026, 5, 6));
    expect(r).toEqual({ from: "2026-06-06", to: "2026-06-08" });
  });
});

describe("sortParkRows", () => {
  const rows: ParkListRow[] = [
    { parkPageId: "1", parkName: "Bravo", isFederal: false, siteCount: 2, walkUpCount: 0, distanceMi: 30, soonestDate: "2026-07-10" },
    { parkPageId: "2", parkName: "Alpha", isFederal: false, siteCount: 5, walkUpCount: 0, distanceMi: 10, soonestDate: "2026-07-05" },
    { parkPageId: "3", parkName: "Charlie", isFederal: false, siteCount: 5, walkUpCount: 0, distanceMi: null, soonestDate: null },
  ];
  it("sorts by sites desc, name asc as tiebreak", () => {
    expect(sortParkRows(rows, "sites").map((r) => r.parkPageId)).toEqual(["2", "3", "1"]);
  });
  it("sorts by name", () => {
    expect(sortParkRows(rows, "name").map((r) => r.parkName)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });
  it("sorts by distance, nulls last", () => {
    expect(sortParkRows(rows, "distance").map((r) => r.parkPageId)).toEqual(["2", "1", "3"]);
  });
  it("sorts by soonest, nulls last", () => {
    expect(sortParkRows(rows, "soonest").map((r) => r.parkPageId)).toEqual(["2", "1", "3"]);
  });
});

describe("cycleDetent", () => {
  it("cycles peek → half → full → peek", () => {
    expect(cycleDetent("peek")).toBe("half");
    expect(cycleDetent("half")).toBe("full");
    expect(cycleDetent("full")).toBe("peek");
  });
});
