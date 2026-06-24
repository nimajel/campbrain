import { describe, it, expect } from "vitest";
import { TargetInputSchema, TargetDatePatternSchema, BookingRuleSchema } from "@campbrain/types";

describe("target schemas", () => {
  it("BookingRuleSchema defaults to CA rule", () => {
    expect(BookingRuleSchema.parse({})).toEqual({ monthsBefore: 6, releaseTime: "08:00", timezone: "America/Los_Angeles" });
  });
  it("datePattern accepts the three kinds", () => {
    expect(TargetDatePatternSchema.parse({ kind: "exact", date: "2026-08-01" }).kind).toBe("exact");
    expect(TargetDatePatternSchema.parse({ kind: "range", from: "2026-08-01", to: "2026-08-31", weekendsOnly: true }).kind).toBe("range");
    expect(TargetDatePatternSchema.parse({ kind: "rolling_weekends", weeks: 12 }).kind).toBe("rolling_weekends");
  });
  it("rejects a bad release time + a 0-week rolling pattern", () => {
    expect(BookingRuleSchema.safeParse({ releaseTime: "8am" }).success).toBe(false);
    expect(TargetDatePatternSchema.safeParse({ kind: "rolling_weekends", weeks: 0 }).success).toBe(false);
  });
  it("TargetInputSchema accepts a full input", () => {
    const t = TargetInputSchema.parse({
      userId: null, provider: "california-parks", name: "Angel Island Aug",
      scope: { parkPageId: "468", parkName: "Angel Island SP", campgroundName: null },
      datePattern: { kind: "rolling_weekends", weeks: 8 },
      bookingRule: {}, enabled: true, calendarEnabled: false,
    });
    expect(t.bookingRule.monthsBefore).toBe(6);
  });
});
