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

## Current State

Fully operational two-tier system:

**1. Proactive Scanner** (`npm run worker`)
- Scans all 88 CA state parks every 2 hours
- Covers 180-day booking window in 8-day windows (matches parks.ca.gov API limit)
- Stores per-site per-day availability grid in Postgres (`scan_windows` + `availability`)
- ~2,000 scan windows total (88 parks × ~23 windows per 180-day scan)
- Full scan takes ~11 minutes on startup, then every 2 hours thereafter

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

*`/map` — interactive park map (Leaflet / OpenStreetMap)*
- All 88 parks as pins; click a pin to open a per-park availability panel
- Location search (Nominatim geocode) + "use my location" + distance chips (25/50/100/200mi) — distance hard-filters pins; date/availability filters grey out non-matching pins (blue = match, grey = in-range but no bookable availability)
- Four-row filter bar: WHEN (horizon presets This weekend / Next 2 weeks / Next month / Anytime + date inputs + Weekends only pill, locked under This weekend), MIN STAY (Any/1/2/3 nights, wired to summary query), NEAR (location + distance pills), ACCESS/SITE KIND/HIDE taxonomy groups; one summary sentence + Reset
- "Weekends only" pill replaces the old Weekends/All-dates tab; horizon presets replace the old date quick-set chips; "Anytime" always runs a real query (no all-green cleared state)
- Weekend panel shows explicit stay tiers (Fri–Mon 3N, Fri–Sun 2N, Sat–Mon 2N, Fri 1N, Sat 1N) — each with a Book link that injects the exact arrival date + nights; tiers are filtered by Min stay (e.g. min 2 hides 1-night tiers)
- Walk-up sites shown with badge in panel, excluded from bookable counts and pin-lighting
- Park finder type-ahead search (top-right overlay) replaces the old all-parks dropdown
- Backed by `/api/map/catalog`, `/api/map/availability?parkPageId=…&from=…&to=…`, and `/api/map/availability/summary`

Provider:
- California State Parks / ReserveCalifornia
- Endpoint: `https://www.parks.ca.gov/AvailabilityInfo?arrival_date=YYYY-MM-DD&length=1&page_id=PARKID`
- Note: `length` acts as a consecutive-nights filter, NOT a column-count control. The API always returns 8 date columns regardless of `length`. Use `length=1` to get the full per-site grid; higher values only show sites with that many consecutive available nights.

Reservation rules:
- Reservations open 6 months to the day before arrival
- Release time: 8:00 AM America/Los_Angeles

---

## Stack

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
  cli/              CLI commands (worker, scan, db, etc.)
  config/           Configuration loading and validation
  providers/        Provider adapters (California Parks parser + URL builder)
  rules/            Reservation window logic
  scanner/          Proactive availability scanner
  catalog/          Park/campground metadata loading
  cache/            Postgres-backed availability cache
    db.ts           Schema init + rebuildMaterializedView
    availability-cache.ts  All read/write queries
    types.ts        Shared types (AvailabilityWindowEntry, AvailableStay, etc.)
  utils/            Shared utilities (concurrency, etc.)

web/
  app/
    explore/        "Find Campsites" page + FindCampsitesClient
    map/            Interactive map page (MapClient, LeafletMap)
    api/            API routes
      search/       GET available stays (filters, region, date range)
      map/          catalog, availability, summary
    components/     Shared React components (SiteFilterPanel, ParkMapPopover)
  components/
    ui/             Component library — 14 typed primitives (Badge, Button, Chip, StatusDot, SiteChip, EmptyState, Card, StatCard, PageHeader, SectionTitle, KVList, Input, Toggle, Modal); barrel export index.ts; co-located *.stories.tsx
  .storybook/       Storybook 9 config (main.ts, preview.tsx)
  lib/              Client-safe utilities (available-display, site-filters, booking-url, catalog, availability-cache re-exports)

data/
  catalog/          CA parks seed data (california-parks.json) — 200 parks total, 88 with campground data
  targets.json      Alert / saved-target definitions (read by web/lib/alerts.ts)

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
   - Currently: filter controls on the web pages
   - Later: user-defined saved searches

2. **Reservation Window Engine** — When should I act?
   - Calculates 6-month booking window + 8 AM release time
   - Drives `npm run upcoming` output

3. **Availability Scanner Engine** — Is anything available now?
   - Proactive: background 8-day window scan of all parks
   - Reactive: alert scanner for specific saved targets (future)

Provider-specific logic stays isolated behind adapters. Do not mix parsing logic into CLI or business logic.

---

## Cache Architecture (Postgres)

**Key design**: The scanner stores a full per-site per-day availability grid in Postgres. Any night-count query (1N, 2N, 3N…) is answered at read time from the stored grid — no extra fetches needed. Code reads/writes through `src/cache/availability-cache.ts`; the schema lives in `src/cache/db.ts` (`initDb`).

**Tables** (provider-scoped on `provider_id = 'california-parks'`):
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

**Site classifier** — `src/catalog/site-classifier.ts` is the single source of truth for all classification regexes. `classifySite(siteName, campgroundName, recGovCampsiteType?)` sets all six columns at upsert time and on conflict (so reclassification heals existing rows). CA parks are classified by name patterns; Rec.gov sites prefer the `campsite_type` field from the month-availability payload. Use `npm run db:backfill-types` to classify existing rows by name after a schema change.

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

**What is NOT in Postgres**: Alert definitions live in `data/targets.json`; alert scan results and availability hits live in `.campbrain/state/latest-scan-results.json` and `.campbrain/state/availability-hits.json` (read by the dashboard via `web/lib/state.ts` and `web/lib/alerts.ts`). See [docs/reference/surfaces/dashboard.md](docs/reference/surfaces/dashboard.md).

---

## Web Performance

**`/explore`** is API-driven. Filter changes trigger a `GET /api/search` fetch — there is no client-side flat lookup, `useMemo` filter pass, or `React.memo` layer on this surface. Performance is gated by server response time, not client-side computation. The primary client-side strategy is **park cards collapsed by default** (only the header row renders until the user expands a card).

**`/map`** uses server-rendered availability summaries from `/api/map/availability/summary`; per-park detail panels fetch on pin click. Filter toggles that change which pins light up re-fetch the summary from the server (access/kinds/hide/minNights/weekendsOnly params). Detail panel site filtering is fully server-side (no client-side `passesSiteFilters` call).

The original <200ms filter-toggle budget was measured against the pre-API client-side architecture (now retired). See [docs/reference/surfaces/explore.md](docs/reference/surfaces/explore.md) for the current architecture.

---

## Commands

Setup (run once / when schema changes):
```
docker compose up -d          # Start local Postgres
npm run db:init               # Create tables + materialized view (idempotent)
npm run db:rebuild-mv         # Drop + recreate mv_available_stays (use after MV schema changes)
npm run db:backfill-types     # Classify existing sites rows by name (run once after schema migration)
npm run db:migrate            # Migrate legacy JSON cache → Postgres (one-time)
```

Development:
```
npm run worker                # Start proactive scanner (runs immediately + every 2h)
npm run dev                   # Start Next.js dev server (port 3001)
npm run scan                  # One-off availability scan
npm run cache:refresh         # Refresh materialized view
npm run catalog:refresh       # Discover / update CA state park catalog
npm run catalog:refresh -- --provider=recreation-gov  # Seed Rec.gov catalog (requires RIDB_API_KEY in .env)
npm run catalog:list          # List catalog entries
npm run upcoming              # Print upcoming booking windows for configured targets
npm run sync-calendar         # Sync booking windows to Google Calendar
npm run storybook             # Component catalog (Storybook 9, port 6006)
npm run typecheck             # TypeScript check
npm test                      # Vitest suite (421 tests)
npm run verify                # typecheck + test + upcoming + scan + web build
```

Planned:
- `npm run scan --target <name>` — Alert-based target scanning
- `npm run notify-test` — Send test notification

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
- Do not hardcode park-specific values (Angel Island, page_id 468, sites #4–#6) outside seed data and tests

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
- [~] Alert scanner for saved targets (email via Resend wired up; saved-target matching WIP)
- [~] Google Calendar sync for booking-window reminders (`sync-calendar` exists)
- [x] Recreation.gov provider adapter (proactive scan + ProviderBadge UI; catalog populated via `npm run catalog:refresh -- --provider=recreation-gov` once RIDB_API_KEY is set)
- [x] UI component library + Storybook catalog (14 primitives in `web/components/ui/`; Storybook 9 on :6006)
- [ ] User-defined saved searches
- [ ] Lottery window calculator (Yosemite, Death Valley, etc.)
- [ ] SMS / Slack notifications

---

## Design Philosophy

Reliable. Deterministic. Understandable. Modular. Easy to debug. Useful before fancy.

Parse once, cache in windows. Early-exit on filters. Collapse cards by default. MVP first.
