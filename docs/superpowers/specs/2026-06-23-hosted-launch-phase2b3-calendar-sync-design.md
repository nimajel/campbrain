# CampBrain Hosted Launch — Phase 2b-3 (Google Calendar Sync) Design

**Status:** drafted 2026-06-23 — **REVIEW + the "Manual setup you must provide" section before implementation.** Implementation is gated on a Google OAuth client you provision (see bottom).
**Branch:** `hosted-launch`. Builds on 2b-2 (booking-window targets) — makes the inert `targets.calendar_enabled` flag real.

## Goal

For each `calendar_enabled` booking-window target, create/update **Google Calendar events** at the reservation-window reminder times, so a signed-in user who has connected their Google Calendar gets native reminders for when reservation windows open. Multi-user, idempotent, no double-bookings of events.

## Resolved decisions

- **O-A = Pattern B (separate consent).** Do NOT escalate the BetterAuth sign-in scope. A dedicated "Connect Google Calendar" OAuth flow requests only `calendar.events`, offline. (BetterAuth's Google provider stays profile/email-only; it has no built-in secondary-scope-link, so a standalone flow is required.)
- **O-B = sync runs in the GitHub-Actions scanner** (`apps/scanner`, Node — no Worker CPU cap), modular/swappable later.
- **O-C (token storage):** a new `calendar_connections` Neon table (per-user refresh token), NOT the BetterAuth `account` table (that's sign-in identity; calendar consent is separate).
- **O-D (event model):** port the legacy 3-events-per-window model + dedupe key + create/update/skip diff; sync-state moves from the JSON file to a `calendar_sync_state` Neon table.
- **O-E (deps):** `googleapis` + `google-auth-library` go **only in `apps/scanner`**. The Worker OAuth **callback** does the token exchange with a plain `fetch` (no googleapis) so the Worker bundle stays neon-only and dodges the 10 ms CPU cap.

## Architecture (two halves)

**1. Connect flow (one-time per user, in the Worker + web):**
```
/alerts "Connect Google Calendar" button (shown when not connected)
  → api.calendar.connectUrl  (protected): builds the Google consent URL
      (scope=calendar.events, access_type=offline, prompt=consent,
       redirect_uri=<worker>/api/calendar/callback, state=<csrf nonce>)
  → browser → Google consent → redirect to <worker>/api/calendar/callback?code&state
  → Worker GET /api/calendar/callback: reads BetterAuth session (same-origin cookie → userId),
      verifies state (CSRF), exchanges `code` for tokens via fetch('https://oauth2.googleapis.com/token'),
      upserts calendar_connections(userId, refresh_token, …), redirects → /alerts?calendar=connected
  → api.calendar.status (protected): { connected: boolean } drives the /alerts UI
  → api.calendar.disconnect (protected): deletes the connection (+ optionally orphans events)
```

**2. Sync (every 6h, in the scanner, after the alert scan):**
```
runCalendarSync(db):
  rows = targets WHERE calendar_enabled = true  ⋈  calendar_connections (by user_id)
  group by user → for each connected user:
     refresh the access token if near expiry (google-auth-library)
     for each of their calendar_enabled targets:
        windows = computeBookingWindows(datePattern, bookingRule, today)   // 2b-2 core
        drafts  = generateEventDrafts(target, windows)                     // ported legacy: 3 per window
        existing = calendar_sync_state for (user, those dedupe keys)
        classify create / update(changed) / skip; drop past events
        googleapis events.insert / events.update on calendarId='primary'
        upsert calendar_sync_state(user, key → googleEventId, summary, startIso, lastSyncedAt)
  record scan_runs(kind='calendar', usersProcessed, eventsCreated, eventsUpdated, errors)
```
Worker stays read-only except the new callback + the `calendar` tRPC router. The scanner owns the heavy googleapis work + per-user token refresh.

## Data model (two new Neon tables)

### `calendar_connections`
`id` text PK · `user_id` text NOT NULL (FK → `user.id` ON DELETE CASCADE) · `provider_id` text ('google') · `access_token` text · `refresh_token` text NOT NULL · `access_token_expires_at` timestamptz · `scope` text · `connected_at` timestamptz · `updated_at` timestamptz. **Unique** `(user_id, provider_id)`. (The refresh_token is the durable secret; the access_token is short-lived/refreshable.)

### `calendar_sync_state`
`id` text PK · `user_id` text NOT NULL (FK → `user.id` ON DELETE CASCADE) · `key` text (dedupe `targetId|arrivalDate|reminderType`) · `google_event_id` text · `summary` text · `start_time_iso` text · `last_synced_at` timestamptz. **Unique** `(user_id, key)`. Replaces the legacy `.campbrain/state/calendar-events.json`.

> When a target is deleted (2b-2 cascade) its sync-state rows should also be cleaned — add a `target_id` column to `calendar_sync_state` with a FK cascade to `targets`, OR prune in the sync (rows whose target no longer exists). **Recommend the `target_id` FK cascade** — cleaner.

## Code organization

```
packages/db/src/schema.ts                 MODIFY  calendar_connections + calendar_sync_state
packages/db/src/queries/calendar.ts       CREATE  upsertConnection/getConnection/deleteConnection;
                                                   listCalendarSyncTargets (targets ⋈ connections);
                                                   getSyncState/upsertSyncState (user-scoped)
packages/types/src/calendar.ts            CREATE  CalendarConnectionStatus, CalendarEventDraft, etc.
packages/core/src/calendar/event-model.ts CREATE  PURE port of legacy calendar-event.ts:
                                                   generateEventDrafts(target, windows) → drafts (3/window),
                                                   reminderKey(), hasEventChanged() — Workers-pure, unit-tested
apps/api/src/trpc/routers/calendar.ts      CREATE  protected: connectUrl, status, disconnect
apps/api/src/calendar-oauth.ts             CREATE  state sign/verify + token exchange (plain fetch, no googleapis)
apps/api/src/index.ts                      MODIFY  GET /api/calendar/callback (before SPA fallback)
apps/api/src/trpc/router.ts                MODIFY  compose calendar router
apps/scanner/package.json                  MODIFY  add googleapis + google-auth-library
apps/scanner/src/google-calendar.ts        CREATE  events.insert/update wrapper + per-user OAuth2 client/refresh
apps/scanner/src/run-calendar-sync.ts      CREATE  the sync orchestration (above)
apps/scanner/src/main.ts                   MODIFY  call runCalendarSync after runAlertScan (its own scan_runs row)
apps/web/src/features/alerts/…             MODIFY  Connect/Disconnect button + connected state; enable the
                                                   per-target calendar toggle (no longer inert) once connected
```

## What ports vs. what's net-new
- **Port (legacy `src/calendar/`):** `generateEventDrafts` (summary/description templates, 3 events/window: prep / night-before / booking), `reminderKey` dedupe, `hasEventChanged` diff, the Google event shape (`start/end` dateTime+timeZone, popup reminder override) → into core `event-model.ts` (pure) + scanner `google-calendar.ts` (the API calls).
- **Net-new:** the `calendar_connections` + `calendar_sync_state` DB tables; the pattern-B consent flow (tRPC `connectUrl` + Worker callback + plain-fetch token exchange); per-user token refresh in the scanner; the `calendar` tRPC router; the `/alerts` Connect/Disconnect UI + un-inerting the per-target toggle.

## Security notes (review these)
- **Token exchange in the Worker callback uses `fetch` to `https://oauth2.googleapis.com/token`** with `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (already Worker secrets) — no googleapis in the Worker bundle.
- **CSRF on the callback:** `connectUrl` issues a random `state`; the callback verifies it (signed value or short-lived cookie) AND requires a valid BetterAuth session (same-origin cookie) to bind the tokens to `ctx.userId`. Reject mismatches.
- **Refresh-token storage:** stored in `calendar_connections.refresh_token` (Neon). It is a sensitive secret — never logged, never returned to the client (`status` returns only `{ connected }`). Consider encryption-at-rest as a P3 hardening (Neon encrypts at rest; app-level encryption is a future option).
- **Allowlist:** calendar connect should require an allowlisted, signed-in user (the `protectedProcedure` + the existing session-allowlist gate already cover this).

## Testing
- **core (unit):** `generateEventDrafts` (3 drafts/window, correct summary/description/times/dedupe key), `hasEventChanged`.
- **db (local PG):** `calendar_connections` + `calendar_sync_state` CRUD + user isolation; `listCalendarSyncTargets` joins only connected users' calendar_enabled targets.
- **api (createCaller):** `calendar.connectUrl` builds a correct URL (scope/redirect/state); `status`/`disconnect` user-scoped + UNAUTHORIZED. The OAuth **callback** + **live sync** are NOT unit-coverable end-to-end (need real Google) — covered by a scanner unit test with a **mocked** googleapis client (classify create/update/skip; token-refresh path), plus a manual end-to-end check once the OAuth client exists.
- **web (controller `preview_*`):** the Connect button + connected state render; the per-target toggle un-inerts when connected. (Live Google consent is a manual check with your OAuth client.)

## Manual setup YOU must provide (gates live verification + deploy)
1. **A Google Cloud OAuth 2.0 client** (Web application) on the existing project, with `https://www.googleapis.com/auth/calendar.events` added to the consent screen, and **Authorized redirect URI** `https://campbrain-api.jelvehn.workers.dev/api/calendar/callback` (+ `http://localhost:8787/api/calendar/callback` for local). The existing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` can be reused IF that client allows adding the calendar scope + the new redirect URI; otherwise a second client (`GOOGLE_CALENDAR_CLIENT_ID/SECRET`).
2. **Secrets:** the client id/secret available to the scanner (GitHub Actions secrets) + the Worker (already has Google secrets; add the redirect URI / calendar client if separate). `DATABASE_URL` already set.
3. The Neon migration (the two new tables) run against Neon.
Until (1)+(2) exist, I can build + unit-test everything (tables, event-model port, sync logic with mocked googleapis, the tRPC router, the UI) but cannot verify the live OAuth consent or real calendar writes.

## Deferred / out of scope
Multi-calendar selection (always `primary`); event deletion when a target is disabled (2b-3 leaves stale future events or removes them — decide in the plan; simplest v1: on disable/disconnect, leave existing events, stop creating new — note it); non-Google calendars.

## Self-review
- Decisions O-A..O-E all resolved; the one open sub-decision (disable→delete-events behavior) is flagged for the plan.
- Worker-bundle safety preserved (no googleapis in the Worker; plain-fetch token exchange).
- Reuses 2b-2 (`computeBookingWindows`, `targets`, `calendar_enabled`) + the 2b-1 scanner phase pattern + scan_runs.
- Data-isolation keystone re-applied (calendar tables user-scoped; tRPC protected).
