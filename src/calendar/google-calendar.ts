import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { CalendarEventDraft } from './calendar-event.js';

const CALENDAR_ID = 'primary';

function toGoogleEvent(draft: CalendarEventDraft) {
  return {
    summary: draft.summary,
    description: draft.description,
    start: {
      dateTime: draft.startTimeIso,
      timeZone: draft.timeZone,
    },
    end: {
      dateTime: draft.endTimeIso,
      timeZone: draft.timeZone,
    },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 10 }],
    },
  };
}

export async function createCalendarEvent(
  auth: OAuth2Client,
  draft: CalendarEventDraft
): Promise<string> {
  const calendar = google.calendar({ version: 'v3', auth });
  const response = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: toGoogleEvent(draft),
  });
  return response.data.id ?? '';
}

export async function updateCalendarEvent(
  auth: OAuth2Client,
  draft: CalendarEventDraft,
  googleEventId: string
): Promise<void> {
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.update({
    calendarId: CALENDAR_ID,
    eventId: googleEventId,
    requestBody: toGoogleEvent(draft),
  });
}
