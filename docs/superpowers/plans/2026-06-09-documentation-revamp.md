# Documentation Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a modular, AI-reproducible reference doc set under `docs/reference/`, split by surface and engine, with shared schema/API/design/deployment references and an explicit old-vs-new precedence rule; archive the 12 historical goal docs.

**Architecture:** Each doc is authored by *reading the actual shipped code* (paths given per task) and filling a fixed template (Behavior/Presentation for surfaces; Responsibilities/Algorithms for engines). Shared facts live in single reference files (`data-model.md`, `api.md`, `design-system.md`, `deployment.md`) that surface/engine docs link to. Authoring order is shared-refs → surfaces → engines → map/README → migration, because later docs link the earlier ones.

**Tech Stack:** Markdown only. Source of truth is the codebase (`src/`, `web/`), `CLAUDE.md`, and `AGENTS.md`. Spec: `docs/superpowers/specs/2026-06-09-documentation-revamp-design.md`.

---

## Conventions for every doc (apply in all tasks)

- First line after the H1 title: `**Status:** shipped | partial | planned`.
- Forward-looking notes use a fenced callout: `> Future: <note — not yet built>`.
- Surfaces never inline schema/route shapes → link to `../data-model.md` / `../api.md`.
- Presentation sections never define tokens/components inline → link to `../design-system.md`.
- Every doc ends with a `## Dependencies` section naming the files it relies on.
- No doc links to `docs/archive/` as a source of current truth.
- Relative links between reference docs (e.g. `[data model](../data-model.md)`).

**"Verify" in this plan means, unless stated otherwise:**
1. All template sections present.
2. Every internal markdown link resolves to a real file/anchor (`grep` the link targets exist).
3. A 2-minute fidelity spot-check: open one named source file and confirm the doc's claims match.

---

## Task 1: Scaffold the reference tree + overview

**Files:**
- Create: `docs/reference/00-overview.md`
- Create: `docs/reference/surfaces/` (dir, via the explore doc later — just note it)

**Source to read first:** `CLAUDE.md` (Project, Current State, Cache Architecture, Design Philosophy), `src/scanner/proactive-scanner.ts`, `web/app/layout.tsx` (the real nav).

- [ ] **Step 1: Write `00-overview.md`**

Content requirements (write actual prose, not placeholders):
- `**Status:** shipped`
- **System shape** — two tiers: proactive scanner (`npm run worker`) + Next.js web app (`npm run dev`, port 3001).
- **Data flow** — one line each: provider (CA Parks / Rec.gov) → scanner → Postgres (`scan_windows`+`availability`) → `mv_available_stays` → API routes → surfaces.
- **Glossary** — define: *window* (8-day scan span), *stay* (1N/2N reservable span), *walk-up* (hike/bike, non-reservable), *page_id* (CA Parks park identifier), *materialized view*.
- **Guardrails** — not a booking bot; no CAPTCHA/queue/checkout/login automation; polling ≥60–120 min. (Link to `CLAUDE.md` for the full list rather than restate it all.)
- `## Dependencies` — links to `CLAUDE.md`, `data-model.md`, `api.md`.

- [ ] **Step 2: Verify**

Run: `test -f docs/reference/00-overview.md && grep -c "Status:" docs/reference/00-overview.md`
Expected: file exists, Status line present. Confirm the nav list in the doc matches `web/app/layout.tsx:19-25`.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/00-overview.md
git commit -m "docs(reference): add system overview"
```

---

## Task 2: Data model reference (single schema source)

**Files:**
- Create: `docs/reference/data-model.md`

**Source to read:** `src/cache/db.ts` (full schema + MV), `src/cache/types.ts`, `src/cache/availability-cache.ts` (FILTER_SQL, buildEntriesFromRows, buildDateSiteMap).

- [ ] **Step 1: Write `data-model.md`**

Content requirements:
- `**Status:** shipped`
- **Tables** — one subsection per table (`providers`, `parks`, `campgrounds`, `sites`, `scan_windows`, `availability`) with columns, types, and the unique/PK constraints exactly as defined in `src/cache/db.ts`. Note `provider_id = 'california-parks'` scoping and `availability.status ∈ available|unavailable|unknown`.
- **Materialized view `mv_available_stays`** — purpose (precomputes 1N/2N), the two array columns `available_sites text[]` and `walk_up_sites text[]`, the invariant that walk-up sites are never in `available_sites`, and refresh semantics (`refreshMaterializedView` CONCURRENTLY; `rebuildMaterializedView` on schema change; `npm run db:rebuild-mv`).
- **Shared types** — `AvailabilityWindowEntry` (full shape), `AvailableStay`, and others in `src/cache/types.ts`. Paste the actual TS shapes.
- **Invariants** — window overlap + dedupe-by-site-name across windows (cite `buildDateSiteMap`'s Set), TTL tiers (<7d:30m, 7–30d:2h, 30–90d:4h, >90d:8h), walk-up regex `hike\s*[/&]?\s*bike`.
- `## Dependencies` — `engines/cache.md`, `engines/scanner.md`.

- [ ] **Step 2: Verify**

Run: `grep -n "create table\|materialized view\|create unique" src/cache/db.ts`
Confirm every table/column in the doc appears in `db.ts`. Status line present.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/data-model.md
git commit -m "docs(reference): add data-model reference"
```

---

## Task 3: API contract reference

**Files:**
- Create: `docs/reference/api.md`

**Source to read:** every `route.ts` under `web/app/api/`, prioritizing the ones the three core surfaces use: `web/app/api/search/route.ts`, `web/app/api/map/catalog/route.ts`, `web/app/api/map/availability/route.ts`, `web/app/api/map/availability/summary/route.ts`, `web/app/api/scan/route.ts`, `web/app/api/state/route.ts`, `web/app/api/alerts/route.ts`. Also read `web/app/explore/FindCampsitesClient.tsx` and `web/app/map/*Client*.tsx` to see which routes each surface actually calls.

- [ ] **Step 1: Write `api.md`**

Content requirements — one subsection per route, in this exact shape:
```
### `<METHOD> /api/<path>`
- **Purpose:** …
- **Params:** query/body params with types
- **Response:** response shape (link types to ../data-model.md where reused)
- **Backed by:** the cache query / engine function it calls
- **Consumed by:** which surface(s)
```
Cover at minimum the routes the three core surfaces call. Group remaining routes under an **"Other / possibly-legacy routes"** heading with a one-line purpose each (do not deep-document — they may be pruned).

- [ ] **Step 2: Verify**

Run: `find web/app/api -name route.ts | wc -l` and confirm every route file is either fully documented or listed under "Other / possibly-legacy". Confirm each "Consumed by" claim by grepping the client file for the route path.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/api.md
git commit -m "docs(reference): add API contract reference"
```

---

## Task 4: Design-system reference (the restyle file)

**Files:**
- Create: `docs/reference/design-system.md`

**Source to read:** `web/app/layout.tsx`, `web/app/globals.css` (or wherever CSS vars live — grep `--muted`, `--` tokens), `web/app/components/SiteFilterPanel.tsx`, `web/app/components/ParkMapPopover.tsx`, `web/lib/providers.ts` (ProviderBadge if present), `web/lib/site-filters.ts`.

- [ ] **Step 1: Write `design-system.md`**

Content requirements:
- `**Status:** shipped`
- **Tokens** — CSS custom properties actually defined (colors like `--muted`, spacing), and the Tailwind usage convention.
- **Shared components** — one entry per component (`SiteFilterPanel`, `ParkMapPopover`, badges `badge-blue`/`badge-gray`, the `dot`/`card` patterns from `layout.tsx`/`page.tsx`): what it renders, its props/inputs, where it's used.
- **Layout patterns** — `.page-header`/`.page-subtitle`, `.card`, the nav bar.
- `> Future:` callout noting this is the single file to edit for the planned aesthetic polish; restyles touch this + surface Presentation sections only.
- `## Dependencies` — none upstream; list surfaces that depend on it.

- [ ] **Step 2: Verify**

Run: `grep -rn "badge-blue\|page-header\|--muted" web/app | head` — confirm documented classes/tokens actually exist.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/design-system.md
git commit -m "docs(reference): add design-system reference"
```

---

## Task 5: Deployment reference (current local + path to hosted)

**Files:**
- Create: `docs/reference/deployment.md`

**Source to read:** `docker-compose.yml`, `package.json` scripts, `web/next.config.ts` (env bridging), `CLAUDE.md` Commands section, `.env` key names (do NOT copy secret values — only key names).

- [ ] **Step 1: Write `deployment.md`**

Content requirements:
- `**Status:** partial` (local shipped, hosted planned)
- **Current (local)** — docker-compose Postgres (`postgres:16`), `npm run db:init`, `npm run worker` (scanner, runs immediately + every 2h), `npm run dev` (Next.js :3001), config via root `.env` + `DATABASE_URL` bridged by `web/next.config.ts`. List required env key names.
- `> Future:` **Path to hosted** — managed Postgres; host the Next.js app; run the worker as a scheduled/background job (not a long-lived local process); secrets via host env. Mark explicitly not-yet-built.
- `## Dependencies` — `engines/scanner.md`, `engines/cache.md`.

- [ ] **Step 2: Verify**

Run: `grep -n "image:\|postgres" docker-compose.yml` and confirm the doc's local topology matches. Confirm script names against `package.json`.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/deployment.md
git commit -m "docs(reference): add deployment reference"
```

---

## Task 6: Surface doc — `/explore` (availability search)

**Files:**
- Create: `docs/reference/surfaces/explore.md`

**Source to read:** `web/app/explore/page.tsx`, `web/app/explore/FindCampsitesClient.tsx`, `web/lib/site-filters.ts`, `web/lib/availability-query.ts`, `web/lib/booking-url.ts`, and the search API route it calls (from Task 3).

- [ ] **Step 1: Write `explore.md` using the surface template**

Sections (all required):
- `**Status:** shipped`
- **Purpose** — one line.
- **Behavior / Contract** — route `/explore`; the API route(s) it calls (link `../api.md`); filters (date range, multi-site filters, night count 1N/2N/All, weekend-only) citing `web/lib/site-filters.ts`; dedupe-across-windows and pagination (10 date groups + "Show more"); output states (empty/loading/walk-up badge); invariant: walk-up sites excluded from bookable counts. Link data shapes to `../data-model.md`.
- **Presentation** — collapsed-by-default park cards, pricing display, Book buttons that inject arrival date + nights; components link to `../design-system.md`; perf note (<200ms filter target, flat lookup `parkId→campground→site→date→status`, `React.memo`).
- **Reproduction checklist** — ordered, self-contained, references shared docs by name (model the spec's example, corrected to `/explore` + `FindCampsitesClient`).
- `## Dependencies` — `engines/cache.md`, `api.md`, `data-model.md`, `design-system.md`.

- [ ] **Step 2: Verify**

Confirm every filter named in the doc exists in `web/lib/site-filters.ts`; confirm the API route(s) named match what `FindCampsitesClient.tsx` fetches. All template sections present; links resolve.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/surfaces/explore.md
git commit -m "docs(reference): add /explore surface doc"
```

---

## Task 7: Surface doc — `/map`

**Files:**
- Create: `docs/reference/surfaces/map.md`

**Source to read:** `web/app/map/page.tsx` and its client component(s), `web/app/components/ParkMapPopover.tsx`, `src/catalog/geocode.ts`, the `/api/map/*` routes.

- [ ] **Step 1: Write `map.md` using the surface template**

Required content per template:
- `**Status:** shipped`, **Purpose**.
- **Behavior / Contract** — Leaflet/OSM pins for all parks; location search (Nominatim) + "use my location" + distance chips (25/50/100/200mi) hard-filtering pins; date/availability filters greying non-matching pins (blue=match, grey=in-range no bookable); weekend vs all-dates; weekend stay tiers (Fri–Mon 3N, Fri–Sun 2N, Sat–Mon 2N, Fri 1N, Sat 1N) each with a date-injecting Book link; walk-up excluded from pin-lighting and counts. APIs: `/api/map/catalog`, `/api/map/availability`, `/api/map/availability/summary` (link `../api.md`).
- **Presentation** — map + detail panel layout; `ParkMapPopover`; components link `../design-system.md`.
- **Reproduction checklist** — ordered, self-contained.
- `## Dependencies` — `engines/cache.md`, `providers`, `api.md`, `data-model.md`, `design-system.md`.

- [ ] **Step 2: Verify**

Confirm distance chip values and stay tiers against the actual map client source; confirm the three `/api/map/*` routes exist. Template sections present; links resolve.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/surfaces/map.md
git commit -m "docs(reference): add /map surface doc"
```

---

## Task 8: Surface doc — Dashboard (`/`)

**Files:**
- Create: `docs/reference/surfaces/dashboard.md`

**Source to read:** `web/app/page.tsx`, `web/lib/alerts.ts`, `web/lib/state.ts`.

- [ ] **Step 1: Write `dashboard.md` using the surface template**

Required:
- `**Status:** shipped`, **Purpose** (landing page: alerts list + latest scan summary).
- **Behavior / Contract** — server component (`force-dynamic`); reads alerts via `listAlertsWeb` and scan state via `getLatestScanState`/`getHitsState`; renders alert rows with provider/email/calendar badges and date-range labels; relative-time formatting. Link any persisted shapes to `../data-model.md`/`../api.md`.
- **Presentation** — `.card` rows, `.dot`/`.badge` indicators (link `../design-system.md`).
- **Reproduction checklist** — ordered.
- `## Dependencies`.

- [ ] **Step 2: Verify**

Confirm `web/app/page.tsx` imports `listAlertsWeb`, `getLatestScanState`, `getHitsState` as documented. Template sections present.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/surfaces/dashboard.md
git commit -m "docs(reference): add dashboard surface doc"
```

---

## Task 9: Surface inventory (the 8 other live pages)

**Files:**
- Create: `docs/reference/surfaces/inventory.md`

**Source to read:** the `page.tsx` of each: `web/app/alerts`, `scan-history`, `calendar`, `settings`, `catalog`, `scan`, `targets`, `windows`. One quick read each — purpose only.

- [ ] **Step 1: Write `inventory.md`**

Content:
- `**Status:** partial` with a header note: *"Live pages not (yet) given full surface docs. Each is flagged keep-candidate or possibly-legacy; the user plans to prune. Promote to a full surface doc in `surfaces/` if kept."*
- A table: `| Route | In nav? | Purpose (one line) | Status guess |` with a row per page. Mark `/targets` and `/windows` as `possibly-legacy` (not in nav); mark nav pages `keep-candidate`.
- `## Dependencies` — `api.md` (routes they consume), noted per row if obvious.

- [ ] **Step 2: Verify**

Run: `for d in alerts scan-history calendar settings catalog scan targets windows; do test -f web/app/$d/page.tsx && echo "$d ok"; done` — every documented page exists. Each row has a one-line purpose.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/surfaces/inventory.md
git commit -m "docs(reference): add surface inventory for non-core pages"
```

---

## Task 10: Engine doc — scanner

**Files:**
- Create: `docs/reference/engines/scanner.md`

**Source to read:** `src/scanner/proactive-scanner.ts`, `src/scanner/run-scan.ts`, `src/cli/commands/worker.ts`, `src/rules/scan-candidates.ts`, `src/utils/concurrency.ts`.

- [ ] **Step 1: Write `scanner.md` using the engine template**

Required: `**Status:** shipped`; **Purpose**; **Responsibilities** (scans all parks every 2h, 180-day window in 8-day steps, writes grid to Postgres; does NOT serve reads); **Key files** (paths above); **Algorithms & invariants** (`generateWindowStarts` steps by 8 from today+2; daily base shift → overlapping windows; staleness via `findStaleWindows` + TTL tiers; `evictExpired`; concurrency limits and polling guardrails); **Reproduction checklist** (ordered); **Dependencies** (`cache.md`, `providers`, `data-model.md`).

- [ ] **Step 2: Verify**

Confirm `generateWindowStarts`, `findStaleWindows`, `evictExpired` exist in the cited files (`grep`). Template sections present.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/engines/scanner.md
git commit -m "docs(reference): add scanner engine doc"
```

---

## Task 11: Engine doc — cache

**Files:**
- Create: `docs/reference/engines/cache.md`

**Source to read:** `src/cache/availability-cache.ts`, `src/cache/db.ts`, `web/lib/availability-cache.ts`, `web/lib/availability-query.ts`.

- [ ] **Step 1: Write `cache.md` using the engine template**

Required: `**Status:** shipped`; **Purpose** (read/write layer over Postgres; serves all night-count queries from the stored grid); **Responsibilities**; **Key files**; **Algorithms & invariants** — dedupe site names across overlapping windows (`buildDateSiteMap` Set), `buildEntriesFromRows`, `FILTER_SQL` server-side filter patterns, MV refresh/rebuild rules, walk-up exclusion from `available_sites`; **Reproduction checklist**; **Dependencies** (`data-model.md`, `scanner.md`, consumed by surfaces via `api.md`).

- [ ] **Step 2: Verify**

Confirm `buildDateSiteMap`, `buildEntriesFromRows`, `FILTER_SQL` exist (`grep` `src/cache/availability-cache.ts`). Sections present; links resolve.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/engines/cache.md
git commit -m "docs(reference): add cache engine doc"
```

---

## Task 12: Engine doc — providers

**Files:**
- Create: `docs/reference/engines/providers.md`

**Source to read:** `src/providers/availability-provider.ts` (the interface), `src/providers/california-parks-provider.ts`, `src/providers/california-parks-parser.ts`, `src/providers/recreation-gov-provider.ts`, `src/catalog/discover-california-parks.ts`, `src/catalog/discover-recreation-gov.ts`.

- [ ] **Step 1: Write `providers.md` using the engine template**

Required: `**Status:** shipped` (Rec.gov `partial` if noted); **Purpose** (adapter boundary; parsing isolated from business logic); **Responsibilities**; **Key files**; **Algorithms & invariants** — the `AvailabilityProvider` interface contract; CA Parks endpoint `AvailabilityInfo?arrival_date&length&page_id` and the **`length` gotcha** (it's a consecutive-nights filter, always returns 8 columns; use `length=1`); save debug HTML on low parser confidence (`.campbrain/debug/`); Rec.gov RIDB key + rate-limit/skip behavior; **Reproduction checklist** (how to add a new provider adapter); **Dependencies** (`scanner.md`, `data-model.md`, `catalog`).

- [ ] **Step 2: Verify**

Confirm the `AvailabilityProvider` interface shape against `src/providers/availability-provider.ts`. Confirm the `length=1` behavior note matches CLAUDE.md. Sections present.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/engines/providers.md
git commit -m "docs(reference): add providers engine doc"
```

---

## Task 13: Engine doc — reservation windows

**Files:**
- Create: `docs/reference/engines/reservation-windows.md`

**Source to read:** `src/rules/booking-window.ts`, `src/cli/commands/upcoming.ts`, `src/utils/dates.ts`.

- [ ] **Step 1: Write `reservation-windows.md` using the engine template**

Required: `**Status:** shipped`; **Purpose** (computes when to act — 6-month booking window + 8 AM PT release); **Responsibilities**; **Key files**; **Algorithms & invariants** — reservations open 6 months to the day before arrival; release 08:00 America/Los_Angeles; drives `npm run upcoming`; **Reproduction checklist**; **Dependencies** (`data-model.md` if it reads targets, else none upstream).

- [ ] **Step 2: Verify**

Confirm the 6-month + 8 AM logic against `src/rules/booking-window.ts`. Sections present.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/engines/reservation-windows.md
git commit -m "docs(reference): add reservation-windows engine doc"
```

---

## Task 14: The map — `reference/README.md` (write once targets exist)

**Files:**
- Create: `docs/reference/README.md`

- [ ] **Step 1: Write `README.md`**

Content requirements:
- **Opens with the precedence rule** (verbatim intent from the spec): `docs/reference/` is the single source of current truth; `CLAUDE.md` owns conventions/guardrails/Next Steps and defers to reference on surface detail; `AGENTS.md` owns the build team; `docs/archive/` is historical and never current.
- **Map of the set** — a list/table linking every reference doc with its one-line purpose (all files created in Tasks 1–13).
- **Recommended rebuild order** — `00-overview` → `data-model` → `api` → `design-system` → `deployment` → surfaces → engines.
- **Link out to `../../AGENTS.md`** for the build team.
- **"Evolving this doc set"** — the four procedures from the spec: add a surface, remove/rename a surface, restyle, go hosted.

- [ ] **Step 2: Verify**

Run: `for f in 00-overview data-model api design-system deployment; do test -f docs/reference/$f.md && echo "$f ok"; done` and confirm every link in README resolves (each `surfaces/*.md` and `engines/*.md` from Tasks 6–13 exists).

- [ ] **Step 3: Commit**

```bash
git add docs/reference/README.md
git commit -m "docs(reference): add reference README/map with precedence + evolution rules"
```

---

## Task 15: Archive the historical goal docs

**Files:**
- Move: `docs/*-goal.md` → `docs/archive/`
- Create: `docs/archive/README.md`

- [ ] **Step 1: Move the 12 goal docs**

```bash
mkdir -p docs/archive
git mv docs/alert-system-backend-goal.md docs/alerts-ui-goal.md docs/angel-island-scanner-goal.md docs/backend-status-goal.md docs/calendar-reminders-goal.md docs/catalog-and-simplified-alerts-goal.md docs/configurable-targets-goal.md docs/email-alerts-goal.md docs/local-state-goal.md docs/local-ui-goal.md docs/map-search-page-goal.md docs/scheduled-scans-goal.md docs/archive/
```

- [ ] **Step 2: Prepend the ARCHIVED banner to each**

For every file in `docs/archive/*-goal.md`, insert as the new first line:
```
> ARCHIVED — historical intent, superseded by docs/reference/. Not current truth.
```
(Use an Edit per file, inserting before the existing top `# ` heading.)

- [ ] **Step 3: Write `docs/archive/README.md`**

```markdown
# Archived documentation

> These are historical goal/intent docs, superseded by `docs/reference/`.
> They record what was once planned, not what exists. Do not treat as current truth.

See `docs/reference/README.md` for the canonical, current documentation.
```

- [ ] **Step 4: Verify**

Run: `ls docs/*.md 2>/dev/null` → expect no goal docs left at `docs/` root. Run: `head -1 docs/archive/*-goal.md` → every file shows the ARCHIVED banner.

- [ ] **Step 5: Commit**

```bash
git add docs/archive
git commit -m "docs: archive 12 historical goal docs with ARCHIVED banners"
```

---

## Task 16: CLAUDE.md Documentation Map + `/available`→`/explore` correction

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a "Documentation Map" section near the top of CLAUDE.md**

After the `# CampBrain` intro / before `## Project` (or just after Project), insert:
```markdown
## Documentation Map

Canonical current-state docs live in [docs/reference/](docs/reference/README.md):
surface docs (`/explore`, `/map`, dashboard), engine docs (scanner, cache, providers,
reservation-windows), and shared references (data-model, api, design-system, deployment).

**Precedence:** `docs/reference/` is the source of truth for *what is built*. This file
owns conventions, guardrails, and Next Steps. `AGENTS.md` owns the build team.
`docs/archive/` is historical only. The build team is in [AGENTS.md](AGENTS.md).
```

- [ ] **Step 2: Correct the stale `/available` naming**

In the `## Current State` section, update the `/available` references to reflect that the
live route is `/explore` ("Find Campsites"). Keep the feature description; fix the route
name and the `web/app/available/` path references. Do not delete the feature docs — only
correct the route name/path. (This is a route-name correction, not a content rewrite; if
broader CLAUDE.md reconciliation is wanted, defer to the doc-steward agent per project
convention.)

- [ ] **Step 3: Verify**

Run: `grep -n "/available\|/explore\|Documentation Map" CLAUDE.md` — confirm the Documentation Map section exists and `/available` route references are corrected to `/explore`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Documentation Map to CLAUDE.md; correct /available -> /explore"
```

---

## Task 17: Final cross-link + fidelity sweep

- [ ] **Step 1: Verify all internal links resolve**

Run a link check across the new set:
```bash
grep -rEoh "\]\(([^)]+\.md)[^)]*\)" docs/reference | sed -E 's/.*\(([^)#]+).*/\1/' | sort -u
```
For each relative target, confirm the file exists from its containing doc's directory. Fix any broken link.

- [ ] **Step 2: Template-conformance check**

For each `surfaces/*.md` confirm sections: Status, Purpose, Behavior/Contract, Presentation, Reproduction checklist, Dependencies. For each `engines/*.md`: Status, Purpose, Responsibilities, Key files, Algorithms & invariants, Reproduction checklist, Dependencies.

- [ ] **Step 3: Precedence consistency check**

Confirm `reference/README.md` and the CLAUDE.md "Documentation Map" state the same precedence order. Confirm no reference doc links to `docs/archive/` as a source.

- [ ] **Step 4: Spot-check fidelity (pick 3)**

Open three docs and verify one concrete claim each against the cited source file (e.g. cache TTL tiers vs `availability-cache.ts`; map distance chips vs the map client; schema columns vs `db.ts`). Fix mismatches.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A docs CLAUDE.md
git commit -m "docs(reference): final cross-link and fidelity sweep"
```

---

## Self-review notes (author already checked)

- **Spec coverage:** overview, data-model, api, design-system, deployment, 3 surfaces + inventory, 4 engines, README/map (precedence + evolution), archive migration (banners + README), CLAUDE.md Documentation Map + `/available` fix, final sweep — all spec sections mapped to a task.
- **Reality alignment:** surfaces corrected to `/explore`/`/map`/dashboard; 8 other pages inventoried; CLAUDE.md staleness fixed in Task 16.
- **No code placeholders:** doc tasks specify exact source files to read, exact sections to fill, and concrete verify commands.
- **Naming consistency:** `mv_available_stays`, `buildDateSiteMap`, `findStaleWindows`, `FindCampsitesClient`, `AvailabilityProvider` used consistently across tasks.
