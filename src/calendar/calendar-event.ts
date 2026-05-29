import type { Target } from '../config/schemas.js';
import type { BookingWindowInfo } from '../rules/booking-window.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CalendarReminderType = 'prep' | 'night-before' | 'booking';

export interface CalendarEventDraft {
  key: string;                  // dedupe key
  targetId: string;
  reminderType: CalendarReminderType;
  summary: string;              // Google Calendar event title
  description: string;
  startTimeIso: string;         // ISO 8601 in UTC
  endTimeIso: string;
  timeZone: string;
}

export interface CalendarEventRecord {
  key: string;
  googleEventId: string;
  summary: string;
  startTimeIso: string;
  lastSyncedAt: string;
}

export interface CalendarSyncState {
  events: Record<string, CalendarEventRecord>;
}

// ---------------------------------------------------------------------------
// Dedupe key
// ---------------------------------------------------------------------------

export function reminderKey(
  targetId: string,
  arrivalDate: string,
  reminderType: CalendarReminderType
): string {
  return `${targetId}|${arrivalDate}|${reminderType}`;
}

// ---------------------------------------------------------------------------
// Event description
// ---------------------------------------------------------------------------

function buildDescription(target: Target, window: BookingWindowInfo): string {
  const lines: string[] = [
    `Target:       ${target.name}`,
    `Park:         ${target.parkName}`,
    `Campground:   ${target.campgroundName}`,
    `Arrival:      ${window.arrivalDate}`,
    `Nights:       ${target.minNights}–${target.maxNights}`,
    `People:       ${target.people}`,
    `Camping type: ${target.campingType}`,
    `Acceptable:   ${target.acceptableSites.join(', ')}`,
    `Preferred:    ${target.preferredSites.join(', ')}`,
    `Booking opens: ${window.bookingOpenTime}`,
    '',
    '--- Checklist ---',
    '☐ Log into reservation site early',
    '☐ Confirm payment method is saved',
    '☐ Open the target campground page',
    '☐ Have backup dates / sites ready',
    '☐ Complete booking manually on the official site',
    '',
    '⚠️  CampBrain does not book automatically.',
    'You must complete the reservation yourself.',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Event drafts — 3 per booking window
// ---------------------------------------------------------------------------

const EVENT_DURATION_MS = 30 * 60 * 1000;

function toEndTime(startIso: string): string {
  return new Date(new Date(startIso).getTime() + EVENT_DURATION_MS).toISOString();
}

export function generateEventDrafts(
  target: Target,
  window: BookingWindowInfo
): CalendarEventDraft[] {
  const summary = `CampBrain: Book ${target.parkName} — ${target.campgroundName}`;
  const description = buildDescription(target, window);
  const tz = target.bookingRule.timezone;

  // Parse the reminder time strings (format: "YYYY-MM-DD HH:mm:ss ±HH:MM")
  function parseWindowTime(timeStr: string): string {
    // Normalize to ISO format: replace space with T, remove offset for Date parsing
    // e.g. "2026-01-14 08:00:00 -08:00" → new Date("2026-01-14T08:00:00-08:00")
    const iso = timeStr.replace(' ', 'T').replace(/(\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/, '$1$2');
    return new Date(iso).toISOString();
  }

  const prep: CalendarEventDraft = {
    key: reminderKey(target.id, window.arrivalDate, 'prep'),
    targetId: target.id,
    reminderType: 'prep',
    summary,
    description,
    startTimeIso: parseWindowTime(window.reminderSevenDaysBefore),
    endTimeIso: toEndTime(parseWindowTime(window.reminderSevenDaysBefore)),
    timeZone: tz,
  };

  const nightBefore: CalendarEventDraft = {
    key: reminderKey(target.id, window.arrivalDate, 'night-before'),
    targetId: target.id,
    reminderType: 'night-before',
    summary,
    description,
    startTimeIso: parseWindowTime(window.reminderNightBefore),
    endTimeIso: toEndTime(parseWindowTime(window.reminderNightBefore)),
    timeZone: tz,
  };

  const booking: CalendarEventDraft = {
    key: reminderKey(target.id, window.arrivalDate, 'booking'),
    targetId: target.id,
    reminderType: 'booking',
    summary: `🔔 ${summary} — BOOK NOW`,
    description,
    startTimeIso: parseWindowTime(window.reminderTenMinutesBefore),
    endTimeIso: toEndTime(parseWindowTime(window.reminderTenMinutesBefore)),
    timeZone: tz,
  };

  return [prep, nightBefore, booking];
}

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

export function hasEventChanged(
  draft: CalendarEventDraft,
  existing: CalendarEventRecord
): boolean {
  return draft.summary !== existing.summary || draft.startTimeIso !== existing.startTimeIso;
}
