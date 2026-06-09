# Documentation Revamp — Design

**Date:** 2026-06-09
**Status:** Approved (design phase)
**Audience target:** Future AI rebuilders (agents reproducing CampBrain faithfully from scratch)

## Problem

CampBrain's documentation has accreted into three uncoordinated piles:

- `CLAUDE.md` — comprehensive but monolithic project truth.
- `AGENTS.md` — the subagent roster (good, current).
- `docs/*.md` — 12 historical "goal" docs, one per shipped feature, written as
  forward-looking objectives rather than as a description of what exists today.

There is no single, modular, current description of **what was built, what each page is,
and how to rebuild it**. The goal docs describe intent at a point in time; they drift from
the shipped reality and are not organized for reproduction.

## Goals

1. **AI-reproducible** — a future agent can rebuild CampBrain faithfully from this doc set.
   Every doc carries an ordered *Reproduction checklist*, separate from descriptive prose.
2. **Modular by surface** — one doc per user-facing surface (`/available`, `/map`) and one
   per backend engine (scanner, cache, providers, reservation windows). Revamping a page
   means editing one file.
3. **Aesthetic separable from behavior** — each surface doc splits a *Behavior/Contract*
   section from a *Presentation* section, and a shared `design-system.md` holds cross-page
   tokens/components the Presentation sections reference. Restyle without touching behavior.
4. **Single source per fact** — schema, API contracts, and design tokens live in one
   reference file each; surfaces link to them rather than duplicating, minimizing drift.
5. **Built for expansion** — the structure anticipates three planned evolutions without
   needing a rewrite: (a) moving from local-only to **hosted/deployed**, (b) **pruning or
   renaming surfaces** for a cleaner set, and (c) **re-skinning** for a more polished
   aesthetic. Each has a designated home (see Deployment doc, Status markers, and the
   "Evolving this doc set" procedures below) so future changes are localized edits.

## Non-goals

- Human/portfolio narrative docs, screenshots, marketing framing. (Audience is AI rebuilders.)
- Rewriting `CLAUDE.md` or `AGENTS.md` from scratch. They stay; they gain pointers.
- Documenting unbuilt/planned features as if shipped. The set describes current reality;
  planned work stays in `CLAUDE.md`'s Next Steps.

## Reality check (discovered during planning)

CLAUDE.md is stale on surfaces. It documents a flagship `/available` page that **does not
exist**; the availability-search page is actually `/explore` ("Find Campsites",
`web/app/explore/FindCampsitesClient.tsx`). The live app has 11 page routes, not 2. Per
user decision, the doc set gives **full surface docs to the three confirmed keepers**
(`/` dashboard, `/explore`, `/map`) and a one-line **inventory** entry to the other eight
(`/alerts`, `/scan-history`, `/calendar`, `/settings`, `/catalog`, `/scan`, `/targets`,
`/windows`), each flagged *possibly-legacy / under review* since the user plans to prune.
The CLAUDE.md `/available` naming is corrected as part of the Documentation-Map migration.

## File structure

```
docs/
  reference/
    README.md                 entry point: map of the set + canonical rebuild order
    00-overview.md            two-tier system, data flow, glossary, guardrails
    data-model.md             Postgres schema, materialized view, shared types
    api.md                    API route contracts (request/response per route)
    design-system.md          shared aesthetic: tokens, components, layout patterns
    deployment.md             runtime topology: Current (local) + Path to hosted
    surfaces/
      dashboard.md            / (home) — alerts + latest-scan summary
      explore.md              /explore "Find Campsites" — availability search
      map.md                  /map — interactive park map
      inventory.md            one-line entry per other live page (alerts,
                              scan-history, calendar, settings, catalog, scan,
                              targets, windows), each flagged possibly-legacy
    engines/
      scanner.md              proactive availability scanner
      cache.md                Postgres cache + materialized view logic
      providers.md            CA Parks + Recreation.gov adapters
      reservation-windows.md  6-month / 8 AM booking-window rules
  archive/
    *-goal.md                 the 12 historical goal docs, moved here untouched

AGENTS.md   stays in place; reference/README.md links to it (not moved/duplicated)
CLAUDE.md   stays as top-level index; gains a "Documentation Map" section pointing
            into docs/reference/
```

## Documentation precedence & provenance (anti-confusion rule)

A future agent must never mistake old docs for current truth. Canonicality is declared
explicitly, not left to inference:

- **`docs/reference/` is the single source of current truth** for what is built and how
  each surface/engine works. On any conflict about *what exists today*, `reference/` wins.
- **`CLAUDE.md`** remains the top-level index and owns cross-cutting concerns —
  conventions, guardrails, and the **Next Steps** roadmap. On surface/engine detail it
  defers to `reference/`; on conventions/guardrails it is authoritative. Its new
  "Documentation Map" section states this precedence in one line.
- **`AGENTS.md`** is authoritative for the build team only.
- **`docs/archive/` is historical and superseded — never current truth.** This is enforced
  three ways:
  1. A new `docs/archive/README.md` stating: *"These are historical goal/intent docs,
     superseded by `docs/reference/`. They record what was once planned, not what exists.
     Do not treat as current."*
  2. A one-line banner prepended to **every** archived file:
     `> ARCHIVED — historical intent, superseded by docs/reference/. Not current truth.`
  3. Nothing in `reference/`, `CLAUDE.md`, or `AGENTS.md` links to `archive/` as a source;
     archived files are reachable only as history.
- **Per-doc Status** (`shipped | partial | planned`) disambiguates current vs. future
  *within* a canonical doc; the precedence rule above disambiguates *across* doc sets.

`reference/README.md` opens by restating this precedence so it is the first thing a
rebuilding agent reads.

## Status markers and expansion notes (convention)

Every doc in `reference/` opens with a one-line status so current reality and planned work
are never confused:

```
**Status:** shipped | partial | planned
```

Forward-looking content (e.g. local→hosted migration notes, a surface slated for removal)
lives inline under a fenced callout so it is visually distinct from shipped truth and never
read as a current-state claim:

```
> Future: <expansion note — what would change and why; not yet built>
```

This is the designated home for expansion hooks. It keeps the "describes current reality"
rule intact while giving each doc a place to record where it is headed.

## Templates (the reusable contract)

Every surface and engine doc follows a fixed template so the set is uniform and any single
file is understandable in isolation. Each doc opens with the `**Status:**` line above.

### Surface doc template (`surfaces/*.md`)

1. **Purpose** — one line.
2. **Behavior / Contract**
   - URL + query/route params
   - Data sources (link to specific routes in `api.md`)
   - Core logic — filters, dedupe-across-windows, pagination, night-count, weekend tiers
   - Output states — empty / loading / walk-up badges / error
   - Invariants — e.g. walk-up sites never counted as bookable
3. **Presentation**
   - Layout structure
   - Components used (link to `design-system.md`)
   - Interaction & performance notes (e.g. <200ms filter target, collapsed-by-default cards)
4. **Reproduction checklist** — ordered steps an AI follows to rebuild this surface.
5. **Dependencies** — engines, API routes, and `data-model.md` entities it relies on.

### Engine doc template (`engines/*.md`)

1. **Purpose** — one line.
2. **Responsibilities** — what it owns; what it explicitly does not.
3. **Key files** — paths in `src/` (and `web/app/api/` where relevant).
4. **Algorithms & invariants** — TTL tiers, window dedupe, walk-up regex rule, MV refresh.
5. **Reproduction checklist** — ordered rebuild steps.
6. **Dependencies** — other engines, `data-model.md`, providers.

### Shared reference docs

- **`00-overview.md`** — the orientation doc an AI reads first: the two-tier
  scanner+web architecture, end-to-end data flow (provider → scanner → Postgres → MV →
  API → surface), a glossary (window, stay, walk-up, page_id), and the project guardrails
  (not a booking bot; polling limits).
- **`data-model.md`** — the one schema source: every table (`providers`, `parks`,
  `campgrounds`, `sites`, `scan_windows`, `availability`), the `mv_available_stays`
  materialized view with its two array columns, and the shared TS types
  (`AvailabilityWindowEntry`, `AvailableStay`, etc.). Surfaces/engines link here.
- **`api.md`** — contract per route: `GET/POST /api/available`, `/api/map/catalog`,
  `/api/map/availability`, `/api/map/availability/summary`. Method, params, response shape,
  which engine/cache query backs it.
- **`design-system.md`** — Tailwind token conventions, shared components
  (`SiteFilterPanel`, `ParkMapPopover`, `ProviderBadge`, badges, park cards), and layout
  patterns. The single file to edit for a restyle.
- **`deployment.md`** — the runtime topology, structured in two parts:
  - **Current (local)** — docker-compose Postgres (`postgres:16`), `npm run dev` (Next.js
    on :3001), `npm run worker` (scanner), config via root `.env` + `DATABASE_URL` bridged
    by `web/next.config.ts`. This is shipped truth.
  - **Path to hosted** (`> Future:` callout) — what changes to deploy: a managed Postgres
    instance, hosting the Next.js app, running the worker as a scheduled/background job
    (not a long-lived local process), and secrets handling. Marked `planned`; describes the
    migration shape without asserting it exists.
- **`reference/README.md`** — the map: what each file is, the recommended reading/rebuild
  order, a link out to `AGENTS.md` for the build team, and the "Evolving this doc set"
  procedures (below).

## Cross-linking rules

- Surfaces never inline schema or route shapes — they link to `data-model.md` / `api.md`.
- Presentation sections never define tokens/components inline — they link to
  `design-system.md`.
- Every doc ends with a **Dependencies** section naming the files it relies on, so the
  dependency graph is reconstructable from the docs alone.
- `CLAUDE.md` and `AGENTS.md` are linked from `reference/README.md`; `CLAUDE.md` links back
  into `reference/` via a new "Documentation Map" section. No content is duplicated across
  the boundary.

## Evolving this doc set (lives in `reference/README.md`)

Documented procedures for the planned changes, so they are clean repeatable operations
rather than ad-hoc edits:

- **Add a surface** — copy the surface template; fill Behavior, then Presentation
  (referencing `design-system.md`); add the Reproduction checklist; link inbound from
  `reference/README.md` and the relevant engine docs' Dependencies.
- **Remove or rename a surface** — delete (or rename) the surface file; remove all inbound
  links (README, other docs' Dependencies); if it represents shipped work being retired,
  drop a `> Future:`/historical note and, if useful, move the file to `docs/archive/`.
  Removing one file does not cascade because surfaces are self-contained.
- **Restyle / polish the aesthetic** — edit `design-system.md` (tokens/components) plus the
  **Presentation** sections of affected surfaces. Behavior sections and Reproduction
  checklists stay untouched, so a re-skin never risks functional regressions in the docs.
- **Go hosted** — promote the `> Future:` content in `deployment.md` to a `Current`
  subsection once shipped; flip its `**Status:**` from `partial`/`planned` accordingly.

## Migration of existing docs

- Create `docs/archive/` and move all 12 `docs/*-goal.md` files there. Prepend the one-line
  ARCHIVED banner to each (see precedence rule), and add `docs/archive/README.md` declaring
  the whole folder superseded by `docs/reference/`. Nothing links to them as current truth.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` are unaffected.
- `CLAUDE.md` gains a "Documentation Map" section near the top pointing at
  `docs/reference/README.md`. Its existing deep content (cache architecture, web perf,
  conventions) stays — `reference/` docs may link *into* CLAUDE.md sections rather than
  copy them, to be decided per-doc during authoring to avoid duplication.

## Reproduction-checklist convention

The element that makes the set rebuildable. In each surface/engine doc it is an ordered,
imperative list a future agent executes top-to-bottom — e.g. for `/explore`:

```
1. Add a Next.js route at web/app/explore/page.tsx (server component).
2. Create FindCampsitesClient (client component) holding filter state.
3. Wire the search API (see api.md) to read mv_available_stays (see data-model.md).
4. Implement the flat lookup: parkId → campground → site → date → status.
5. Apply site filters client-side (see SiteFilterPanel in design-system.md).
6. Implement early-exit pagination (10 date groups, "Show more").
7. Exclude walk-up sites from counts; render the walk-up badge.
8. Verify: filters respond <200ms, no hydration warnings.
```

Checklists reference the shared docs by name so steps stay short and non-duplicative.

## Authoring order (how this spec gets executed)

Build shared references first (they are linked by everything), then surfaces, then engines,
then wiring docs, then migration:

1. `00-overview.md`, `data-model.md`, `api.md`, `design-system.md`, `deployment.md`
2. `surfaces/dashboard.md`, `surfaces/explore.md`, `surfaces/map.md`,
   `surfaces/inventory.md`
3. `engines/scanner.md`, `engines/cache.md`, `engines/providers.md`,
   `engines/reservation-windows.md`
4. `reference/README.md` (the map, written once targets exist)
5. Migrate goal docs → `docs/archive/`; add CLAUDE.md "Documentation Map" section
6. Verify every cross-link resolves; verify each doc matches shipped code.

## Verification

- Every internal link resolves to an existing file/section.
- Each surface/engine doc conforms to its template (all sections present).
- Each Reproduction checklist is ordered and self-contained (references shared docs by name).
- Spot-check 2–3 checklists against the actual shipped code for fidelity.
- No current-truth claim contradicts `CLAUDE.md`.
- Every archived file carries the ARCHIVED banner; `docs/archive/README.md` exists; no
  canonical doc links to `archive/` as a source.
- `reference/README.md` and `CLAUDE.md`'s "Documentation Map" both state the precedence
  order, consistently.

## Open questions

None blocking. Per-doc decisions on "link into CLAUDE.md vs. restate briefly" are made
during authoring, governed by the single-source-per-fact rule.
