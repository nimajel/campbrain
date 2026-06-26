import dayjs from "dayjs";
import type { BookingWindow, CalendarEventDraft, ReminderType } from "@campbrain/types";

// ---------------------------------------------------------------------------
// Input shape (2b-2 BookingWindow adapted)
// ---------------------------------------------------------------------------

export interface DraftInput {
  targetId: string;
  targetName: string;
  parkName: string | null;
  campgroundName: string | null;
  timeZone: string;
  window: BookingWindow;
}

// ---------------------------------------------------------------------------
// Dedupe key
// ---------------------------------------------------------------------------

export function reminderKey(
  targetId: string,
  arrivalDate: string,
  t: ReminderType
): string {
  return `${targetId}|${arrivalDate}|${t}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function addThirtyMinutes(isoString: string): string {
  return dayjs(isoString).add(30, "minute").toISOString();
}

function buildSummary(parkName: string | null, campgroundName: string | null): string {
  const park = parkName ?? "Unknown Park";
  const camp = campgroundName ?? "Unknown Campground";
  return `CampBrain: Book ${park} — ${camp}`;
}

function buildDescription(input: DraftInput): string {
  const { targetName, parkName, campgroundName, window } = input;
  const lines: string[] = [
    `Target:        ${targetName}`,
    `Park:          ${parkName ?? "Unknown Park"}`,
    `Campground:    ${campgroundName ?? "Unknown Campground"}`,
    `Arrival:       ${window.arrivalDate}`,
    `Booking opens: ${window.bookingOpensAt}`,
    "",
    "--- Checklist ---",
    "☐ Log into reservation site early",
    "☐ Confirm payment method is saved",
    "☐ Open the target campground page",
    "☐ Have backup dates / sites ready",
    "☐ Complete booking manually on the official site",
    "",
    "⚠️  CampBrain does not book automatically.",
    "You must complete the reservation yourself.",
    "",
    "Verify availability on the official reservation site before booking.",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Event drafts — exactly 3 per booking window
// ---------------------------------------------------------------------------

export function generateEventDrafts(input: DraftInput): CalendarEventDraft[] {
  const { targetId, timeZone, window } = input;
  const baseSummary = buildSummary(input.parkName, input.campgroundName);
  const description = buildDescription(input);

  const reminderMap: Array<{ type: ReminderType; startIso: string }> = [
    { type: "prep", startIso: window.reminders.sevenDaysBefore },
    { type: "night-before", startIso: window.reminders.nightBefore },
    { type: "booking", startIso: window.reminders.tenMinutesBefore },
  ];

  return reminderMap.map(({ type, startIso }) => {
    const isBooking = type === "booking";
    const summary = isBooking ? `🔔 ${baseSummary} — BOOK NOW` : baseSummary;
    return {
      key: reminderKey(targetId, window.arrivalDate, type),
      targetId,
      reminderType: type,
      summary,
      description,
      startTimeIso: startIso,
      endTimeIso: addThirtyMinutes(startIso),
      timeZone,
    };
  });
}

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

export function hasEventChanged(
  draft: CalendarEventDraft,
  existing: { summary: string; startTimeIso: string }
): boolean {
  return draft.summary !== existing.summary || draft.startTimeIso !== existing.startTimeIso;
}
