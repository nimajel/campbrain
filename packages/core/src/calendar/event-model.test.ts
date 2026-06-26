import { describe, it, expect } from "vitest";
import { generateEventDrafts, reminderKey, hasEventChanged } from "@campbrain/core";
import type { BookingWindow } from "@campbrain/types";

const window: BookingWindow = {
  arrivalDate: "2026-07-15",
  bookingOpensAt: "2026-01-15T16:00:00.000Z",
  reminders: {
    sevenDaysBefore: "2026-01-08T17:00:00.000Z",
    nightBefore: "2026-01-15T04:00:00.000Z",
    tenMinutesBefore: "2026-01-15T15:50:00.000Z",
  },
};
const input = {
  targetId: "t1",
  targetName: "Angel Island Aug",
  parkName: "Angel Island SP",
  campgroundName: "Ridge",
  timeZone: "America/Los_Angeles",
  window,
};

describe("generateEventDrafts", () => {
  it("produces 3 drafts (prep/night-before/booking) with correct keys + times", () => {
    const d = generateEventDrafts(input);
    expect(d).toHaveLength(3);
    expect(d.map((x) => x.reminderType)).toEqual(["prep", "night-before", "booking"]);
    expect(d[0]!.key).toBe("t1|2026-07-15|prep");
    expect(d[0]!.startTimeIso).toBe("2026-01-08T17:00:00.000Z");
    expect(d[2]!.startTimeIso).toBe("2026-01-15T15:50:00.000Z");
    expect(d[0]!.endTimeIso).toBe("2026-01-08T17:30:00.000Z"); // +30 min
    expect(d.every((x) => x.summary.includes("Angel Island SP"))).toBe(true);
  });

  it("uses correct keys for all 3 reminder types", () => {
    const d = generateEventDrafts(input);
    expect(d[0]!.key).toBe("t1|2026-07-15|prep");
    expect(d[1]!.key).toBe("t1|2026-07-15|night-before");
    expect(d[2]!.key).toBe("t1|2026-07-15|booking");
  });

  it("sets targetId on every draft", () => {
    const d = generateEventDrafts(input);
    expect(d.every((x) => x.targetId === "t1")).toBe(true);
  });

  it("sets timeZone on every draft", () => {
    const d = generateEventDrafts(input);
    expect(d.every((x) => x.timeZone === "America/Los_Angeles")).toBe(true);
  });

  it("booking draft summary has BOOK NOW emphasis", () => {
    const d = generateEventDrafts(input);
    const booking = d[2]!;
    expect(booking.reminderType).toBe("booking");
    expect(booking.summary).toContain("BOOK NOW");
    expect(booking.summary).toContain("🔔");
  });

  it("prep and night-before drafts do NOT have BOOK NOW in summary", () => {
    const d = generateEventDrafts(input);
    expect(d[0]!.summary).not.toContain("BOOK NOW");
    expect(d[1]!.summary).not.toContain("BOOK NOW");
  });

  it("endTimeIso is 30 minutes after startTimeIso for all drafts", () => {
    const d = generateEventDrafts(input);
    expect(d[1]!.endTimeIso).toBe("2026-01-15T04:30:00.000Z");
    expect(d[2]!.endTimeIso).toBe("2026-01-15T16:20:00.000Z");
  });

  it("description includes target name, park, campground, and arrival date", () => {
    const d = generateEventDrafts(input);
    for (const draft of d) {
      expect(draft.description).toContain("Angel Island Aug");
      expect(draft.description).toContain("Angel Island SP");
      expect(draft.description).toContain("Ridge");
      expect(draft.description).toContain("2026-07-15");
    }
  });

  it("description includes checklist items and booking-open time", () => {
    const d = generateEventDrafts(input);
    for (const draft of d) {
      expect(draft.description).toContain("Log into reservation site");
      expect(draft.description).toContain("CampBrain does not book automatically");
      expect(draft.description).toContain("2026-01-15T16:00:00.000Z");
    }
  });

  it("handles null parkName and campgroundName gracefully", () => {
    const d = generateEventDrafts({ ...input, parkName: null, campgroundName: null });
    expect(d).toHaveLength(3);
    expect(d[0]!.summary).toBeTruthy();
  });
});

describe("reminderKey", () => {
  it("formats targetId|arrivalDate|type", () => {
    expect(reminderKey("t1", "2026-07-15", "booking")).toBe("t1|2026-07-15|booking");
  });

  it("works for prep and night-before types", () => {
    expect(reminderKey("abc", "2026-12-01", "prep")).toBe("abc|2026-12-01|prep");
    expect(reminderKey("abc", "2026-12-01", "night-before")).toBe("abc|2026-12-01|night-before");
  });
});

describe("hasEventChanged", () => {
  it("true when summary or start differs, false when same", () => {
    const [d] = generateEventDrafts(input);
    expect(hasEventChanged(d!, { summary: d!.summary, startTimeIso: d!.startTimeIso })).toBe(false);
    expect(hasEventChanged(d!, { summary: "different", startTimeIso: d!.startTimeIso })).toBe(true);
    expect(hasEventChanged(d!, { summary: d!.summary, startTimeIso: "2020-01-01T00:00:00.000Z" })).toBe(true);
  });

  it("false when both summary and startTimeIso match exactly", () => {
    const d = generateEventDrafts(input)[2]!;
    expect(hasEventChanged(d, { summary: d.summary, startTimeIso: d.startTimeIso })).toBe(false);
  });
});
