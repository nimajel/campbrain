# CampBrain Hosted Launch — Phase 2b-2 (Booking-Window Targets + `/alerts` surface) Design

**Status:** drafted autonomously 2026-06-23 (user away) — **REVIEW THE "Autonomous decisions" + "Phase 2b-3 open decisions" sections before greenlighting implementation.**
**Branch:** `hosted-launch` (NOT `main`; do not merge — full parity precedes the main merge).

## TL;DR of the scoping decision (read first)

Phase "2b-2" was originally framed as **booking-window Targets + Google Calendar sync**. After mapping the territory I'm **splitting it**:

- **Phase 2b-2 (this spec — design + plan now):** the **booking-window Targets management surface** — a `targets` table (multi-user), the Reservation-Window engine (6-months-before + 8 AM-release reminder cascade) ported + tested in `@campbrain/core`, a protected `targets` tRPC router, and a gated `/alerts` React surface that manages targets + shows their **upcoming booking windows** (the `npm run upcoming` view, made into UI). The `calendar_enabled` flag ships as an **inert persisted toggle** (exactly as `alert_enabled` shipped inert in 2a before 2b-1 made it real).
- **Phase 2b-3 (deferred — design sketch + open decisions at the end of this doc, NOT planned):** **Google Calendar sync** of those reminders. Deferred because it requires **per-user Google OAuth** decisions that need the user's input: BetterAuth does **not** request the `calendar.events` scope today, so sync needs either scope-escalation-at-sign-in or a separate "Connect Calendar" consent flow + token storage, plus a decision on *where* sync runs (Worker 10 ms CPU cap vs. the GitHub-Actions scanner). The master spec also flags per-user calendar tokens as a P3 public-readiness concern.

This mirrors the 2b → 2b-1/2b-2 split: ship the self-contained piece; defer the heavy-OAuth dependency until its decisions are made.

## Goal (2b-2)

Port the legacy single-user, file-based `/alerts` booking-window surface to a **multi-user, Neon-backed** surface. A signed-in user creates "booking reminders" (a park/campground label + a date pattern), and the app computes — and displays — exactly **when each reservation window opens** (6 months before arrival at 8 AM Pacific, by CA rules) plus the reminder cascade (7 days / night-before / 10 minutes before). No reminder *delivery* yet — that's 2b-3 (calendar) / a possible email channel.

## Context / current state

**Legacy (parity source):** `src/config/schemas.ts:14-40` (Target shape), `src/rules/booking-window.ts` (`getArrivalDates` + `calculateBookingWindows`), `src/utils/dates.ts` (`getBookingWindowTime`/`getReminderTimes`), `web/app/alerts/AlertsClient.tsx` (the management UI), `data/targets.json` (file storage), `src/cli/commands/upcoming.ts` (the upcoming view), `web/app/api/alerts/*` (REST routes).

**hosted-launch (what exists):** the Reservation-Window math is **already in `@campbrain/core/src/utils/dates.ts`** (`getBookingWindowTime`, `getReminderTimes`, `getWeekendDatesInRange`, `parseTimeInTimezone`, `formatDateTime`) — **present but UNTESTED**. `dayjs` + utc/timezone plugins are core deps (the tz math works + stays Workers-pure). The `account` (BetterAuth) table stores OAuth tokens but **not** with calendar scope.

**Gap (2b-2 builds):** `targets` Neon table; Target/BookingRule/datePattern Zod schemas in `@campbrain/types`; the `getArrivalDates` + `computeBookingWindows` port (+ tests) in `@campbrain/core`; a user-scoped `targets` store in `@campbrain/db`; a protected `targets` tRPC router; the gated `/alerts` surface (a stub today). `googleapis`/calendar are 2b-3.

## Autonomous decisions (made without the user — FLAG ANY YOU'D CHANGE)

1. **Split calendar into 2b-3** (above). The biggest call. If you want calendar folded into this phase, say so and I'll spec the OAuth design with your answers to the 2b-3 open decisions.
2. **Simplify the Target shape — drop the dead alert-scan fields.** The legacy `Target` carries `acceptableSites`/`preferredSites`/`campingType`/`people`/`minNights`/`maxNights`/`emailEnabled`/`scanIntervalMinutes` — all for the **retired** Target alert-scan (that role moved to saved searches in 2a/2b-1). A booking-window reminder needs only: a label (park/campground), a date pattern, and the booking rule. So the 2b-2 Target keeps **only the booking-window-relevant fields** (YAGNI). (If you want to preserve any dropped field, flag it.)
3. **Reuse the 2a `saved_searches` storage pattern verbatim:** a `targets` row with top-level `id/user_id/provider/name/enabled/calendar_enabled/created_at/updated_at` + a `definition` JSONB holding `{ scope, datePattern, bookingRule }`. Same store/router/surface shape as saved searches → low-risk, consistent.
4. **No reminder delivery in 2b-2.** The surface shows *when* windows open (parity with `npm run upcoming`); delivery is 2b-3 (calendar) or a later email channel. I did **not** add net-new email booking-reminders (the legacy never emailed booking windows — only calendar synced them; adding email would be un-requested scope).
5. **`/alerts` route + nav stay**, but the surface is titled **"Booking Reminders"** to disambiguate from the availability **alerts** (the `/dashboard` results). Router is named `targets` (not `alerts`) for the same reason.
6. **Booking rule defaults to CA** (`monthsBefore: 6`, `releaseTime: "08:00"`, `timezone: "America/Los_Angeles"`) with optional per-target override (a "developer" detail, like legacy). hosted-launch is CA-only today.

## Architecture & data flow

```
[apps/web /alerts (RequireAuth, gated)]
  manage targets (create/edit/delete/enable) → api.targets.* (protected, ctx.userId-scoped)
  "upcoming windows" view  → api.targets.upcoming  → computeBookingWindows(core, pure) per enabled target
[apps/api targets router] → @campbrain/db targets store (user-scoped CRUD) + @campbrain/core engine
[Neon] targets table (definition JSONB)
```

Pure math in core; user-scoped persistence in db; protected router; gated surface. Same layering as 2a/2b-1. No scanner/Worker-cron involvement (booking windows are computed on read, not scanned).

## Data model

### `targets` Neon table (mirrors `saved_searches`)
| column | type | notes |
|---|---|---|
| `id` | text PK | `crypto.randomUUID()` |
| `user_id` | text NOT NULL | owner (BetterAuth user id) |
| `provider` | text NOT NULL | `'california-parks'` |
| `name` | text NOT NULL | user label, e.g. "Angel Island — August weekends" |
| `definition` | jsonb NOT NULL | `{ scope, datePattern, bookingRule }` (below) |
| `enabled` | boolean NOT NULL default true | active/paused |
| `calendar_enabled` | boolean NOT NULL default false | **inert in 2b-2** (2b-3 consumes it) |
| `created_at` / `updated_at` | timestamptz NOT NULL | |

Index on `(user_id)`. (No FK to availability; this is the Reservation-Window engine, independent of `hits`.)

### Zod schemas (`@campbrain/types/src/target.ts`)
```ts
TargetScopeSchema       = { parkPageId: string | null, parkName: string | null, campgroundName: string | null }
TargetDatePatternSchema = discriminated union on `kind`:
  | { kind: "exact",            date: ISODate }
  | { kind: "range",            from: ISODate, to: ISODate, weekendsOnly: boolean }
  | { kind: "rolling_weekends", weeks: 1..52 }
BookingRuleSchema       = { monthsBefore: int>0 (default 6), releaseTime: "HH:MM" (default "08:00"), timezone: string (default "America/Los_Angeles") }
TargetInputSchema       = { userId: string|null, provider, name, scope, datePattern, bookingRule, enabled, calendarEnabled }
TargetSchema            = TargetInputSchema + { id, createdAt, updatedAt }
BookingWindowSchema     = { arrivalDate: ISODate, bookingOpensAt: ISO, reminders: { sevenDaysBefore: ISO, nightBefore: ISO, tenMinutesBefore: ISO } }
UpcomingTargetSchema    = { targetId, name, scopeLabel: string, windows: BookingWindow[] }  // upcoming view DTO
```
The 4 legacy `dateMode`s collapse cleanly: `exact_dates → exact`; `date_range → range{weekendsOnly:false}`; `weekend_range → range{weekendsOnly:true}`; `next_available_weekend → rolling_weekends`.

## The Reservation-Window engine (port + TEST)

`@campbrain/core/src/rules/booking-window.ts` (NEW — pure, the existing `utils/dates.ts` helpers are untested and get covered here too):
- `expandArrivalDates(datePattern, today): string[]` — port of legacy `getArrivalDates` (`src/rules/booking-window.ts:20-74`) adapted to the simplified `TargetDatePattern`: `exact`→[date]; `range`→days (or weekends) in [from,to]; `rolling_weekends`→next N Fri+Sat from today.
- `computeBookingWindows(datePattern, bookingRule, today): BookingWindow[]` — port of legacy `calculateBookingWindows` (`:76-96`), but takes the datePattern + bookingRule (not a full Target), returns ISO strings (not the legacy `format('… Z')`). Uses the existing `getBookingWindowTime` + `getReminderTimes`.
- **Tests** (the debt the memory flagged): each datePattern kind; the 6-month/8 AM-PT booking-open math incl. a DST boundary (e.g. arrival 2026-07-15 → opens 2026-01-15 08:00 PT); the reminder cascade (7 d @ 09:00, night-before @ 20:00, 10 min before).

> The `upcoming` view shows only **future** windows (`bookingOpensAt > now`), sorted ascending. Past windows are filtered in the router handler (or the core fn takes `today` and the handler filters `> now`).

## tRPC `targets` router (protected, user-scoped)

`apps/api/src/trpc/routers/targets.ts` — all `protectedProcedure`, all `ctx.userId`-scoped (mirrors `savedSearches`):
- `list` → the user's targets.
- `create(TargetInput)` / `update({ id, patch })` / `delete({ id })` — ownership-enforced in the store.
- `setEnabled({ id, enabled })` — pause/resume.
- `upcoming` → for each **enabled** target, `computeBookingWindows` filtered to future windows, as `UpcomingTarget[]` (sorted by soonest window). Pure compute over the user's targets — no extra DB beyond `list`.

(No `calendar`-related procedures in 2b-2.)

## `@campbrain/db` targets store

`packages/db/src/queries/targets.ts` — **copy the `saved-searches.ts` store almost verbatim**, swapping the table + the `definition` shape: `listTargets(db, userId)`, `getTarget(db, id, userId)`, `createTarget(db, userId, input)` (forces `user_id`), `updateTarget(db, id, userId, patch)` (ownership-checked), `deleteTarget(db, id, userId)`, `setTargetEnabled(db, id, userId, enabled)`. Every read/write filters `WHERE … user_id = $userId` (same data-isolation keystone as 2a).

## `/alerts` web surface (gated, "Booking Reminders")

`apps/web/src/features/alerts/` + `routes/alerts.tsx` (`<RequireAuth>`). Ports the *intent* of `web/app/alerts/AlertsClient.tsx`, scoped to the user, Tailwind/shadcn, vanilla tRPC client (`api.targets.*.query/mutate` wrapped in `useQuery`/`useMutation`), matching the `/saved` + `/dashboard` style:
- **Target list** — cards: name, scope label (park/campground), date-pattern summary, enabled dot, `calendar_enabled` toggle (with a **"Calendar sync coming soon"** tooltip — inert), Edit / Delete / Enable-toggle. (Reuse the `/saved` `SavedSearchCard` structure.)
- **Create/Edit modal** — name, a park/campground picker (or free-text label — see open question O-1), a date-pattern editor (exact / range+weekendsOnly / rolling-weekends), and a collapsible "Booking rule" override (defaults CA). (Reuse the `SaveSearchModal` structure.)
- **Upcoming windows view** — from `api.targets.upcoming`: a list grouped by target (or a flat chronological "next booking opens" list) showing each window's `bookingOpensAt` (locale, with tz) + the 3 reminders; empty state when no enabled targets. This is the `npm run upcoming` value as UI.
- Add/keep the NavBar "Alerts" link → `/alerts`.

## Code organization (file structure)

```
packages/types/src/target.ts          CREATE  Target/BookingRule/datePattern/BookingWindow/UpcomingTarget schemas
packages/types/src/index.ts           MODIFY  barrel
packages/core/src/rules/booking-window.ts  CREATE  expandArrivalDates + computeBookingWindows (port)
packages/core/src/index.ts            MODIFY  export them
packages/core/.../*.test.ts           CREATE  engine tests (+ cover the untested utils/dates helpers)
packages/db/src/queries/targets.ts    CREATE  user-scoped store (≈ saved-searches.ts)
packages/db/src/schema.ts             MODIFY  targets table
packages/db/migrations/000X_*.sql     GENERATED
packages/db/test/targets.test.ts      CREATE  CRUD + cross-user isolation (local PG)
apps/api/src/trpc/routers/targets.ts  CREATE  protected list/create/update/delete/setEnabled/upcoming
apps/api/src/trpc/router.ts           MODIFY  compose `targets`
apps/api/test/targets-router.test.ts  CREATE  user-scoped + UNAUTHORIZED + upcoming compute (local PG)
apps/web/src/features/alerts/*        CREATE  TargetsPage, TargetCard, TargetModal, UpcomingWindows, hooks
apps/web/src/routes/alerts.tsx        MODIFY  RequireAuth + TargetsPage
```

## Testing
- **core:** `expandArrivalDates` (all 3 kinds) + `computeBookingWindows` (6mo/8AM-PT math, DST, reminder cascade) — the previously-untested engine, now covered.
- **db (local PG):** targets CRUD + cross-user isolation (userB can't read/update/delete userA's target) — the data-isolation keystone.
- **api (createCaller):** `targets.*` user-scoped + UNAUTHORIZED; `upcoming` returns future windows for the caller's enabled targets only.
- **web (controller-run `preview_*`):** `/alerts` signed-in (create a target → it lists; upcoming view shows the computed booking-open time + reminders; calendar toggle persists but is labeled inert) and signed-out (RequireAuth prompt) — reuse the dev-stub harness.

## Explicitly deferred (out of 2b-2)
Google Calendar sync (Phase 2b-3 below), any email delivery of booking reminders, multi-provider booking rules (CA-only today).

---

## Phase 2b-3 (Google Calendar sync) — design SKETCH + OPEN DECISIONS (not planned; needs your input)

**What it does:** for each `calendar_enabled` target, create/update Google Calendar events at the reminder times (legacy: 3 events per booking window — `src/calendar/*` + `sync-calendar.ts`), idempotently (dedupe key `targetId|arrivalDate|reminderType`), so the user gets native calendar reminders for when reservation windows open.

**Open decisions that need YOU (these gate the 2b-3 plan):**
- **O-A — OAuth scope approach:**
  - **(A) Scope-escalation at sign-in:** add `https://www.googleapis.com/auth/calendar.events` (+ `access_type: offline`, `prompt: consent`) to the BetterAuth Google provider. One consent; reuse the stored `account.refreshToken`. **Cost:** *every* user is asked for calendar permission at login, even non-users of calendar. Privacy-heavier; simplest token handling.
  - **(B) Separate "Connect Google Calendar" consent (recommended):** keep sign-in scopes as-is; a button on `/alerts` runs a second OAuth flow requesting only `calendar.events` offline; store that refresh token in a new `calendar_connections` table (or a column). Opt-in, privacy-clean; two token stores + a second flow to build.
- **O-B — Where sync runs:** (i) a tRPC mutation ("Sync now" / on calendar-toggle) executed in the **Worker** — but the free-plan **10 ms CPU cap** + `googleapis`'s size make this risky; (ii) the **GitHub-Actions scanner** job (Node, no CPU cap) syncs all `calendar_enabled` targets every run (like the alert scan) — robust but up-to-6h latency; (iii) a hybrid. Recommendation leans (ii) for the heavy sync + a light "disconnect" in the Worker.
- **O-C — Token storage + refresh** (follows from O-A/B): a `calendar_connections` table (`user_id`, `refresh_token`, `scope`, `connected_at`) vs. reusing `account`. Refresh handled by `googleapis` (`google-auth-library`).
- **O-D — Event model:** keep the legacy 3-events-per-window + dedupe key + a per-user sync-state (now DB, not `.campbrain/state`). Confirm the event copy/reminders.
- **O-E — `googleapis` placement:** the scanner (`apps/scanner`) if sync runs there (O-B-ii), like `resend` in 2b-1.

When you answer O-A/O-B (the two that matter most), I'll write the 2b-3 spec + plan.

---

## Self-review
- Placeholders: none. The 2b-2 design is concrete; the 2b-3 section is intentionally a sketch + enumerated decisions (it is NOT a plan).
- Consistency: targets store/router/surface mirror the proven 2a saved-searches shapes; the engine is a faithful port of legacy `booking-window.ts`; `calendar_enabled` inert mirrors `alert_enabled`'s 2a→2b-1 path.
- Scope: 2b-2 is a single coherent, OAuth-free slice (≈ the size of 2a). Calendar correctly split out.
- Data-isolation keystone (user-scoped store + `ctx.userId`) re-applied — Phase 2b-2 adds no new public surface.
