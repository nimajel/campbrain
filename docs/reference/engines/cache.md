# CampBrain — Cache Engine

**Status:** shipped

The cache engine is the read/write layer between the Postgres database and the rest of the system. All queries against `scan_windows`, `availability`, `campgrounds`, `sites`, and `mv_available_stays` go through this layer. No other file should hand-write SQL against those tables.

---

## Purpose

Serve every availability query — including arbitrary night-count queries — from the stored per-site per-day grid without additional provider fetches. The grid is populated by the [scanner engine](scanner.md) and queried by API routes via `web/lib/availability-cache.ts` (a re-export shim).

---

## Responsibilities

- Upsert full availability windows (`upsertEntry`) inside a single transaction.
- Detect stale windows for re-scan (`findStaleWindows` + TTL logic).
- Evict past-date windows and availability rows (`evictExpired`).
- Serve bulk window reads (`listAllEntries`, `listFreshEntries`, `getEntriesForPark`).
- Serve map pin-lighting queries with typed-column predicates (`getParkAvailabilityCounts`).
- Serve the `/explore` date-range search with full night-count filtering (`searchAvailableStays`).
- Serve the `/explore` pre-computed stay list from the materialized view (`listAvailableStays`).
- Manage `mv_available_stays` refresh and rebuild.
- Provide a "next available date" fallback for empty results (`findNextAvailableDates`).

---

## Key files

| Path | Role |
|---|---|
| `src/cache/availability-cache.ts` | All read/write query functions; TTL logic; `buildAvailabilityClauses` (typed columns, access/kinds/hide/minNights) |
| `src/cache/db.ts` | `initDb()` (schema DDL), `rebuildMaterializedView()`, `getSql()` connection singleton |
| `src/cache/types.ts` | Shared TypeScript types (`AvailabilityWindowEntry`, `AvailableStay`, `WINDOW_DAYS`) |
| `web/lib/availability-cache.ts` | Thin re-export shim — the only import point for Next.js API routes |
| `web/lib/availability-query.ts` | Client-safe availability query utilities (if present) |

---

## Algorithms & invariants

### `buildEntriesFromRows`

Rebuilds `AvailabilityWindowEntry[]` from flat Postgres JOIN rows (private helper called by `queryEntries`). Uses three `Map` objects keyed by composite strings (`windowKey`, `cgKey`, `siteKey`) to deduplicate rows and assemble the nested tree: window → campground → site → `dates` record.

```
windowKey = "parkPageId::windowStart"
cgKey     = "parkPageId::windowStart::campgroundName"
siteKey   = "parkPageId::windowStart::campgroundName::siteName"
```

The full `AvailabilityWindowEntry` shape is documented in [data-model.md](../data-model.md#shared-typescript-types).

### Overlapping window dedupe — `buildDateSiteMap`

Defined in `web/app/api/map/availability/route.ts`. Called by the map availability route to flatten entries from multiple overlapping windows into a single `Map<date → Map<campground → {sites[]}>>`. Dedupe is implemented with a `sites.includes(site.name)` check before pushing — the same site name from two different windows is counted only once.

**Failure to dedupe inflates site counts and booking-link counts.** Any code that flattens windows per date must use the same deduplication pattern. See [data-model.md](../data-model.md#window-overlap-and-dedupe).

### `buildAvailabilityClauses` — typed-column predicate builder

`FILTER_SQL` (hardcoded name regexes) and `WALK_UP_SQL` are **deleted**. All filtering now operates on the typed columns on `sites` that were persisted at upsert time by `src/catalog/site-classifier.ts`. `buildAvailabilityClauses(opts)` accepts:

| Option | Type | Effect |
|---|---|---|
| `access` | `('drive_in'\|'hike_in'\|'boat_in')[]` | `s.access = ANY(...)` — empty = all |
| `kinds` | `('tent'\|'hookup'\|'cabin')[]` | `s.site_kind = ANY(...)` — empty = all; selecting a kind excludes NULL-kind sites |
| `hide` | `('group'\|'equestrian'\|'walk_up')[]` | `NOT s.is_group` / `NOT s.is_equestrian` / sets `excludeWalkUp` flag |
| `minNights` | `1\|2\|3` | Gaps-and-islands consecutive-night check via `siteMatchesMinStay` helper |
| `weekendsOnly` | `boolean` | `EXTRACT(DOW FROM a.date)::int IN (5, 6)` |
| `from`/`to` | `string\|null` | Parameterized date bounds |

`is_day_use = false` is always included. Enum values are validated against a closed allowlist before inlining.

### Walk-up / day-use invariants

Walk-up (`is_walk_up = true`) and day-use (`is_day_use = true`) are **typed columns** on `sites`, set at upsert time by the classifier. Walk-up sites:
- Are **never** in `available_sites` in `mv_available_stays`.
- Do not light pins on `/map`.
- Are not counted in bookable site counts.
- Are returned in `walk_up_sites` for badge display only.

Day-use sites are excluded from `mv_available_stays` and from every availability query.

### Materialized view — `mv_available_stays`

Precomputes 1-night and 2-night available stays so `/explore` queries hit a pre-aggregated view rather than re-deriving stays at query time. The full DDL is in `src/cache/db.ts` (`MV_DEFINITION`). See [data-model.md](../data-model.md#materialized-view----mv_available_stays) for the full spec.

Refresh functions:

| Function | When to use |
|---|---|
| `refreshMaterializedView()` | After every scanner cycle; after a manual `npm run cache:refresh` |
| `rebuildMaterializedView()` | After any MV schema change (adds/removes columns); follow with `refreshMaterializedView()` |
| `npm run db:rebuild-mv` | CLI alias for rebuild + refresh |

`refreshMaterializedView()` uses `REFRESH MATERIALIZED VIEW CONCURRENTLY` when the MV is populated (preserves read availability during refresh). Falls back to plain refresh on an empty MV.

### TTL tiers

Defined as `TTL_MINUTES` constants in `src/cache/availability-cache.ts` and used by `ttlMinutes(windowStart)`:

| Days until `window_start` | TTL | Constant |
|---|---|---|
| < 7 | 30 min | `imminent` |
| 7–29 | 2 hours | `near` |
| 30–89 | 4 hours | `far` |
| ≥ 90 | 8 hours | `veryFar` |

---

## Reproduction checklist

1. Schema setup: `npm run db:init` — idempotent, safe to re-run (adds new site-type columns via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
2. Classify existing sites after a schema migration: `npm run db:backfill-types` — classifies every existing `sites` row by name.
3. After any MV schema change: `npm run db:rebuild-mv` (drops and recreates the view; no data loss on the base tables).
4. To force a full cache repopulation: `npm run worker` (or `npm run scan` for a one-off). After first worker run, Rec.gov rows get `campsite_type`-based classification.
5. To manually refresh the MV without a scan: `npm run cache:refresh`.
6. To confirm the walk-up invariant: search for a park with "Hike/Bike" sites on `/explore` — they must appear with a walk-up badge, not in the bookable site count.

---

## Dependencies

- [../data-model.md](../data-model.md) — schema this layer owns; shared TypeScript types
- [scanner.md](scanner.md) — the writer; scanner calls `upsertEntry` and `evictExpired`
- Consumed by surfaces via [../api.md](../api.md) — API routes import from `web/lib/availability-cache.ts`
