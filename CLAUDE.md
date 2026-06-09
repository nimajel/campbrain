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

*`/explore` — "Find Campsites"*
- Real-time multi-park availability search with filters
- Date range picker (from / to)
- Multi-site filter panel (e.g., "Exclude group", "Exclude walk-up", "Hike-in only")
- Night count selector (1N, 2N, All)
- Weekend-only toggle
- Campground pricing display (nightly + total cost)
- Park cards collapsed by default
- Pagination: 10 date groups initially, "Show more" for additional weeks
- Filter response: <200ms
- Manual "Refresh now" to trigger on-demand scan
- Book buttons pre-populate arrival date and nights on ReserveCalifornia
- Walk-up / first-come sites (e.g. hike/bike) shown with a **walk-up** badge, no Book button, excluded from available-site counts

*`/map` — interactive park map (Leaflet / OpenStreetMap)*
- All 88 parks as pins; click a pin to open a per-park availability panel
- Location search (Nominatim geocode) + "use my location" + distance chips (25/50/100/200mi) — distance hard-filters pins; date/availability filters grey out non-matching pins (blue = match, grey = in-range but no bookable availability)
- "Weekends" vs "All dates" view, night-count and site filters, date-range picker
- Date range constrains both which pins light up and what the detail panel shows
- Weekend panel shows explicit stay tiers (Fri–Mon 3N, Fri–Sun 2N, Sat–Mon 2N, Fri 1N, Sat 1N) — each with a Book link that injects the exact arrival date + nights
- Walk-up sites shown with badge in panel, excluded from bookable counts and pin-lighting
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
- **Web**: Next.js 14, React 18
- **Map**: Leaflet + react-leaflet (OpenStreetMap tiles); geocoding via Nominatim
- **Calendar**: Google Calendar API (`googleapis`) for booking-window reminders
- **Email**: Resend (`resend`) for alert notifications
- **UI**: Tailwind CSS + light custom CSS

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
      search/       GET stays + POST refresh
      map/          catalog, availability, summary
    components/     Shared React components (SiteFilterPanel, ParkMapPopover)
  lib/              Client-safe utilities (available-display, site-filters, booking-url, catalog, availability-cache re-exports)

data/
  catalog/          CA parks seed data (california-parks.json) — 200 parks total, 88 with campground data

.campbrain/
  logs/             Debug logs
  debug/            HTML snapshots saved on parsing uncertainty
  state/            Legacy — availability-cache.json is dead (data lives in Postgres)
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
- `sites` — `site_id` (serial), unique per (provider, park, campground, site_name)
- `scan_windows` — one row per `(park_page_id, window_start)`; an 8-day window with `scanned_at` + `source_url`
- `availability` — `(site_id, date, status)` where status ∈ available | unavailable | unknown

**Materialized view** — `mv_available_stays`:
- Precomputes 1N/2N stays for the `/explore` page
- Two columns: `available_sites text[]` (bookable/reservable) and `walk_up_sites text[]` (first-come hike/bike sites)
- Walk-up sites are never in `available_sites`; they appear only in `walk_up_sites`
- Refresh with `refreshMaterializedView()` (CONCURRENTLY when populated)
- Schema change → use `rebuildMaterializedView()` then `refreshMaterializedView()` (or `npm run db:rebuild-mv`)

**Walk-up / first-come sites**: Sites matching `hike\s*[/&]?\s*bike` are non-reservable (CA State Parks hike/bike campsites). They are excluded from bookable counts, pin-lighting on `/map`, and the `available_sites` MV column. They are surfaced visually with a **walk-up** badge so the user knows they exist but must show up in person.

**`AvailabilityWindowEntry`** shape (rebuilt from rows by `buildEntriesFromRows`): `{ parkPageId, parkName, windowStart, windowEnd, scannedAt, sourceUrl, campgrounds[{ id, name, nightlyFee?, bookingUrl?, sites[{ name, dates: Record<date,status> }] }] }`.

**Window scanning**: `generateWindowStarts` steps by 8 days from `today+2`, but each daily run shifts the base by a day, so `scan_windows` accumulates **overlapping** windows over time. Readers that flatten per-date site lists must **dedupe site names across windows** (otherwise counts inflate). `buildDateSiteMap` uses a `Set` per (date, campground) to dedupe.

**TTL** (`ttlMinutes`, keyed on days-until-`window_start`):
- `< 7 days`: 30 min
- `7–30 days`: 2 hours
- `30–90 days`: 4 hours
- `> 90 days`: 8 hours

Staleness drives re-scan selection via `findStaleWindows`; expired windows are pruned by `evictExpired`.

---

## Web Performance

**Problem**: 88 parks × 180 dates × filter checks was slow (~800ms per toggle).

**Solution** (in order of impact):
1. **Park cards collapsed by default** — Only header row renders; biggest single win
2. **Early-exit pagination** — `groupFromLookup` stops after PAGE_SIZE (10) date groups; skips ~170 dates
3. **Pre-computed flat lookup** — Built once on entries change: `parkId → campground → site → date → status`
4. **Synchronous useMemo** — Replaces `useEffect + startTransition`; early-exit computation is fast enough that async scheduling only added latency
5. **Campground filter cache** — Regex results memoized per (name, filterSet) within each call
6. **React.memo** on `DateSection`, `ParkCard`, `CampgroundRow`

**Result**: 102–173ms per filter toggle (target: <200ms).

---

## Commands

Setup (run once / when schema changes):
```
docker compose up -d          # Start local Postgres
npm run db:init               # Create tables + materialized view (idempotent)
npm run db:rebuild-mv         # Drop + recreate mv_available_stays (use after MV schema changes)
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
npm run typecheck             # TypeScript check
npm test                      # Vitest suite (340 tests)
npm run verify                # typecheck + test + upcoming + scan + web build
```

Planned:
- `npm run scan --target <name>` — Alert-based target scanning
- `npm run notify-test` — Send test notification

---

## Site Filters

Defined in `web/lib/site-filters.ts`. Applied client-side on `/explore` and in the `/map` detail panel. Corresponding SQL patterns in `src/cache/availability-cache.ts` (`FILTER_SQL`) applied server-side for pin-lighting.

| Filter ID | Behavior |
|---|---|
| `exclude_group` | Hides sites/campgrounds with "group" in name |
| `exclude_walk_up` | Hides walk-up / first-come hike/bike sites |
| `exclude_day_use` | Hides day-use, picnic areas |
| `hike_in_only` | Shows only hike-in / walk-in sites |
| `exclude_equestrian` | Hides equestrian / horse sites |
| `exclude_boat_in` | Hides boat-in / boat-access sites reachable only by watercraft |

`isWalkUpSite(siteName)` — exported helper for detecting hike/bike sites by name pattern.

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
- Filters respond in <200ms
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
- [ ] User-defined saved searches
- [ ] Lottery window calculator (Yosemite, Death Valley, etc.)
- [ ] SMS / Slack notifications

---

## Design Philosophy

Reliable. Deterministic. Understandable. Modular. Easy to debug. Useful before fancy.

Parse once, cache in windows. Early-exit on filters. Collapse cards by default. MVP first.
