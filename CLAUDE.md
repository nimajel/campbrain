# CampBrain

## Project

Personal-use camping reservation assistant for California campgrounds, wilderness permits, and high-demand reservation systems.

Purpose:
- Track desired camping trips
- Calculate reservation and lottery windows
- Monitor campsite availability
- Generate alerts when matching campsites become available
- Browse availability across all CA state parks with instant filtering

This is NOT an automated booking bot.

Do not implement:
- CAPTCHA bypassing
- Queue evasion
- Automated checkout
- Login automation
- Proxy rotation
- High-frequency abusive scraping

The system assists in finding and preparing for reservations, while the user completes bookings manually.

---

## Documentation Map

Canonical current-state docs live in [docs/reference/](docs/reference/README.md):
surface docs (`/explore`, `/map`, dashboard), engine docs (scanner, cache, providers,
reservation-windows), and shared references (data-model, api, design-system, deployment).

**Precedence:** `docs/reference/` is the source of truth for *what is built*. This file
owns conventions, guardrails, and Next Steps. `AGENTS.md` owns the build team.
`docs/archive/` is historical only. The build team is in [AGENTS.md](AGENTS.md).

---

## Hosted-Launch Rewrite (active direction — `hosted-launch` branch)

CampBrain is being re-platformed to a **Cloudflare-native hosted stack** on the
`hosted-launch` branch. **Phase 1 (live map slice) is complete and deployed live** at
`https://campbrain-api.jelvehn.workers.dev`.

Key facts for anyone working on `hosted-launch`:
- **Single Worker serves both the Vite SPA and the API** — `apps/api` (`campbrain-api`
  Worker) binds `apps/web/dist` via `[assets]` (`not_found_handling =
  "single-page-application"`). Same origin = first-party cookies; no Cloudflare Pages.
- **DB = Neon (managed Postgres)**, Drizzle ORM + migrations. Run migrations/seed against
  Neon with `?sslmode=require` — not the local Docker instance.
- **Scanner = GitHub Actions** (`Proactive Scan` workflow, `.github/workflows/scan.yml`),
  cron `0 */6 * * *`, `timeout-minutes: 300`. The free-plan 10 ms Worker CPU cap blocks
  cheerio parsing; GitHub Actions runners have no such limit. Each run also idempotently
  seeds the catalog (`bun --filter @campbrain/db seed:catalog`) before scanning. Entry
  point unchanged: `bun --filter @campbrain/scanner start`, now running **two provider
  passes** — CA State Parks first (own MV refresh + digest build + alerts + calendar sync),
  Recreation.gov last (own MV refresh + digest build) — with a stale-`scan_runs` cleanup
  guarding against a killed prior run.
- **Map reads serve precomputed digests** — `map.availability` reads a per-park
  `park_digests` row (built by the scanner) instead of computing live, avoiding the same
  10 ms Worker CPU cap; falls back to live compute if a digest is missing/stale.
- **`availability` table is available/unknown-only** — `unavailable` is no longer
  persisted; it's implied by row-absence within a covered `scan_windows` date range.
  Enforced by `upsertEntry` (`packages/db/src/queries/upsert.ts`, skips `unavailable` at
  insert) and a CHECK constraint (`status IN ('available', 'unknown')`, migration
  `0008_available_only.sql`). This resolved a Neon free-tier 512 MB cap overflow hit on
  2026-07-03 (post first full Rec.gov scan, ~85–90% of rows were `unavailable`). Parsers
  still emit tri-state `AvailabilityStatus` in memory (`packages/core`, unchanged) — the
  filter is DB-write-boundary only. No read paths changed; all already filtered
  `status = 'available'`.
- **Repo is public** (`github.com/nimajel/campbrain`); **default branch is
  `hosted-launch`** (scanner cron runs from it).
- **Deploy:** `VITE_API_URL=<worker-origin> bun --filter @campbrain/web build` then
  `bunx wrangler deploy` from `apps/api`. Secrets via `wrangler secret put`.

Full deployment detail: [docs/reference/deployment.md](docs/reference/deployment.md).
Master design spec: `docs/superpowers/specs/2026-06-17-hosted-launch-design.md`.
Phase plans: `docs/superpowers/plans/2026-06-*-hosted-launch-phase*.md`.

The sections below describe the **legacy local app (`main` branch)**, which remains
the reference implementation until `hosted-launch` reaches feature parity (Phase 2).

---

## Current State (legacy local app — `main`)

Fully operational two-tier system:

**1. Proactive Scanner** (`npm run worker`)
- Scans all 88 CA state parks every 2 hours
- Covers 180-day booking window in 8-day windows (matches parks.ca.gov API limit)
- Stores per-site per-day availability grid in Postgres (`scan_windows` + `availability`)
- ~2,000 scan windows total (88 parks × ~23 windows per 180-day scan)
- Full scan takes ~11 minutes on startup, then every 2 hours thereafter
- Alert scan (`npm run scan`) now runs **only** alert-enabled saved searches (legacy Target alert loop removed)

**2. Web UI** (`npm run dev` → `http://localhost:3001`)

*`/explore` — "Find Campsites"* — see [docs/reference/surfaces/explore.md](docs/reference/surfaces/explore.md)
- API-driven date-range search: each change to check-in, check-out, region, or filters triggers a GET /api/search fetch
- Check-in / check-out date pickers (native `<input type="date">`)
- Region chip bar (All + per-`CampRegion` slugs from `web/lib/regions.ts`)
- Site filter panel: taxonomy groups (Access / Site kind / Hide) from `web/lib/site-taxonomy.ts`; sends `access`, `kinds`, `hide` params to server; day-use sites are excluded server-side at all times
- Campground pricing display (nightly + total cost)
- Park cards collapsed by default (primary performance strategy — server fetch replaces client-side filter memo)
- Fallback panel with alternate-date suggestions when no bookable sites found in the requested window
- Book buttons inject exact check-in date + nights into ReserveCalifornia URL
- Walk-up / first-come sites (e.g. hike/bike) shown with a **walk-up** badge, no Book button, excluded from available-site counts
- "Save this search" button captures live filter state → `SaveSearchModal` → `POST /api/saved-searches`; `?savedSearch=<id>` URL param shows a "Showing: <name>" banner when returning from `/saved`

*`/map` — interactive park map (Leaflet / OpenStreetMap)*
- All 88 parks as pins; click a pin to open a per-park availability panel
- Location search (Nominatim geocode) + "use my location" + distance chips (25/50/100/200mi) — distance hard-filters pins; date/availability filters grey out non-matching pins (blue = match, grey = in-range but no bookable availability)
- Four-row filter bar: WHEN (horizon presets This weekend / Next 2 weeks / Next month / Anytime + date inputs + Weekends only pill, locked under This weekend), MIN STAY (Any/1/2/3 nights, wired to summary query), NEAR (location + distance pills), ACCESS/SITE KIND/HIDE taxonomy groups; one summary sentence + Reset
- "Weekends only" pill replaces the old Weekends/All-dates tab; horizon presets replace the old date quick-set chips; "Anytime" always runs a real query (no all-green cleared state)
- Weekend panel shows explicit stay tiers (Fri–Mon 3N, Fri–Sun 2N, Sat–Mon 2N, Fri 1N, Sat 1N) — each with a Book link that injects the exact arrival date + nights; tiers are filtered by Min stay (e.g. min 2 hides 1-night tiers)
- Walk-up sites shown with badge in panel, excluded from bookable counts and pin-lighting
- Park finder type-ahead search (top-right overlay) replaces the old all-parks dropdown
- Backed by `/api/map/catalog`, `/api/map/availability?parkPageId=…&from=…&to=…`, and `/api/map/availability/summary`

*`/saved` — Saved Searches index*
- Lists all user-defined saved searches as cards (name, scope summary, date-pattern summary, filter chips, alert status dot)
- Per-card actions: Run (navigates to `/explore` prefilled for `fixed_range`, or `/map` with `weekendsOnly=true` for `any_weekend`), Edit, Alert on/off toggle, Delete
- Empty state with prompt to create from `/explore`
- Backed by `GET /api/saved-searches`; mutations via `PATCH` / `DELETE /api/saved-searches/[id]`

*`/alerts` — Booking Window / Calendar Sync manager*
- Manages `data/targets.json` Target entries for booking-window reminders and `sync-calendar`
- No longer shows Scan-now or last-scan affordances (scan role moved to saved searches)
- Status chip now reads "In calendar sync / Not synced"; page-level notice links to `/saved`
- CRUD + enable/disable routes still work; booking-window and calendar role unchanged

Provider:
- California State Parks / ReserveCalifornia
- Endpoint: `https://www.parks.ca.gov/AvailabilityInfo?arrival_date=YYYY-MM-DD&length=1&page_id=PARKID`
- Note: `length` acts as a consecutive-nights filter, NOT a column-count control. The API always returns 8 date columns regardless of `length`. Use `length=1` to get the full per-site grid; higher values only show sites with that many consecutive available nights.

Reservation rules:
- Reservations open 6 months to the day before arrival
- Release time: 8:00 AM America/Los_Angeles

---

## Stack (legacy local app — `main`)

> On `hosted-launch` the stack is Bun/Turborepo, Vite+shadcn (web), Hono Worker (API),
> tRPC, BetterAuth, Drizzle+Neon. See the hosted-launch section above.

- **Runtime**: Node.js 18+
- **Language**: TypeScript (strict, no `any`)
- **CLI**: commander
- **Validation**: zod
- **HTML parsing**: cheerio
- **Scheduling**: node-cron
- **Date handling**: dayjs
- **Execution**: tsx
- **Config**: JSON + `.env` (root `.env`; bridged into the Next.js process by `web/next.config.ts`)
- **Cache / persistence**: PostgreSQL via the `postgres` client (`src/cache/db.ts`). Local DB via `docker-compose.yml` (postgres:16). Connection via `DATABASE_URL`.
- **Web**: Next.js 15, React 19
- **Map**: Leaflet + react-leaflet (OpenStreetMap tiles); geocoding via Nominatim
- **Calendar**: Google Calendar API (`googleapis`) for booking-window reminders
- **Email**: Resend (`resend`) for alert notifications
- **UI**: Custom CSS design system (`globals.css` tokens + classes); `web/components/ui/` — 14 typed primitives; Storybook 9 component catalog

---

## Project Structure

```
src/
  cli/              CLI commands (worker, scan, db, migrate-targets, notify-test, etc.)
  config/           Configuration loading and validation (Target/Alert schema — booking windows)
  providers/        Provider adapters (California Parks parser + URL builder)
  rules/            Reservation window logic; weekend-arrivals.ts (shared pure Fri/Sat generator)
  scanner/          Proactive availability scanner + run-scan.ts (saved-search alert runner)
  catalog/          Park/campground metadata loading; regions.ts (CampRegion classifier — canonical)
  cache/            Postgres-backed availability cache
    db.ts           Schema init + rebuildMaterializedView (includes saved_searches table)
    availability-cache.ts  All read/write queries
    freshness.ts    Shared oldestCoveringScan helper
    types.ts        Shared types (AvailabilityWindowEntry, AvailableStay, etc.)
  saved-search/     Saved search domain
    types.ts        Zod schemas + inferred types (SavedSearch, SavedSearchInput, etc.)
    store.ts        Postgres CRUD (listSavedSearches, createSavedSearch, …, listAlertEnabledSavedSearches)
    match.ts        expandStayWindows, matchSavedSearch, todayUtc
  state/            Alert scan state
    scan-state.ts   HitsState v3 (saved-search-aware); reconcileHits, savedSearchCheckedKeys, openingsToHitRecords
  utils/            Shared utilities (concurrency, etc.)

web/
  app/
    explore/        "Find Campsites" page + FindCampsitesClient (Save-this-search button + SaveSearchModal)
    saved/          Saved searches index page + SavedSearchesClient
    alerts/         Booking-window / calendar-sync manager (scan affordances removed)
    map/            Interactive map page (MapClient, LeafletMap)
    api/            API routes
      search/       GET available stays (filters, region, date range)
      saved-searches/ CRUD + [id]/run — saved search REST API
      map/          catalog, availability, summary
    components/     Shared React components (SiteFilterPanel, ParkMapPopover, RecentOpenings, NavBar)
  components/
    SaveSearchModal.tsx  Create-from-current-filters modal (used on /explore)
    ui/             Component library — 14 typed primitives (Badge, Button, Chip, StatusDot, SiteChip, EmptyState, Card, StatCard, PageHeader, SectionTitle, KVList, Input, Toggle, Modal); barrel export index.ts; co-located *.stories.tsx
  .storybook/       Storybook 9 config (main.ts, preview.tsx)
  lib/              Client-safe utilities (available-display, site-filters, booking-url, catalog, availability-cache re-exports)
                    regions.ts re-exports CampRegion from src/catalog/regions.ts

data/
  catalog/          CA parks seed data (california-parks.json) — 200 parks total, 88 with campground data
  targets.json      Booking-window / calendar-sync targets (read by upcoming, sync-calendar, /alerts; NOT the alert scanner)

.campbrain/
  logs/             Debug logs
  debug/            HTML snapshots saved on parsing uncertainty
  state/            Alert scan state files (latest-scan-results.json, availability-hits.json); availability-cache.json is dead (availability data lives in Postgres)
```

---

## Agent Team

CampBrain has a defined team of Claude Code subagents. The roster lives in
[AGENTS.md](AGENTS.md); each agent's loadable definition is in `.claude/agents/<name>.md`.

- **architect** (opus) → **planner** (opus) → **backend-developer** / **frontend-developer**
  (sonnet) → **tester** (sonnet) → **reviewer** (sonnet, opus for risky diffs) →
  **debugger** (sonnet, on hard bugs) → **doc-steward** (sonnet).
- Spawn the right agent for the layer: `src/` + API routes → backend-developer; `web/`
  UI → frontend-developer; design → architect; ordered steps → planner.
- The **Documentation Steward** owns doc/spec freshness — see Conventions.

---

## Core Architecture

### Three Engines

1. **Trip Target Engine** — What do I want?
   - Persisted as **saved searches** in the `saved_searches` Postgres table
   - Created from `/explore` filter state via "Save this search" (`SaveSearchModal`); managed on `/saved`
   - Two date patterns: `fixed_range` (explicit from/to) and `any_weekend` (rolling horizon)

2. **Reservation Window Engine** — When should I act?
   - Calculates 6-month booking window + 8 AM release time
   - Drives `npm run upcoming` output; managed via `/alerts` (booking-window targets in `data/targets.json`)

3. **Availability Scanner Engine** — Is anything available now?
   - Proactive: background 8-day window scan of all parks (all parks, not target-specific)
   - Reactive: `npm run scan` / `npm run worker` scans **alert-enabled saved searches** only; legacy Target alert loop removed

Provider-specific logic stays isolated behind adapters. Do not mix parsing logic into CLI or business logic.

---

## Cache Architecture (Postgres)

**Key design**: The scanner stores a full per-site per-day availability grid in Postgres. Any night-count query (1N, 2N, 3N…) is answered at read time from the stored grid — no extra fetches needed. Code reads/writes through `src/cache/availability-cache.ts`; the schema lives in `src/cache/db.ts` (`initDb`).

**Tables** (provider-scoped on `provider_id = 'california-parks'` unless noted):
- `providers`, `parks` — identity
- `campgrounds` — name, `campground_id`, `nightly_fee`, `booking_url`
- `sites` — `site_id` (serial), unique per (provider, park, campground, site_name); six typed classification columns set at upsert time:
  - `access text NOT NULL DEFAULT 'drive_in'` — `'drive_in' | 'hike_in' | 'boat_in'`
  - `site_kind text` — `'tent' | 'hookup' | 'cabin' | NULL` (unspecified)
  - `is_group boolean NOT NULL DEFAULT false`
  - `is_equestrian boolean NOT NULL DEFAULT false`
  - `is_walk_up boolean NOT NULL DEFAULT false` — first-come hike/bike; never bookable
  - `is_day_use boolean NOT NULL DEFAULT false` — excluded from every user-facing surface
- `scan_windows` — one row per `(park_page_id, window_start)`; an 8-day window with `scanned_at` + `source_url`
- `availability` — `(site_id, date, status)` where status ∈ available | unavailable | unknown
- `saved_searches` — provider-scoped; `id` (uuid PK), `user_id` (nullable), `provider` FK, `name`, `definition` JSONB (`{ scope, datePattern, filters }`), `alert_enabled`, `email_enabled`, `created_at`, `updated_at`; two indexes: by `user_id` and partial on `alert_enabled = true`

**Site classifier** — `src/catalog/site-classifier.ts` (legacy/main) and `packages/core/src/catalog/site-classifier.ts` (hosted-launch authoritative; kept byte-identical) are the single source of truth for all classification regexes. `classifySite(siteName, campgroundName, recGovCampsiteType?, parkPageId?)` sets all six columns at upsert time and on conflict (so reclassification heals existing rows). CA parks are classified by name patterns — **boat-in wins over hike-in** when a name carries both signals (e.g. "Boat In Primitive Campsite", where `primitive` would otherwise match hike-in), and `kayak`/`canoe` count as boat-in access. Rec.gov sites prefer the `campsite_type` field from the month-availability payload. Use `npm run db:backfill-types` to classify existing rows by name after a schema change.

- **`PARK_ACCESS_OVERRIDES`** (in the classifier, keyed by `park_page_id`) — for parks that have **no drive-in sites** but whose individual site names carry no readable access keyword (e.g. Angel Island `468`: "Campsite #7", "Group Tent Campsite #GTC" — ferry/boat/kayak access only). The override reassigns any residual non-day-use `drive_in` site to a park-specific access (Angel Island → `hike_in`); sites that already classify as boat-in/hike-in by name (e.g. the kayak site) are left alone, and day-use sites are untouched. It is applied **inside `classifySite`** — the single chokepoint every writer funnels through (catalog seed, scanner upsert in `packages/db/src/queries/upsert.ts`, and the map read-time taxonomy predicate in `packages/core/src/availability/map-transforms.ts`) — so it survives scanner re-classification. Callers thread `parkPageId`; the hosted-launch seed/upsert/map paths pass it (legacy `src/` callers don't yet, so the override is a no-op on main). A live data fix needs no manual step — the next scan (GitHub Actions, every 6h against Neon) re-upserts with the corrected access.

**Materialized view** — `mv_available_stays`:
- Precomputes 1N/2N stays for the `/explore` page
- Two columns: `available_sites text[]` (bookable/reservable) and `walk_up_sites text[]` (first-come hike/bike sites)
- Walk-up sites are never in `available_sites`; they appear only in `walk_up_sites`
- Day-use sites (`is_day_use = true`) are excluded from both columns
- Walk-up/day-use classification reads the persisted `is_walk_up` / `is_day_use` columns (not inline name regexes)
- Refresh with `refreshMaterializedView()` (CONCURRENTLY when populated)
- Schema change → use `rebuildMaterializedView()` then `refreshMaterializedView()` (or `npm run db:rebuild-mv`)

**Walk-up / first-come sites**: Sites with `is_walk_up = true` are non-reservable (CA State Parks hike/bike campsites). They are excluded from bookable counts, pin-lighting on `/map`, and the `available_sites` MV column. They are surfaced visually with a **walk-up** badge so the user knows they exist but must show up in person.

**`AvailabilityWindowEntry`** shape (rebuilt from rows by `buildEntriesFromRows`): `{ parkPageId, parkName, windowStart, windowEnd, scannedAt, sourceUrl, campgrounds[{ id, name, nightlyFee?, bookingUrl?, sites[{ name, dates: Record<date,status>, recGovCampsiteType? }] }] }`. The optional `recGovCampsiteType` field is set by the Rec.gov provider and consumed by `classifySite` at upsert time.

**Window scanning**: `generateWindowStarts` steps by 8 days from `today+2`, but each daily run shifts the base by a day, so `scan_windows` accumulates **overlapping** windows over time. Readers that flatten per-date site lists must **dedupe site names across windows** (otherwise counts inflate). `buildDateSiteMap` uses a `Set` per (date, campground) to dedupe.

**TTL** (`ttlMinutes`, keyed on days-until-`window_start`):
- `< 7 days`: 30 min
- `7–30 days`: 2 hours
- `30–90 days`: 4 hours
- `> 90 days`: 8 hours

Staleness drives re-scan selection via `findStaleWindows`; expired windows are pruned by `evictExpired`.

**Hit state** (`src/state/scan-state.ts`) — `HitsState` is at version 3. Records for saved-search hits carry `savedSearchId`, `parkPageId`, `parkName`, `campgroundName`; hit keys are prefixed `ss:<savedSearchId>|…` to prevent collisions with any legacy Target keys. The `savedSearchCheckedKeys` helper scopes the "checked" set to a single saved search. Versions 1 and 2 are migrated forward on first read (v1 adds default `notifiedAt`; v2→v3 loads unchanged since v3 only adds optional fields).

**What is NOT in Postgres**: Booking-window targets live in `data/targets.json` (read by `npm run upcoming`, `sync-calendar`, and the `/alerts` UI — NOT the alert scanner). Alert scan results and availability hits live in `.campbrain/state/latest-scan-results.json` and `.campbrain/state/availability-hits.json` (read by the dashboard via `web/lib/state.ts`). Saved searches — the alert-scan source — ARE in Postgres (`saved_searches` table). See [docs/reference/surfaces/dashboard.md](docs/reference/surfaces/dashboard.md).

---

## Web Performance

**`/explore`** is API-driven. Filter changes trigger a `GET /api/search` fetch — there is no client-side flat lookup, `useMemo` filter pass, or `React.memo` layer on this surface. Performance is gated by server response time, not client-side computation. The primary client-side strategy is **park cards collapsed by default** (only the header row renders until the user expands a card).

**`/map`** uses server-rendered availability summaries from `/api/map/availability/summary`; per-park detail panels fetch on pin click. Filter toggles that change which pins light up re-fetch the summary from the server (access/kinds/hide/minNights/weekendsOnly params). Detail panel site filtering is fully server-side (no client-side `passesSiteFilters` call).

The original <200ms filter-toggle budget was measured against the pre-API client-side architecture (now retired). See [docs/reference/surfaces/explore.md](docs/reference/surfaces/explore.md) for the current architecture.

---

## Commands (legacy local app — `main`)

> On `hosted-launch`: `bun install`, `bun run typecheck`, `bun run test`, `bun run build`
> (Turborepo). Deploy: see the Hosted-Launch section above and `docs/reference/deployment.md`.

Setup (run once / when schema changes):
```
docker compose up -d          # Start local Postgres
npm run db:init               # Create tables + materialized view (idempotent; includes saved_searches)
npm run db:rebuild-mv         # Drop + recreate mv_available_stays (use after MV schema changes)
npm run db:backfill-types     # Classify existing sites rows by name (run once after schema migration)
npm run db:migrate            # Migrate legacy JSON cache → Postgres (one-time)
npm run db:migrate-targets    # Promote data/targets.json → saved_searches (idempotent; flips alert_enabled for previously-active targets)
```

Development:
```
npm run worker                # Start proactive scanner (runs immediately + every 2h)
npm run dev                   # Start Next.js dev server (port 3001)
npm run scan                  # One-off scan: alert-enabled saved searches only
npm run cache:refresh         # Refresh materialized view
npm run catalog:refresh       # Discover / update CA state park catalog
npm run catalog:refresh -- --provider=recreation-gov  # Seed Rec.gov catalog (requires RIDB_API_KEY in .env)
npm run catalog:list          # List catalog entries
npm run upcoming              # Print upcoming booking windows for configured targets
npm run sync-calendar         # Sync booking windows to Google Calendar
npm run notify-test           # Send a test notification email
npm run storybook             # Component catalog (Storybook 9, port 6006)
npm run typecheck             # TypeScript check
npm test                      # Vitest suite
npm run verify                # typecheck + test + upcoming + scan + web build
```

Planned:
- SMS / Slack notification channels

---

## Site Filters

Defined in `web/lib/site-taxonomy.ts` (pill group definitions + param mapping) and backed by typed columns on `sites` classified by `src/catalog/site-classifier.ts`. Applied server-side on both `/map` and `/explore`; `web/lib/site-filters.ts` is now a one-line re-export of `isWalkUpSite` from the classifier.

**Three taxonomy groups** sent as CSV query params (`access`, `kinds`, `hide`):

| Group | Values | Semantics |
|---|---|---|
| Access | `drive_in`, `hike_in`, `boat_in` | Multi-select; empty = all access types |
| Site kind | `tent`, `hookup`, `cabin` | Multi-select; empty = all kinds (including unspecified NULL-kind sites); selecting a kind excludes NULL-kind sites by design |
| Hide | `group`, `equestrian`, `walk_up` | Hides matching sites; active style is slate + eye-off icon |

Day-use sites (`is_day_use = true`) are **always** excluded from every user-facing surface — they are not a user-selectable filter.

`boat_in` is an Access value (not a Hide option); to exclude boat-in sites select only `drive_in` and/or `hike_in`.

**Summary query** (`/api/map/availability/summary`) also accepts `minNights` (1/2/3) for consecutive-night filtering, handled by a gaps-and-islands helper (`siteMatchesMinStay`).

`isWalkUpSite(siteName)` — re-exported from `src/catalog/site-classifier.ts` via `web/lib/site-filters.ts`.

---

## Conventions

- TypeScript only, strict mode, no `any` — prefer `unknown` and narrow the type
- Files: kebab-case
- Classes/types: PascalCase
- Variables/functions: camelCase
- Database columns: snake_case (Postgres)
- Pure functions where possible
- async/await consistently
- Early returns over nested conditionals
- Provider adapters must be modular and independently testable
- Documentation freshness (this file, `AGENTS.md`, specs in `docs/superpowers/specs/`,
  goal docs) is owned by the **doc-steward** agent — defer doc updates to it rather than
  editing CLAUDE.md ad-hoc
- Save raw HTML snapshots when parser confidence is low
- Do not hardcode park-specific values (Angel Island, page_id 468, sites #4–#6) outside seed data and tests. The one sanctioned exception is `PARK_ACCESS_OVERRIDES` in `site-classifier.ts` — a labeled reference-data table for parks with no name-readable access signal; it must live at the `classifySite` chokepoint (not in the catalog JSON) so it stays durable through scanner re-classification

---

## Parsing Rules

Provider parsers must:
- Be resilient to HTML structure changes
- Save debug HTML when parsing fails or confidence is low (`.campbrain/debug/`)
- Return structured typed results
- Include the source URL in scan results

Polling limits:
- Normal: every 60–120 minutes
- Close to target date: every 15–30 minutes
- Never poll every few seconds

---

## Verification

After every meaningful change, run:
- `npm run typecheck`
- Test the relevant CLI command or web page manually

Before committing:
- TypeScript must pass
- Web page loads and renders without console errors
- No hydration warnings or React errors
- No duplicate alert notifications

---

## Next Steps

- [x] Persistent storage (Postgres)
- [x] Interactive park map with distance + availability filtering
- [x] Walk-up site detection + badging (hike/bike excluded from bookable counts)
- [x] Map Book-link date injection (correct arrival date + nights on ReserveCalifornia)
- [x] Alert scanner for saved targets (saved searches in Postgres; email via Resend; hit-state v3; legacy Target alert loop retired)
- [~] Google Calendar sync for booking-window reminders (`sync-calendar` exists)
- [x] Recreation.gov provider adapter (proactive scan + ProviderBadge UI; catalog populated via `npm run catalog:refresh -- --provider=recreation-gov` once RIDB_API_KEY is set)
- [x] UI component library + Storybook catalog (14 primitives in `web/components/ui/`; Storybook 9 on :6006)
- [x] User-defined saved searches (`saved_searches` table; `/saved` surface; create-from-filters on `/explore`; CRUD REST API; scanner-wired)
- [x] Hosted Cloudflare deployment — Phase 1 LIVE (`hosted-launch` branch; single Worker
      serves Vite SPA + tRPC API; Neon DB; GitHub Actions scanner; BetterAuth Google login;
      deployed at https://campbrain-api.jelvehn.workers.dev)
- [~] Hosted deployment — Phase 2: port remaining surfaces to `hosted-launch` (`/explore`,
      `/saved`, `/alerts`, `/dashboard`); full multi-user feature parity; merge to `main`
- [ ] Lottery window calculator (Yosemite, Death Valley, etc.)
- [ ] SMS / Slack notifications

---

## Design Philosophy

Reliable. Deterministic. Understandable. Modular. Easy to debug. Useful before fancy.

Parse once, cache in windows. Early-exit on filters. Collapse cards by default. MVP first.
