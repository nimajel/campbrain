# CampBrain Hosted Launch — Phase 2b-3 (Google Calendar Sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. **Self-contained; read the cited legacy `src/calendar/*` files for the event-model port.**
> **Verification boundary:** everything here is buildable + unit/integration-testable WITHOUT a live Google OAuth client (the googleapis calls are dependency-injected + mocked in tests; the OAuth token exchange is tested with a mocked `fetch`). The LIVE OAuth consent + real calendar writes are a manual end-to-end check the user runs once they provision the Google client (see the spec's "Manual setup" section). Do NOT block tasks on live Google.

**Goal:** Make the inert `targets.calendar_enabled` real — a pattern-B "Connect Google Calendar" consent flow (Worker callback, plain-fetch token exchange) storing per-user refresh tokens in Neon, plus a scanner phase that syncs each connected user's booking-window reminders to Google Calendar (3 events/window, idempotent via a DB sync-state).

**Architecture:** OAuth token exchange + the `calendar` tRPC router live in the Worker (NO `googleapis` — plain `fetch`, bundle stays neon-only). The heavy sync (`googleapis` events.insert/update + per-user token refresh) runs in the GitHub-Actions scanner (Node). The pure event model is ported into `@campbrain/core`. Two new user-scoped Neon tables.

**Tech Stack:** Bun · Turborepo · TS strict · Drizzle/Neon · tRPC v11 · Hono (Worker) · React 19 + TanStack · `googleapis` + `google-auth-library` (scanner only) · Vitest.

**Spec:** docs/superpowers/specs/2026-06-23-hosted-launch-phase2b3-calendar-sync-design.md

**Env note:** `migrate` needs `DATABASE_URL` inline: `postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain`.

---

## Task 0: Environment up + migrated + seeded
```bash
cd /Users/nimajelveh/campbrain && docker compose -f docker-compose.dev.yml up -d && \
  DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun --filter @campbrain/db migrate && \
  DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun --filter @campbrain/db seed:catalog
```
Expected: PG `Up`; `✅ migrations + MV applied`; seed reports parks. No commit.

---

## Task 1: `calendar_connections` + `calendar_sync_state` tables + migration
**Files:** Modify `packages/db/src/schema.ts`; Generated `migrations/0006_*.sql`; Test `packages/db/test/calendar.test.ts` (smoke).

- [ ] **Step 1: Add the table defs** to `packages/db/src/schema.ts` (mirror existing styles; `user` is imported from `./auth-schema` — check how `hits` references tables, and that `uniqueIndex`/`index` are imported):
```ts
export const calendarConnections = pgTable("calendar_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  providerId: text("provider_id").notNull(), // 'google'
  accessToken: text("access_token"),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [ uniqueIndex("uq_calendar_conn_user_provider").on(t.userId, t.providerId) ]);

export const calendarSyncState = pgTable("calendar_sync_state", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  targetId: text("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }),
  key: text("key").notNull(), // dedupe: targetId|arrivalDate|reminderType
  googleEventId: text("google_event_id").notNull(),
  summary: text("summary").notNull(),
  startTimeIso: text("start_time_iso").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [ uniqueIndex("uq_calendar_sync_user_key").on(t.userId, t.key) ]);
```
(`calendar_sync_state.target_id` FK-cascades to `targets` so deleting a target cleans its events' state. `user_id` columns are NOT FKs to `user` — keep consistent with `targets`/`hits` which denormalize `user_id` as plain text.)

- [ ] **Step 2: Generate + apply** (`generate` then `DATABASE_URL=… migrate`). Expected: `0006_*.sql` creates ONLY the two new tables (+ the FK to `targets` + the two unique indexes); no ALTERs to existing tables. Confirm with `\d calendar_connections` `\d calendar_sync_state`.

- [ ] **Step 3: Smoke test** `packages/db/test/calendar.test.ts` (mirror `packages/db/test/targets.test.ts` harness): insert a `calendar_connections` row + read it back; structure for Task 4's full suite. PASS not skipped.

- [ ] **Step 4: Typecheck + commit** `feat(db): calendar_connections + calendar_sync_state tables`.

---

## Task 2: `@campbrain/types` calendar schemas + `ScanRunKind` += 'calendar'
**Files:** Create `packages/types/src/calendar.ts`; Modify `packages/types/src/index.ts` + `packages/types/src/alerts.ts` (the `ScanRunKind` enum); Test `packages/types/test/calendar.test.ts`.

- [ ] **Step 1: Failing test** — assert: `ReminderType` enum = `prep|night-before|booking`; `CalendarConnectionStatusSchema` = `{ connected: boolean, connectedAt?: string }`; `CalendarEventDraftSchema` shape; and `ScanRunKind` now accepts `"calendar"`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `packages/types/src/calendar.ts`:
```ts
import { z } from "zod";
export const ReminderTypeSchema = z.enum(["prep", "night-before", "booking"]);
export type ReminderType = z.infer<typeof ReminderTypeSchema>;
export const CalendarConnectionStatusSchema = z.object({ connected: z.boolean(), connectedAt: z.string().optional() });
export type CalendarConnectionStatus = z.infer<typeof CalendarConnectionStatusSchema>;
export const CalendarEventDraftSchema = z.object({
  key: z.string(), targetId: z.string(), reminderType: ReminderTypeSchema,
  summary: z.string(), description: z.string(),
  startTimeIso: z.string(), endTimeIso: z.string(), timeZone: z.string(),
});
export type CalendarEventDraft = z.infer<typeof CalendarEventDraftSchema>;
```
In `packages/types/src/alerts.ts`, change `ScanRunKind = z.enum(["proactive", "alert"])` → add `"calendar"`. Barrel: `export * from "./calendar";`
- [ ] **Step 4: Run + typecheck + commit** `feat(types): calendar event + connection-status schemas`.

---

## Task 3: Core event model (pure port of the legacy event generation)
**Files:** Create `packages/core/src/calendar/event-model.ts`; Modify `packages/core/src/index.ts`; co-located test `packages/core/src/calendar/event-model.test.ts`.

Port the event generation from **`src/calendar/calendar-event.ts`** (read it): `reminderKey(targetId, arrivalDate, reminderType)` → `${targetId}|${arrivalDate}|${reminderType}`; the summary/description templates; `hasEventChanged(draft, existing)` (summary or startTimeIso differ); and a `generateEventDrafts(input)` that produces **3 drafts per booking window** (prep / night-before / booking). **Adaptation:** the input is the 2b-2 shape, not the legacy Target — take `{ targetId, name, scopeLabel, datePattern-derived BookingWindow }`. Signature:
```ts
import type { BookingWindow, ReminderType, CalendarEventDraft } from "@campbrain/types";
interface DraftInput { targetId: string; targetName: string; parkName: string | null; campgroundName: string | null; timezone: string; window: BookingWindow; }
export function generateEventDrafts(input: DraftInput): CalendarEventDraft[];  // 3: at window.reminders.sevenDaysBefore (prep), .nightBefore (night-before), .tenMinutesBefore (booking)
export function reminderKey(targetId: string, arrivalDate: string, t: ReminderType): string;
export function hasEventChanged(draft: CalendarEventDraft, existing: { summary: string; startTimeIso: string }): boolean;
```
Each draft: `startTimeIso` = the reminder time (already ISO in `BookingWindow.reminders`), `endTimeIso` = start + 30 min, `summary`/`description` ported from legacy (the "CampBrain: Book {park} — {campground}" title + the checklist body; the `booking` reminder gets the "🔔 … BOOK NOW" emphasis). Pure (dayjs only). **Tests:** 3 drafts with correct keys/types/times; `hasEventChanged` true on summary/time diff, false otherwise. Export from the core barrel. Commit `feat(core): calendar event-model (pure draft generation + dedupe)`.

---

## Task 4: `@campbrain/db` calendar queries (user-scoped) + isolation tests
**Files:** Create `packages/db/src/queries/calendar.ts`; Modify `packages/db/src/index.ts`; extend `packages/db/test/calendar.test.ts`.

Functions (all user-scoped where user-facing):
- `upsertConnection(db, userId, { providerId, accessToken, refreshToken, accessTokenExpiresAt, scope })` — `ON CONFLICT (user_id, provider_id) DO UPDATE`.
- `getConnection(db, userId, providerId='google')` → row | undefined.
- `deleteConnection(db, userId, providerId='google')`.
- `getConnectionStatus(db, userId)` → `{ connected, connectedAt? }` (for the tRPC `status`).
- `listCalendarSyncTargets(db)` — UN-scoped (scanner): `SELECT t.*, c.refresh_token, c.access_token, c.access_token_expires_at, c.user_id FROM targets t JOIN calendar_connections c ON c.user_id = t.user_id AND c.provider_id='google' WHERE t.calendar_enabled = true AND t.enabled = true`. Returns the joined rows (reconstruct the `Target` definition + the connection tokens) grouped/iterable by user.
- `getSyncState(db, userId, keys: string[])` → `Map<key, { googleEventId, summary, startTimeIso }>`.
- `upsertSyncState(db, userId, targetId, record)` — `ON CONFLICT (user_id, key) DO UPDATE`.

**TDD:** isolation test — userB can't read/delete userA's connection; `getConnectionStatus` reflects presence; `upsertConnection` is idempotent; `listCalendarSyncTargets` returns only connected+enabled targets. Barrel-export. Commit `feat(db): calendar connection + sync-state queries`.

---

## Task 5: Worker OAuth (callback + token exchange) + `calendar` tRPC router
**Files:** Create `apps/api/src/calendar-oauth.ts`; Create `apps/api/src/trpc/routers/calendar.ts`; Modify `apps/api/src/index.ts` (callback route) + `apps/api/src/trpc/router.ts`; Test `apps/api/test/calendar-router.test.ts` + `apps/api/test/calendar-oauth.test.ts`.

**`calendar-oauth.ts`** (NO googleapis — plain fetch):
- `buildConsentUrl({ clientId, redirectUri, state })` → the Google authorize URL (`https://accounts.google.com/o/oauth2/v2/auth?...scope=https://www.googleapis.com/auth/calendar.events&access_type=offline&prompt=consent&...`).
- `exchangeCode({ clientId, clientSecret, code, redirectUri }, fetchImpl = fetch)` → POST to `https://oauth2.googleapis.com/token`, returns `{ accessToken, refreshToken, expiresIn, scope }`. **Inject `fetchImpl` so tests mock it.**
- `signState(userId, secret)` / `verifyState(state, secret)` → an HMAC-signed (or random-nonce-in-a-cookie) CSRF state binding the consent to the userId. Use Web Crypto (`crypto.subtle`, Workers-safe).

**`routers/calendar.ts`** (protected):
- `connectUrl` query → `buildConsentUrl` with `state = signState(ctx.userId, env secret)`, redirectUri from env (`<WEB_ORIGIN>/api/calendar/callback`); returns `{ url }`.
- `status` query → `getConnectionStatus(ctx.db, ctx.userId)`.
- `disconnect` mutation → `deleteConnection(ctx.db, ctx.userId)`.

**`apps/api/src/index.ts`** — add `app.get("/api/calendar/callback", …)` BEFORE the SPA fallback: read the BetterAuth session (same-origin cookie → userId), `verifyState`, `exchangeCode`, `upsertConnection(db, userId, …)`, then `redirect("/alerts?calendar=connected")`. On error → `redirect("/alerts?calendar=error")`. (Uses the `withDbAuth` middleware pattern already in index.ts for db+auth.)

**Tests:** `calendar-oauth.test.ts` — `buildConsentUrl` contains the scope/redirect/state; `exchangeCode` with a **mocked fetch** returns parsed tokens; `signState`/`verifyState` round-trip + reject tampering. `calendar-router.test.ts` (createCaller) — `connectUrl` returns a URL with the user's signed state; `status` reflects a seeded connection; `disconnect` user-scoped; UNAUTHORIZED without session. Compose `calendar: calendarRouter`. Commit `feat(api): calendar OAuth connect flow + router`.

> Needs an env secret for state signing (e.g. reuse `BETTER_AUTH_SECRET`) + the redirect origin. Read them from the Worker env (`c.env`), not `process.env`.

---

## Task 6: Scanner calendar sync (googleapis, dependency-injected + mock-tested)
**Files:** Modify `apps/scanner/package.json` (add `googleapis` + `google-auth-library`); Create `apps/scanner/src/google-calendar.ts` + `apps/scanner/src/run-calendar-sync.ts`; Modify `apps/scanner/src/main.ts`; Test `apps/scanner/test/run-calendar-sync.test.ts`.

**`google-calendar.ts`** — a thin wrapper, **dependency-injectable for tests**:
```ts
export interface CalendarClient {
  insertEvent(draft: CalendarEventDraft): Promise<string>;  // returns googleEventId
  updateEvent(eventId: string, draft: CalendarEventDraft): Promise<void>;
}
// Real impl: makeGoogleCalendarClient({ clientId, clientSecret, refreshToken, accessToken, expiresAt })
//   uses google-auth-library OAuth2 (setCredentials + refresh) + googleapis calendar.events.insert/update on 'primary',
//   converting a CalendarEventDraft → { summary, description, start:{dateTime,timeZone}, end:{…}, reminders:{useDefault:false, overrides:[{method:'popup',minutes:10}]} } (port from src/calendar/google-calendar.ts).
```
**`run-calendar-sync.ts`** — `runCalendarSync({ db, makeClient = makeGoogleCalendarClient, log })`:
1. `rows = listCalendarSyncTargets(db)`, group by user.
2. per user: build a `CalendarClient` (refresh token via the lib); per target: `computeBookingWindows` → `generateEventDrafts` per window → drop past (`startTimeIso < now`) → load `getSyncState(db, userId, keys)` → classify create / update(`hasEventChanged`) / skip → `insertEvent`/`updateEvent` → `upsertSyncState`. Count created/updated/errors; one failing user/target logged + counted, never aborts the run.
3. `startScanRun(db,'calendar')` / `finishScanRun(db, …, { …counts })`.
**`main.ts`** — call `await runCalendarSync({ db })` after `runAlertScan`, wrapped in its own scan_run (best-effort; failures don't fail the job).

**Test** `run-calendar-sync.test.ts` (local PG + a **mock `CalendarClient`** injected via `makeClient`): seed a connected user (`calendar_connections`) + a `calendar_enabled` target with a far-future `exact` date; run `runCalendarSync({ db, makeClient: () => mockClient })`; assert the mock's `insertEvent` was called 3× (3 drafts), `calendar_sync_state` rows were written, and a re-run with unchanged drafts calls `insertEvent` 0× + `updateEvent` 0× (idempotent skip). The REAL googleapis path is NOT exercised in tests (no live Google). Commit `feat(scanner): calendar sync phase (googleapis, mock-tested)`.

> `googleapis` is large; confirm it installs cleanly (`bun install`) and is imported ONLY in `apps/scanner` (NOT pulled into the Worker bundle — verify in Task 8's wrangler dry-run).

---

## Task 7: Web — Connect/Disconnect + un-inert the per-target calendar toggle
**Files:** Modify `apps/web/src/features/alerts/*` (the 2b-2 surface) — add a calendar-connection panel + make the per-target toggle live when connected; a `use-calendar` hook.

- `hooks/use-calendar.ts` — `useCalendar()` → `{ status: CalendarConnectionStatus | undefined; connect(): void; disconnect(): void }`. `connect()` → `api.calendar.connectUrl.query()` then `window.location.href = url` (top-level redirect to Google). `disconnect()` → `api.calendar.disconnect.mutate()` + invalidate. `status` via `useQuery(["calendar","status"])`.
- `TargetsPage`: a "Google Calendar" panel — when `!status.connected`, a **"Connect Google Calendar"** button (→ `connect()`); when connected, "Connected ✓ · Disconnect". Read `?calendar=connected|error` from the URL to show a brief confirmation/toast.
- `TargetCard`: the per-target calendar toggle — **when `status.connected`, make it LIVE** (`setEnabled`-style mutation on `targets.update` patching `calendarEnabled`, invalidate `["targets"]`); when NOT connected, keep it disabled with a "Connect Google Calendar first" tooltip. (The toggle flips `target.calendarEnabled`; the scanner consumes it.)
- Typecheck + build green. Commit `feat(web): connect google calendar + live per-target toggle`.
- [x] **Visual verification (controller `preview_*`):** reuse the dev-stub harness. **Not-connected:** `/alerts` shows "Connect Google Calendar"; the per-target toggle is disabled with the tooltip. **Connected (seed a `calendar_connections` row for `local-dev`):** the panel shows "Connected ✓ · Disconnect"; the per-target toggle is now live and persists `calendar_enabled` (verify the DB row flips). (The actual Google consent redirect is the user's manual check with their OAuth client — out of scope for the local visual pass.) *(Verified 2026-07-02: both states pass; toggle click persisted `calendar_enabled=true`; no console errors. Note: the harness is a throwaway Node server (`createNodeDb` + ALLOW_DEV_SESSION in process.env) — `wrangler dev` does NOT populate `process.env` from `.dev.vars`, so the stub is inert under it.)*

---

## Task 8: Full-repo verification + cleanup
- [x] `bun run typecheck` (8/8), `bun run test` (all pass; the calendar core/db/api/scanner tests RUN not skipped — eyeball the isolation + mock-sync + connectUrl tests), `bun run build`. *(Verified 2026-07-02, forced uncached run: 430 tests, 0 skipped. Note: a Homebrew postgresql@18 on the host shadows Docker's :5432 — stop it or the db/api PG-backed suites silently skip.)*
- [x] `grep -nE "calendar:" apps/api/src/trpc/router.ts` (router exposed); `grep -n "runCalendarSync" apps/scanner/src/main.ts` (wired).
- [x] **Worker dry-run** (`apps/api`, `bunx wrangler deploy --dry-run`) — MUST build clean AND **confirm `googleapis` is NOT in the Worker bundle** (the OAuth uses plain fetch; googleapis is scanner-only). If the bundle pulls googleapis, the callback/oauth accidentally imported it — fix. *(Verified 2026-07-02: clean build; the only "googleapis" hits in the bundle are URL string literals — no googleapis/google-auth-library package code.)*
- [x] Remove any throwaway dev harness; confirm the tree is clean. *(Tree clean; only untracked file is the user's `.claudeignore`.)*

---

## Manual setup the USER provides (gates LIVE verification + deploy — NOT a code task)
1. A Google OAuth 2.0 **Web** client with `calendar.events` on the consent screen + redirect URIs `https://campbrain-api.jelvehn.workers.dev/api/calendar/callback` and `http://localhost:8787/api/calendar/callback`.
2. Client id/secret as GitHub Actions secrets (scanner) + confirm the Worker has them (for `exchangeCode`); a state-signing secret (reuse `BETTER_AUTH_SECRET`).
3. Run the `0006` migration against Neon.
Then: connect a calendar in the live app, run the scanner, confirm events appear.

## Self-Review
**Coverage:** tables (T1) · types + ScanRunKind (T2) · core event model (T3) · db calendar queries + isolation (T4) · Worker OAuth + router (T5) · scanner sync, googleapis mock-tested (T6) · web connect + live toggle (T7) · gates + Worker-bundle-clean (T8). Live OAuth/calendar-writes explicitly deferred to the user's manual check.
**Type consistency:** `CalendarEventDraft`/`ReminderType` (T2) ← `generateEventDrafts` (T3) → the scanner's `CalendarClient` (T6); `CalendarConnectionStatus` (T2) ← `getConnectionStatus` (T4) → `status` (T5) → `use-calendar` (T7); the `calendar_sync_state` dedupe `key` is `reminderKey()` (T3) used by both the sync (T6) and the state queries (T4).
**Worker-bundle safety:** googleapis is scanner-only; the Worker OAuth uses plain `fetch` + Web Crypto — re-verified in T8's dry-run.
**Data isolation:** calendar tables user-scoped; `calendar` router protected; `listCalendarSyncTargets` is the only un-scoped query (scanner-only, like `listAlertEnabledSavedSearches`).
