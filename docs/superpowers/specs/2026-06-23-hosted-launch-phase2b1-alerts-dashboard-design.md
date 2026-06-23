# CampBrain Hosted Launch — Phase 2b-1 (Alert Scanning + Email + Dashboard) Design

**Status:** approved (brainstormed 2026-06-23)
**Branch:** `hosted-launch` (NOT `main`; do not merge — Phase 2b-2 + full parity precede the main merge)
**Supersedes for this slice:** the "Phase 2" bullet in `project-hosted-launch-rewrite` memory (decomposed into 2b-1 here + 2b-2 next).

## Goal

Make the **inert** 2a `saved_searches.alert_enabled` flag real. Build a multi-user availability-alert
pipeline that runs immediately after the 6-hour proactive scan, matches alert-enabled saved searches
against the freshly-written Neon availability, records "hits", emails each saved-search **owner** their
newly-available matches via Resend, and surfaces results on a gated **`/dashboard`** surface.

This is the **Availability Scanner Engine** made real for multi-user. It does NOT touch the Reservation
Window Engine (booking-window Targets + Google Calendar) — that is Phase 2b-2.

## Context / current state

**Shipped in 2a (on `hosted-launch`):** `protectedProcedure` + `ctx.userId`; user-scoped saved-search
store; `search` + `savedSearches` tRPC routers; `/explore` + `/saved`; the `saved_searches` table with
`alert_enabled` / `email_enabled` columns (the toggle persists but **nothing consumes it**).

**Proactive scanner:** `apps/scanner` (`runProactiveScan`) runs every 6h via `.github/workflows/scan.yml`
(`bun --filter @campbrain/scanner start`), writing availability to Neon over TCP (`createNodeDb`).

**Gap (what this phase builds):** no alert-matching, no hit/scan-run persistence, no email, no dashboard
on `hosted-launch`. On `main` these are single-user and **file-based** (`.campbrain/state/*.json`), which
cannot work on the ephemeral GitHub Actions runner — so state must move into Neon.

**Legacy reference (single-user, faithful-port source of truth):**
- `src/saved-search/match.ts` — `expandStayWindows(search, today)`, `matchSavedSearch(search, deps, today)`,
  `SavedSearchOpening`.
- `src/scanner/run-scan.ts` — the orchestration (load alert searches → match → reconcile → notify → persist).
- `src/state/scan-state.ts` — `HitsState` v3, `reconcileHits`, `AvailabilityHitRecord` (first/last/disappeared/notified).
- `src/notifications/email-notification-service.ts` — `buildEmailSubject`/`buildEmailBody`/`EmailNotificationService`.
- `web/app/page.tsx` + `web/app/components/RecentOpenings.tsx` — the legacy dashboard (stat trio + recent openings).

## Resolved decisions (from brainstorming)

1. **Email model:** recipient = the saved-search **owner's account email** (BetterAuth `user` table);
   **one batched email per user per scan run**, listing that user's **newly-available** matches; gated by
   the per-search `email_enabled` flag; a hit already emailed is never re-emailed (even if it disappears and
   reappears).
2. **Where/when:** the alert scan is **chained after `runProactiveScan` in the same GitHub Actions job**
   (every 6h) so it reads the availability the proactive phase just wrote. (No value in scanning alerts more
   often than the data refreshes.)
3. **Persistence:** hits + scan history live in **two new Neon tables** (`hits`, `scan_runs`) — ephemeral
   runners have no durable filesystem, so the legacy JSON-file state is replaced by Postgres.
4. **Dashboard:** a NEW **gated `/dashboard`** route = a focused **alert-results view** (stat cards + recent
   openings + last-scan freshness). Saved-search CRUD stays on `/saved`; the map stays the home/front-door.
5. **Email dependency:** the `resend` dep + the email service live **inside `apps/scanner`** (scanner is the
   only sender). Promote to a shared package later only if the Worker ever needs to send mail.

## Architecture & data flow

```
[GitHub Actions, every 6h — apps/scanner main.ts]

  runProactiveScan(deps)                         (existing, unchanged)
        ↓ writes availability windows to Neon
        ↓ record scan_runs(kind='proactive', counts…)
  runAlertScan(deps)                             (NEW)
    1. searches = listAlertEnabledSavedSearches(db)         (exists, un-scoped)
    2. for each search:
         openings = matchSavedSearchAgainstDb(db, search, today, parkRegionOf)
         reconcile openings → hits table  (insert new / refresh seen / mark disappeared)
    3. toNotify = hits WHERE notified_at IS NULL AND email_enabled
                       AND disappeared_at IS NULL AND arrival_date >= today
       group toNotify by user_id → one Resend email per user (to owner email) → stamp notified_at
    4. record scan_runs(kind='alert', searches_scanned, hits_new, hits_current, emails_sent, errors)

[apps/api Worker — read-only, unchanged except a new protected dashboard router]
  dashboard.stats / dashboard.recentOpenings / dashboard.lastScan   (ctx.userId-scoped, read hits + scan_runs)

[apps/web]
  /dashboard (RequireAuth) → stat cards + recent-openings table (Book links) + "last checked" freshness
```

The Worker never scans or emails; the scanner never serves HTTP. Clean separation, same as Phase 1.

## Data model (two new Neon tables + a migration)

### `hits`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | `crypto.randomUUID()` |
| `saved_search_id` | uuid NOT NULL | FK → `saved_searches(id)` **ON DELETE CASCADE** |
| `user_id` | text NOT NULL | denormalized owner (fast per-user dashboard reads) |
| `provider` | text NOT NULL | `'california-parks'` etc. |
| `park_page_id` | text NOT NULL | |
| `park_name` | text NOT NULL | |
| `campground_name` | text NOT NULL | |
| `site_name` | text NOT NULL | |
| `arrival_date` | date NOT NULL | |
| `nights` | integer NOT NULL | |
| `booking_url` | text | nullable |
| `first_seen_at` | timestamptz NOT NULL | set on insert |
| `last_seen_at` | timestamptz NOT NULL | refreshed each run it's seen |
| `disappeared_at` | timestamptz | nullable; set when not seen in a run; cleared on reappear |
| `notified_at` | timestamptz | nullable; set after the owner is emailed |

- **Unique:** `(saved_search_id, site_name, arrival_date)` — the reconcile conflict target.
- **Indexes:** `(user_id)`, partial `(saved_search_id) WHERE notified_at IS NULL`.
- Cascade-delete means deleting a saved search (via `/saved`) removes its hits.

### `scan_runs`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `kind` | text NOT NULL | `'proactive'` \| `'alert'` |
| `started_at` | timestamptz NOT NULL | |
| `finished_at` | timestamptz | nullable until done |
| `status` | text NOT NULL | `'running'` \| `'ok'` \| `'error'` |
| `searches_scanned` | integer | alert runs |
| `hits_new` | integer | alert runs |
| `hits_current` | integer | alert runs |
| `emails_sent` | integer | alert runs |
| `parks_scanned` | integer | proactive runs (optional; nice observability) |
| `errors` | integer | |

Dashboard "last checked" = latest `scan_runs` row with `kind='alert'` and `status='ok'`.

### Types (`@campbrain/types`)
`HitSchema`, `ScanRunSchema`, and dashboard DTOs (`DashboardStats`, `RecentOpening`) as Zod schemas +
inferred types. `RecentOpening` is the per-row shape the dashboard table renders (park/campground/site/
arrival/nights/bookingUrl/firstSeenAt).

## The alert-scan algorithm (faithful port, DB-native reconcile)

1. **`expandStayWindows(search, today)` → `StayWindow[]`** — port **verbatim** from `src/saved-search/match.ts:58-93`
   into `@campbrain/core/availability/saved-search-match.ts` (PURE: dayjs + core's existing `weekendArrivals`;
   unit-tested). `fixed_range` → sliding `minNights`-windows; `any_weekend` → `weekendArrivals(today, horizonDays, minNights)`.
2. **`matchSavedSearchAgainstDb(db, search, today, parkRegionOf)` → `SavedSearchOpening[]`** — port the orchestration
   from `match.ts:122-186` into **`@campbrain/db/queries/alert-match.ts`** (db depends on core, not vice-versa, so
   the DB-coupled matcher lives in db). For each expanded window: `searchAvailableStays(db, {from,to,access?,kinds?,hide?})`
   → filter by `parkPassesScope` (parkPageIds, else region via `parkRegionOf`) → emit one opening per
   `cg.availableSites` site (walk-up excluded). `availabilityAsOf` via core `oldestCoveringScan(getEntriesForPark(db,pageId), dates)`,
   memoized per park. `parkRegionOf` built once from `getCatalogParks(db)` coords + core `classifyRegion`.
3. **Reconcile → `hits` (DB-native, replaces in-memory `reconcileHits`):** in one transaction per scan run:
   - For each opening: `INSERT INTO hits (…) VALUES (…) ON CONFLICT (saved_search_id, site_name, arrival_date)
     DO UPDATE SET last_seen_at = $runStart, disappeared_at = NULL` (returning whether it was an insert vs update,
     for `hits_new`).
   - After all inserts for a search: `UPDATE hits SET disappeared_at = $runStart WHERE saved_search_id = $id
     AND last_seen_at < $runStart AND disappeared_at IS NULL` (anything not refreshed this run disappeared).
   - Semantics match legacy `reconcileHits`: `first_seen_at` preserved across runs; reappear clears `disappeared_at`
     but preserves `notified_at` (so no re-notify).
4. **Notify:** select `hits` JOIN `saved_searches` (for `email_enabled`) JOIN `user` (for the email) WHERE
   `notified_at IS NULL AND email_enabled AND disappeared_at IS NULL AND arrival_date >= today`. Group by user.
   For each user with ≥1 row: build one email (port `buildEmailSubject`/`buildEmailBody`, "Target" → saved-search
   `name`; include Book links + a `/dashboard` link) and send via the ported email service with **`to` = that owner's
   email** (NOT an env global). On success: `UPDATE hits SET notified_at = $now WHERE id = ANY($ids)`.
5. **Record:** write a `scan_runs` row (`kind='alert'`, counts, status).

## Notification (email)

- Ported service in `apps/scanner/src/notifications/` with the `resend` dep. **Signature changes** from legacy:
  `to` is passed per-call (owner email), not read from `ALERT_EMAIL_TO`. Env needed: `RESEND_API_KEY` +
  `ALERT_EMAIL_FROM` (GitHub Actions secrets). If either is unset → **skip and log** (`'skipped-unconfigured'`),
  exactly like legacy — the scan still completes and records the run.
- One batched plaintext email per user per run; subject "CampBrain: N campsite openings found" (or the single
  form); body lists each match (park/campground/site/arrival/departure/nights/Book URL) + the standard
  "verify before booking" disclaimer + a link to `/dashboard`.

## Dashboard

- **Route:** new gated `apps/web/src/routes/dashboard.tsx` → `<RequireAuth><DashboardPage/></RequireAuth>`.
  Map stays at `/`. Add a "Dashboard" link to the NavBar (visible to signed-in users).
- **tRPC `dashboard` router (protected, `ctx.userId`-scoped):**
  - `stats` → `{ activeAlerts, currentMatches, totalHits }` (active alert-enabled searches; current = un-disappeared
    hits with `arrival_date >= today`; total = all-time hit count for the user).
  - `recentOpenings` → `RecentOpening[]` (the user's current hits, `arrival_date >= today`, `disappeared_at IS NULL`,
    sorted by `first_seen_at` desc, Book links via the stored `booking_url`).
  - `lastScan` → `{ finishedAt } | null` (latest `kind='alert'` ok run).
- **`DashboardPage`** composition: three `StatCard`s + a recent-openings table + a "Last checked: …" line +
  an empty state ("No openings yet — enable alerts on a saved search") linking to `/saved`. Tailwind/shadcn,
  matching the explore/saved surfaces. Reuses the existing `injectBookingDates` / display helpers where applicable.

## Code organization (file structure)

```
packages/db/
  migrations/                          NEW migration: hits + scan_runs (+ indexes, FK cascade)
  src/schema.ts                        MODIFY: add hits + scanRuns table defs
  src/queries/alert-match.ts           CREATE: matchSavedSearchAgainstDb + parkRegionOf builder
  src/queries/hits.ts                  CREATE: reconcileHits (upsert+disappear), listToNotify, markNotified,
                                               dashboard reads (stats/recentOpenings)
  src/queries/scan-runs.ts             CREATE: startScanRun / finishScanRun / latestAlertRun
  src/queries/users.ts (or inline)     CREATE: getUserEmail / emails-by-userIds (reads BetterAuth `user`)
  src/index.ts                         MODIFY: barrel exports

packages/core/src/
  availability/saved-search-match.ts   CREATE: expandStayWindows (+ stayDates, parkPassesScope helpers) — PURE
  index.ts                             MODIFY: export it

packages/types/src/
  hit.ts / scan-run.ts / dashboard.ts  CREATE: Zod schemas + types
  index.ts                             MODIFY: barrel

apps/scanner/
  package.json                         MODIFY: add `resend`
  src/run-alert-scan.ts                CREATE: orchestration (load→match→reconcile→notify→record)
  src/notifications/email.ts           CREATE: ported buildSubject/buildBody + sendAlertEmail({to,from,apiKey}, …)
  src/main.ts                          MODIFY: wrap each phase in a scan_runs row (startScanRun/finishScanRun)
                                               and call runAlertScan after runProactiveScan

apps/api/src/trpc/
  routers/dashboard.ts                 CREATE: protected stats/recentOpenings/lastScan
  router.ts                            MODIFY: compose dashboard router

apps/web/src/
  features/dashboard/DashboardPage.tsx CREATE + components (StatCards, RecentOpeningsTable, EmptyState)
  features/dashboard/hooks/use-dashboard.ts  CREATE: useQuery wrappers over api.dashboard.*
  routes/dashboard.tsx                 MODIFY (stub → RequireAuth + DashboardPage)
  components/NavBar (wherever it lives) MODIFY: add Dashboard link
```

## Testing

- **Core (unit):** `expandStayWindows` — fixed_range sliding windows, any_weekend horizon, minNights boundaries
  (port the legacy cases).
- **DB (integration, local PG):** `alert-match` (a seeded saved search finds the seeded availability);
  `hits` reconcile lifecycle — **new → notify-once → reappear-no-renotify → disappear** (the core correctness
  property); cross-user isolation on the dashboard reads (userB never sees userA's hits).
- **API (createCaller):** `dashboard.stats/recentOpenings/lastScan` are `ctx.userId`-scoped and reject
  UNAUTHORIZED without a session.
- **Scanner (unit):** the email service skips cleanly when `RESEND_API_KEY`/`ALERT_EMAIL_FROM` are unset; the
  notify grouping produces one payload per user.
- **Web (visual, controller-run `preview_*`):** `/dashboard` signed-in (stat cards + recent openings render
  from a seeded hit) and signed-out (sign-in prompt) — reuse the 2a dev-stub harness (throwaway `createNodeDb`
  node server + `VITE_DEV_STUB_SESSION` / `ALLOW_DEV_SESSION`).

## Manual setup (human, before alerts fire live)
Add GitHub Actions repo secrets `RESEND_API_KEY` and `ALERT_EMAIL_FROM` (a verified Resend sender). Without
them the alert scan still runs and records hits; it just logs "email skipped". After they're set, the next 6h
run emails owners their new matches. (Run the migration against Neon: `bun --filter @campbrain/db migrate`.)

## Explicitly deferred to Phase 2b-2
`/alerts` booking-window Targets, the `targets` table/migration, Google Calendar sync, `googleapis` + per-user
OAuth tokens, and the Reservation Window Engine surfaces. The `/alerts` route stays a stub this phase.

## Risks / notes
- **Owner email correctness:** the notify join must use the BetterAuth `user.email`; if a user has no email
  (shouldn't happen with Google sign-in) skip + log, don't crash the run.
- **`current matches` definition** is "un-disappeared hit with `arrival_date >= today`" — consistent between the
  dashboard `stats.currentMatches` and `recentOpenings` so the count matches the table length.
- **Scan-run cost:** alert matching adds DB reads on top of the ~36-min proactive scan; well within the 75-min
  job timeout, but `run-alert-scan` should be resilient (one failing search logged + counted in `errors`, not
  aborting the whole run).
- **Idempotency:** the reconcile is keyed on `(saved_search_id, site_name, arrival_date)` and uses the run's
  `started_at` as the seen-watermark, so a re-run is safe (no duplicate hits, no double-notify).
```
