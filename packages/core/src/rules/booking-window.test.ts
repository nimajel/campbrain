import { describe, it, expect } from "vitest";
import { expandArrivalDates, computeBookingWindows } from "@campbrain/core";
import type { BookingRule } from "@campbrain/types";

const CA: BookingRule = { monthsBefore: 6, releaseTime: "08:00", timezone: "America/Los_Angeles" };

describe("expandArrivalDates", () => {
  it("exact → the single date", () => {
    expect(expandArrivalDates({ kind: "exact", date: "2026-08-01" }, "2026-06-23")).toEqual(["2026-08-01"]);
  });
  it("range weekendsOnly keeps only Fri/Sat", () => {
    const d = expandArrivalDates({ kind: "range", from: "2026-08-01", to: "2026-08-09", weekendsOnly: true }, "2026-06-23");
    expect(d).toEqual(["2026-08-01", "2026-08-07", "2026-08-08"]); // Sat 1, Fri 7, Sat 8
  });
  it("rolling_weekends yields N Fri+Sat pairs from today", () => {
    const d = expandArrivalDates({ kind: "rolling_weekends", weeks: 2 }, "2026-06-23"); // Tue
    expect(d).toHaveLength(4);
    expect(d.every((x) => [5, 6].includes(new Date(x + "T12:00:00Z").getUTCDay()))).toBe(true);
  });
});

describe("computeBookingWindows (6mo / 8AM PT)", () => {
  it("arrival 2026-07-15 opens 2026-01-15 08:00 PT with the reminder cascade", () => {
    const [w] = computeBookingWindows({ kind: "exact", date: "2026-07-15" }, CA, "2026-06-23");
    expect(w!.arrivalDate).toBe("2026-07-15");
    expect(w!.bookingOpensAt).toBe("2026-01-15T16:00:00.000Z");
    expect(w!.reminders.sevenDaysBefore).toBe("2026-01-08T17:00:00.000Z");
    expect(w!.reminders.nightBefore).toBe("2026-01-15T04:00:00.000Z");
    expect(w!.reminders.tenMinutesBefore).toBe("2026-01-15T15:50:00.000Z");
  });
});
