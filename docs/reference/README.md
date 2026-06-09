# CampBrain Reference Documentation

## Precedence rule

**`docs/reference/` is the single source of current truth** for what is built and how each
surface and engine works. On any conflict about *what exists today*, this folder wins.

- **`CLAUDE.md`** owns cross-cutting conventions, guardrails, the Next Steps roadmap, and
  the top-level project index. On surface/engine detail it defers to this folder; on
  conventions and guardrails it is authoritative.
- **[AGENTS.md](../../AGENTS.md)** is authoritative for the build team only (agent roster,
  models, owned paths).
- **`docs/archive/`** is historical — goal/intent docs written before the reference set
  existed. They record what was once planned, not what exists now. Never treat as current
  truth.

---

## Map of the set

| File | Purpose |
|---|---|
| [00-overview.md](00-overview.md) | Two-tier system shape, end-to-end data flow, glossary, guardrails |
| [data-model.md](data-model.md) | Postgres schema (all tables), materialized view, shared TypeScript types |
| [api.md](api.md) | API route contracts: method, params, response shape, backing query, consumers |
| [design-system.md](design-system.md) | CSS tokens, shared components (SiteFilterPanel, ParkMapPopover, badges), layout patterns |
| [deployment.md](deployment.md) | Runtime topology: current local setup + path to hosted |
| [surfaces/dashboard.md](surfaces/dashboard.md) | `/` — home page: alerts list + latest scan summary |
| [surfaces/explore.md](surfaces/explore.md) | `/explore` "Find Campsites" — multi-park availability search with filters |
| [surfaces/map.md](surfaces/map.md) | `/map` — interactive Leaflet park map with distance + availability filtering |
| [surfaces/inventory.md](surfaces/inventory.md) | One-line entry for the eight other live pages (alerts, scan-history, calendar, settings, catalog, scan, targets, windows) |
| [engines/scanner.md](engines/scanner.md) | Proactive availability scanner: scheduling, window generation, staleness, write path |
| [engines/cache.md](engines/cache.md) | Postgres cache + materialized-view logic: read/write queries, dedupe, FILTER_SQL |
| [engines/providers.md](engines/providers.md) | CA Parks + Recreation.gov adapters: interface contract, parsing rules, rate limits |
| [engines/reservation-windows.md](engines/reservation-windows.md) | 6-month booking-window + 8 AM release-time rules |

---

## Recommended rebuild order

Build shared references first — they are linked by everything downstream:

1. `00-overview.md` — orientation: architecture, data flow, glossary
2. `data-model.md` — schema source; engines and surfaces link here
3. `api.md` — route contracts; surfaces reference these
4. `design-system.md` — tokens and components; Presentation sections link here
5. `deployment.md` — runtime topology
6. Surfaces: `dashboard.md` → `explore.md` → `map.md` → `inventory.md`
7. Engines: `scanner.md` → `cache.md` → `providers.md` → `reservation-windows.md`

---

## Build team

The agent roster (names, models, mandates, owned paths) lives in
[AGENTS.md](../../AGENTS.md). Do not duplicate it here.

---

## Evolving this doc set

Four procedures for the planned changes. Use them as repeatable operations, not ad-hoc edits.

### Add a surface

1. Copy the surface template (see spec: `docs/superpowers/specs/2026-06-09-documentation-revamp-design.md`).
2. Fill **Behavior / Contract** (route, API calls, filters, invariants), then **Presentation** (link to `design-system.md` for tokens/components).
3. Fill the **Reproduction checklist** — ordered, imperative, references shared docs by name.
4. Add a row to the map table above and link inbound from any engine docs whose **Dependencies** section covers this surface.

### Remove or rename a surface

1. Delete (or `git mv`) the surface file.
2. Remove all inbound links: the row in this README, any other docs' **Dependencies** sections.
3. If it represents shipped work being retired rather than abandoned, drop a `> Future:` or historical note in the relevant engine doc, and optionally move the surface file to `docs/archive/` with the ARCHIVED banner.
4. Surfaces are self-contained — removing one file does not cascade.

### Restyle / polish the aesthetic

1. Edit `design-system.md` (tokens, shared components, layout patterns).
2. Edit the **Presentation** sections of affected surface docs to match.
3. Do not touch **Behavior / Contract** or **Reproduction checklist** sections — a re-skin must not risk functional regressions in the docs.

### Go hosted

1. Promote the `> Future:` content in `deployment.md` to a **Current** subsection once the hosted topology ships.
2. Flip `deployment.md`'s `**Status:**` from `partial` to `shipped`.
3. Update any engine docs (scanner, cache) whose **Reproduction checklist** references local `npm run` commands to document the equivalent hosted/scheduled job.
