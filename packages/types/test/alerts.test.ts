import { describe, it, expect } from "vitest";
import { RecentOpeningSchema, DashboardStatsSchema } from "@campbrain/types";

describe("alerts DTOs", () => {
  it("RecentOpeningSchema accepts a valid opening", () => {
    const r = RecentOpeningSchema.parse({
      id: "h1", parkPageId: "606", parkName: "X", campgroundName: "Y", siteName: "Site 1",
      arrivalDate: "2026-08-01", nights: 2, bookingUrl: "https://r.example", firstSeenAt: "2026-06-23T00:00:00Z",
    });
    expect(r.nights).toBe(2);
  });
  it("RecentOpeningSchema allows null bookingUrl", () => {
    expect(RecentOpeningSchema.safeParse({
      id: "h1", parkPageId: "606", parkName: "X", campgroundName: "Y", siteName: "S",
      arrivalDate: "2026-08-01", nights: 1, bookingUrl: null, firstSeenAt: "2026-06-23T00:00:00Z",
    }).success).toBe(true);
  });
  it("DashboardStatsSchema requires three numeric counts", () => {
    const s = DashboardStatsSchema.parse({ activeAlerts: 2, currentMatches: 5, totalHits: 9 });
    expect(s).toEqual({ activeAlerts: 2, currentMatches: 5, totalHits: 9 });
  });
});
