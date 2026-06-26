import { createHash } from "node:crypto";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import type { CalendarEventDraft } from "@campbrain/types";

export interface CalendarClient {
  insertEvent(draft: CalendarEventDraft): Promise<string>; // returns googleEventId
  updateEvent(eventId: string, draft: CalendarEventDraft): Promise<void>;
}

/**
 * Returns a deterministic Google Calendar event id for the given dedupe key.
 * Google requires base32hex charset (a-v + 0-9); SHA-256 hex (0-9a-f) is a valid subset.
 * Setting a caller-supplied id on insert makes re-inserts return 409 instead of duplicating.
 */
export function deterministicEventId(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface ClientConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string | null;
  expiryMs?: number | null;
}

function toGoogleEvent(draft: CalendarEventDraft) {
  return {
    summary: draft.summary,
    description: draft.description,
    start: { dateTime: draft.startTimeIso, timeZone: draft.timeZone },
    end: { dateTime: draft.endTimeIso, timeZone: draft.timeZone },
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup" as const, minutes: 10 }],
    },
  };
}

// Builds an OAuth2 client with the user's refresh token (google-auth-library auto-refreshes
// the access token on demand) + the googleapis calendar v3 client on calendarId 'primary'.
export function makeGoogleCalendarClient(cfg: ClientConfig): CalendarClient {
  const auth = new OAuth2Client(cfg.clientId, cfg.clientSecret);
  auth.setCredentials({
    refresh_token: cfg.refreshToken,
    access_token: cfg.accessToken ?? undefined,
    expiry_date: cfg.expiryMs ?? undefined,
  });
  const cal = google.calendar({ version: "v3", auth });
  return {
    async insertEvent(draft) {
      const deterministicId = deterministicEventId(draft.key);
      try {
        const res = await cal.events.insert({
          calendarId: "primary",
          requestBody: { ...toGoogleEvent(draft), id: deterministicId },
        });
        const id = res.data.id;
        if (!id) throw new Error("calendar insert returned no event id");
        return id;
      } catch (err: unknown) {
        // 409 = the event already exists (prior partial run created it but DB write failed).
        // Treat as success — the deterministic id lets us reconstruct it without a round-trip.
        const code =
          (err as { code?: number })?.code ??
          (err as { response?: { status?: number } })?.response?.status;
        if (code === 409) return deterministicId;
        throw err;
      }
    },
    async updateEvent(eventId, draft) {
      await cal.events.update({
        calendarId: "primary",
        eventId,
        requestBody: toGoogleEvent(draft),
      });
    },
  };
}
