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
- Serve map pin-lighting queries with server-side filter patterns (`getParksWithAvailability`).
- Serve the `/explore` date-range search with full night-count filtering (`searchAvailableStays`).
- Serve the `/explore` pre-computed stay list from the materialized view (`listAvailableStays`).
- Manage `mv_available_stays` refresh and rebuild.
- Provide a "next available date" fallback for empty results (`findNextAvailableDates`).

---

## Key files

| Path | Role |
|---|---|
| `src/cache/availability-cache.ts` | All read/write query functions; TTL logic; `FILTER_SQL` patterns |
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

### `FILTER_SQL` — server-side filter patterns

Applied by `getParksWithAvailability()` (map pin-lighting) and `searchAvailableStays()` (explore search). Patterns are hardcoded constants (never user input) translated from the JavaScript regexes in `web/lib/site-filters.ts`:

| Filter ID | SQL POSIX pattern | Effect |
|---|---|---|
| `exclude_group` | `\ygroup\y` | Excludes group sites/campgrounds |
| `exclude_day_use` | `\y(day.use\|dailyuse\|picnic)\y` | Excludes day-use areas |
| `hike_in_only` | `\y(hike.in\|walk.in)\y` | Includes only hike-in/walk-in sites |
| `exclude_equestrian` | `\y(equestrian\|horse)\y` | Excludes equestrian sites |
| `exclude_boat_in` | `\yboat[ -]?(in\|to\|access)\y` | Excludes boat-in sites |

`exclude_walk_up` is **not** in `FILTER_SQL`. Walk-up exclusion from bookable counts is handled by a hardcoded `NOT (s.site_name ~* 'hike *[/&]? *bike')` clause that always fires. Walk-up sites are surfaced in a separate `walk_up_sites` column and returned to the caller for badge display.

### Walk-up invariant

A site is walk-up if `site_name ~* 'hike\s*[/&]?\s*bike'` (Postgres) / `/\bhike\s*[/&]?\s*bike\b/i` (JS). Walk-up sites:
- Are **never** in `available_sites` in `mv_available_stays`.
- Do not light pins on `/map`.
- Are not counted in bookable site counts.
- Are returned in `walk_up_sites` for badge display only.

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

1. Schema setup: `npm run db:init` — idempotent, safe to re-run.
2. After any MV schema change: `npm run db:rebuild-mv` (drops and recreates the view; no data loss on the base tables).
3. Verify `FILTER_SQL` patterns are consistent with `web/lib/site-filters.ts` — both must define the same filter IDs.
4. To force a full cache repopulation: `npm run worker` (or `npm run scan` for a one-off).
5. To manually refresh the MV without a scan: `npm run cache:refresh`.
6. To confirm the walk-up invariant: search for a park with "Hike/Bike" sites on `/explore` — they must appear with a walk-up badge, not in the bookable site count.

---

## Dependencies

- [../data-model.md](../data-model.md) — schema this layer owns; shared TypeScript types
- [scanner.md](scanner.md) — the writer; scanner calls `upsertEntry` and `evictExpired`
- Consumed by surfaces via [../api.md](../api.md) — API routes import from `web/lib/availability-cache.ts`
