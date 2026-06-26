import { describe, it, expect } from "vitest";
import { ReminderTypeSchema, CalendarConnectionStatusSchema, CalendarEventDraftSchema, ScanRunKind } from "@campbrain/types";

describe("calendar schemas", () => {
  it("ReminderTypeSchema accepts the three reminder types", () => {
    expect(ReminderTypeSchema.parse("prep")).toBe("prep");
    expect(ReminderTypeSchema.parse("night-before")).toBe("night-before");
    expect(ReminderTypeSchema.parse("booking")).toBe("booking");
    expect(ReminderTypeSchema.safeParse("other").success).toBe(false);
  });
  it("CalendarConnectionStatusSchema: connected + optional connectedAt", () => {
    expect(CalendarConnectionStatusSchema.parse({ connected: false })).toEqual({ connected: false });
    expect(CalendarConnectionStatusSchema.parse({ connected: true, connectedAt: "2026-06-23T00:00:00Z" }).connected).toBe(true);
  });
  it("CalendarEventDraftSchema accepts a full draft", () => {
    const d = CalendarEventDraftSchema.parse({
      key: "t1|2026-08-01|prep", targetId: "t1", reminderType: "prep",
      summary: "CampBrain: Book X", description: "…",
      startTimeIso: "2026-02-01T17:00:00.000Z", endTimeIso: "2026-02-01T17:30:00.000Z", timeZone: "America/Los_Angeles",
    });
    expect(d.reminderType).toBe("prep");
  });
  it("ScanRunKind now accepts 'calendar'", () => {
    expect(ScanRunKind.parse("calendar")).toBe("calendar");
    expect(ScanRunKind.parse("proactive")).toBe("proactive");
    expect(ScanRunKind.parse("alert")).toBe("alert");
  });
});
