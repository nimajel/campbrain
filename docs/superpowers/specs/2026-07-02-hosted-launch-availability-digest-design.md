# CampBrain Hosted Launch — Precomputed Park Availability Digest Design

**Status:** drafted 2026-07-02 — **REVIEW before implementation.** No manual/external
provisioning is required (no OAuth client, no third-party account); the only gate is one
Neon migration. Hand to the Planner.
**Branch:** `hosted-launch`. Fixes a **live production outage**, not a new feature.

## Problem (diagnosed + measured today)

The live Worker's tRPC `map.availability` endpoint (`apps/api/src/trpc/routers/map.ts`)
returns Cloudflare **error 1102** — the Workers **free-plan 10 ms CPU cap** — for
site-heavy parks. Measured against the live Worker
(`https://campbrain-api.jelvehn.workers.dev`):

| Park | Sites | Response | Result |
|---|---|---|---|
| 585 | 1 | 59 KB | 6/6 OK |
| 469 | 56 | 177 KB | 4/6 **failed** |
| 651 (Lake Perris) | 426 | — | 6/6 **failed** — permanently broken |

The endpoint calls `getEntriesForParks` (flat join rows) → `buildParkAvailability`
(`packages/core/src/availability/map-transforms.ts`). The CPU cost is **not**
serialization; it is the per-request compute in `buildParkAvailability`:

1. `makeTaxonomyPredicate` runs `classifySite` (9 regexes) **per site per window** —
   overlapping scan windows multiply this.
2. `buildDateSiteMap` pivots park→cg→site→dates into date→cg→sites[] and **dedupes site
   names across overlapping windows** (Set per (date, cg)).
3. `weekendFridaysFromAvailableDates` + the weekend loop calls
   `sitesAvailableForDates` (per-date Set intersection) for 3-night / 2-night-Fri /
   2-night-Sat / 1-night-Fri / 1-night-Sat tiers, **per campground per Friday** (~24
   weekends). This is the dominant term and it scales with sites × weekends × cgs.

Data only changes when a scan runs (GitHub Actions, every 6 h). Recomputing this whole
digest on **every read** is waste regardless of the CPU cap.

## Owner's locked decision

Stay on the Workers **free plan**. **Precompute the digest in the GitHub-Actions scanner**
(`apps/scanner`, Node — no CPU cap) after the proactive scan, store it in Neon, and have
the Worker serve a **cheap read + cheap in-Worker filter**. Mirror the 2b-1/2b-3 scanner
phase pattern (`run-proactive-scan.ts`, `run-calendar-sync.ts` composed in `main.ts`).

---

## Resolved decisions

### D-A — Storage: one JSONB row per park in a new Neon table `park_digests`
One row per `(provider, park_page_id)` holding the **unfiltered** digest as JSONB, plus a
plain `as_of timestamptz` column and `built_at timestamptz`. Rejected alternatives:

- **One MV / precomputed-per-filter-combo:** the filter space is
  `access(≤3) × kinds(≤3) × hide(≤3)` power-set combinations = thousands of digests per
  park. Combinatorial, rejected (D-B handles filters in-Worker instead).
- **Cloudflare KV / R2:** adds a second datastore + a second binding to reason about; the
  scanner already has a Neon handle and the Worker already opens a Neon WebSocket per
  request via `withDbAuth`. One `SELECT … WHERE park_page_id = $1` on a PK is a single
  cheap round-trip — no new dependency, no new binding. Keep it in Neon.
- **Store on `parks`:** pollutes the identity table with a churning ~200 KB blob and its
  own `as_of`; a dedicated table keeps writes/reads isolated and lets us drop/rebuild the
  digest independently. Dedicated table.

**Row size:** Lake Perris (426 sites) is the worst case; the current uncompressed JSON
response is the size bound (177 KB for 56 sites → Lake Perris will be several hundred KB).
Neon/Postgres JSONB TOAST-compresses large values transparently; a single-row read by PK
is well within one WebSocket round-trip and nowhere near a CPU concern (the Worker does
`JSON`-shaped structural work only in D-B, bounded and measured). This is acceptable; note
it and revisit only if a park exceeds ~1 MB (none do today).

### D-B — Taxonomy filters: precompute UNFILTERED digest carrying per-site classification; Worker filters cheaply
The endpoint input still accepts `access[] / kinds[] / hide[]` (`MapAvailabilityInputSchema`).
Today those flow into `makeTaxonomyPredicate` → `classifySite` (regexes) **inside**
`buildParkAvailability`, so filtering and tier-computation are entangled. We split them:

- **Scanner (once per scan):** build the digest **with no taxonomy filter applied** (all
  non-day-use sites; day-use always excluded, per guardrail), i.e. call
  `buildParkAvailability` with empty `access/kinds/hide`. Additionally emit a
  **per-site classification map** for the park:
  `siteClass: Record<siteName, { access, siteKind, isGroup, isEquestrian, isWalkUp }>`
  (day-use omitted entirely — those sites never appear in the digest). `classifySite`
  runs **once per distinct site name in the scanner**, never in the Worker.
- **Worker (per request):** load the row, then **filter the digest arrays in-process** by
  looking each site name up in `siteClass` and applying the same predicate logic that
  `makeTaxonomyPredicate` applies today — but as **cheap map lookups + boolean checks over
  string arrays, with zero regex and zero date-intersection**. The work is bounded by the
  total site-name appearances already in the digest (a filter pass over pre-derived
  arrays), which is O(entries) not O(sites × weekends × cgs). Day-use is already excluded
  at build time; walk-up stays in the separate `walkUpSites` arrays untouched.

This is the crux: the **expensive** part (window dedupe, weekend-tier date intersections,
regex classification) moves to the scanner; the Worker does only a linear filter over
already-computed arrays. A campground/date entry that filters down to zero bookable +
zero walk-up sites is dropped (same rule as `buildParkAvailability`); a weekend campground
with no surviving tiers is dropped. When **no filters** are active (the default map view —
the common case and the one that fails hardest today, Lake Perris) the Worker returns the
stored digest essentially as-is (no per-array filtering needed → fastest path).

> **Filter parity is the correctness risk.** The in-Worker filter MUST reproduce
> `makeTaxonomyPredicate` semantics exactly: empty `access` = all; empty `kinds` = all
> **including NULL-kind sites**; selecting a kind **excludes NULL-kind sites**; `hide`
> removes group/equestrian/walk_up. Extract this into ONE pure function
> (`filterDigest(digest, siteClass, filters)`) in `packages/core`, unit-tested against the
> same fixtures as `buildParkAvailability`, and used by both the Worker and (for the
> fallback, D-E) as the single filtering code path. **Do not reimplement the predicate in
> two places.**

**Rejected — server-side SQL filter on the JSONB:** filtering JSONB arrays inside Postgres
(jsonb_array_elements + re-aggregation) is more code, less testable, harder to keep in
lockstep with `classifySite`, and pushes work to Neon per request for no benefit. The
in-Worker pure-function filter is trivially unit-testable and shares logic with the
existing transforms. Reject.

### D-C — Other CPU-cap exposure: `map.availability.summary` = SAFE; `search` = SAFE; note only
Probed both paths:

- **`map.summary` (pin-lighting)** → `getParkAvailabilityCounts`
  (`packages/db/src/queries/summary.ts`). Filters push down to **Postgres SQL**
  (`buildAvailabilityClauses`); the Worker returns `{ parks }` with per-park counts. The
  only in-Worker compute is the **min-stay path** (`firstMatchingArrival` per site) — but
  that runs over count rows, not full grids, and this endpoint has **not** shown 1102.
  **Not in scope.** If min-stay ever trips the cap on a huge result set, precompute the
  three min-night summaries alongside the digest — flagged, not built.
- **`search` (Phase 2a)** → `searchAvailableStays` (`packages/db/src/queries/search.ts`).
  Also **SQL-pushed** (a single `GROUP BY … HAVING COUNT(DISTINCT date) = nights`); the
  Worker only reshapes flat rows into park→cg groups + a region classify per park. No
  per-site regex, no weekend-tier intersection. **Not exposed, not in scope.**

**Only `map.availability` recomputes a full per-site per-day digest in-Worker**, so it is
the sole target. No scope creep.

### D-D — Digest write phase in the scanner: own phase, own `scan_runs` kind, best-effort
Add a `runDigestBuild` phase to `apps/scanner/src/main.ts`, composed **after** the
proactive scan's MV refresh and **before** the alert scan (the digest reflects the scan
that just landed; the alert scan is independent and reads raw rows, not the digest):

```
proactive scan → evictExpired → refreshMaterializedView   (existing)
runDigestBuild(db)                                          (NEW)
runAlertScan(...)                                           (existing)
runCalendarSync(...)                                        (existing)
```

- **Failure isolation:** its own `scan_runs` row with a **new kind `'digest'`** (extend
  `ScanRunKind` in `packages/types/src/alerts.ts` → `proactive | alert | digest |
  calendar`). Wrap in try/catch like `runCalendarSync` so a digest-build failure logs +
  records `status='error'` but **does not kill the job** (a stale digest is still served;
  see D-E). Column reuse: `parksScanned` = parks digested, `errors` = per-park failures.
- **Per-park failure isolation inside the phase:** build each park's digest in its own
  try/catch; one park's parse/serialize error must not abort the rest. Upsert each park
  row independently (not one giant transaction) so a mid-run crash leaves the parks
  already built with fresh digests.
- **Placement rationale (before alert scan):** the alert scan and calendar sync are the
  more failure-prone I/O phases (email, Google API); putting the digest build right after
  the data it depends on (freshly-refreshed MV / just-upserted rows) keeps its inputs
  maximally consistent and means a later-phase failure never leaves the digest unbuilt.

### D-E — Fallback while digest is missing/stale: keep the current compute path, but guarded
On first deploy (before the next 6 h scan) and for any park with no `park_digests` row
yet, the Worker must still answer. Decision: **keep `buildParkAvailability` as a bounded
fallback**, not "return empty".

- **Worker `map.availability` logic:**
  1. `SELECT` the `park_digests` row by PK.
  2. **Row present →** filter in-Worker (D-B) and return. Fast path. This is the path that
     fixes Lake Perris.
  3. **Row absent →** fall back to the **current** `getEntriesForParks` +
     `buildParkAvailability` path **only for that park**. This preserves today's behavior
     for not-yet-digested parks and guarantees no regression on deploy.
- **Guardrail on the fallback:** the fallback is exactly what times out today for big
  parks, so it MUST NOT resurrect 1102 for Lake Perris after the digest exists. Because
  the scanner digests **every catalog park every run**, the absent-row case is transient
  (one scan cycle, ≤6 h) and, in steady state, only hits genuinely tiny/new parks. Do not
  add complexity to make the fallback CPU-safe for big parks — the digest is the fix; the
  fallback just avoids a hard failure in the ≤6 h window before first build. (If a big
  park somehow lacks a row past one scan cycle that is a scanner bug to fix, not a reason
  to harden the fallback.)
- **Rejected — return empty-with-asOf on missing row:** would show "no availability" for
  every park on first deploy until the next scan, a visible regression. Fallback-compute
  is strictly better and reuses code we already ship.

### D-F — asOf / staleness semantics
`ParkDetail.tsx` renders `Cache as of {relativeTime(data.asOf)}`. The response shape
(`ParkAvailabilityResponse`) is **unchanged** — `asOf` stays the max `scannedAt` across
the park's windows, exactly as `buildParkAvailability` computes it. The scanner computes
`asOf` at build time and stores it both **inside** the JSONB (so the served object needs
no post-processing) and in the top-level `as_of` column (for cheap staleness queries /
future admin surfacing). The `built_at` column is digest-freshness (when the scanner last
rebuilt the row) — internal/observability only, **not** surfaced in the panel (the panel's
"Cache as of" is about scan freshness, which is `asOf`, not digest-build time). No web
changes required; the panel keeps reading `data.asOf`.

---

## Architecture

```
SCANNER (GitHub Actions, every 6h — Node, no CPU cap)
  runProactiveScan → evictExpired → refreshMaterializedView        (existing)
  runDigestBuild(db):                                              (NEW phase)
     parks = getCatalogParks(db)            // every park with sites
     scan_runs row kind='digest'
     for each park (isolated try/catch):
        entries   = getEntriesForParks(db, [parkPageId], provider)
        digest    = buildParkAvailability(entries, {} , parkPageId)   // NO filters
        siteClass = buildSiteClassMap(entries, parkPageId)            // classifySite once/site
        upsertParkDigest(db, { provider, parkPageId, asOf: digest.asOf, digest, siteClass })
     finishScanRun(kind='digest', parksScanned, errors)
  runAlertScan(...) → runCalendarSync(...)                         (existing)

NEON
  park_digests: one JSONB row per park (digest + siteClass + as_of + built_at)

WORKER (Cloudflare, free plan — 10ms CPU cap)
  map.availability(input):
     row = getParkDigest(db, provider, parkPageId)          // 1 PK read
     if row:
        return filterDigest(row.digest, row.siteClass, {access,kinds,hide,from,to})
                                                             // pure, cheap, no regex
     else:
        entries = getEntriesForParks(...)                   // fallback (transient)
        return buildParkAvailability(entries, {access,kinds,hide,from,to}, parkPageId)
```

The Worker bundle gains **no new dependencies** — `filterDigest` + `buildSiteClassMap`
live in `@campbrain/core` (already imported), and `getParkDigest`/`upsertParkDigest` live
in `@campbrain/db` (already imported). The digest builder reuses the existing
`buildParkAvailability` verbatim.

### Note on `from`/`to` in the digest
`buildParkAvailability` currently applies `from`/`to` as part of the same pass. Two
options for the digest:

- **(chosen) Precompute the full-horizon digest** (no `from`/`to`), and have `filterDigest`
  apply the date-range filter in-Worker alongside the taxonomy filter. `nextAvailableDates`
  entries carry their `date`; weekend entries carry `fridayDate`/`saturdayDate` — the
  Worker can drop out-of-range entries with a string compare (`date >= rangeStart && (!to
  || date <= to)`), reproducing `rangeStart`/`isInRange` logic. Cheap, and lets one stored
  digest serve any requested sub-range (the map's WHEN presets). This keeps a single row
  per park regardless of the date window the user picks.
- (rejected) Precompute per-`from`/`to`: the map's date presets (This weekend / Next 2
  weeks / Next month / Anytime) plus custom dates make this combinatorial like the filter
  case. Reject.

`filterDigest` therefore takes the **full** `MapAvailabilityFilters` (taxonomy **and**
date range) and is the single Worker-side reducer. `earliestAvailableDate` in the stored
digest is the unfiltered earliest; if a caller needs the earliest **after** filtering,
recompute it from the filtered `nextAvailableDates` inside `filterDigest` (cheap) so the
"Fully booked through / Next opening" copy in `ParkDetail.tsx` stays correct under filters.

---

## Data model — one new Neon table

### `park_digests`
`provider` text NOT NULL (FK → `providers.provider_id`) ·
`park_page_id` text NOT NULL ·
`as_of` timestamptz (max `scannedAt` across the park's windows; null when no windows) ·
`digest` jsonb NOT NULL (the `ParkAvailabilityResponse`, unfiltered) ·
`site_class` jsonb NOT NULL (`Record<siteName, SiteClassEntry>`; day-use omitted) ·
`built_at` timestamptz NOT NULL DEFAULT now().
**Primary key** `(provider, park_page_id)` — matches the single-row read pattern and the
provider-scoped-tables guardrail. FK on `provider` to `providers` mirrors `saved_searches`.

- One row per park; upsert `ON CONFLICT (provider, park_page_id) DO UPDATE`.
- No FK to `parks` on `(provider, park_page_id)` is required (parks is the identity table;
  a stale digest for a removed park is pruned by the same catalog set the builder iterates
  — but adding the composite FK with `ON DELETE CASCADE` is cleaner; **recommend the FK**
  to `parks(provider_id, park_page_id)` so a removed park drops its digest automatically).
- `SiteClassEntry` = `{ access: SiteAccess; siteKind: SiteKind | null; isGroup: boolean;
  isEquestrian: boolean; isWalkUp: boolean }` (no `isDayUse` — day-use sites are excluded
  from the digest, so their class is never needed).

**Migration:** author via `drizzle-kit generate` from `schema.ts` (repo uses Drizzle
migrations in `packages/db/migrations/`, config `drizzle.config.ts`). One new table, no
data backfill needed (the next scan populates it; until then the D-E fallback serves).

---

## Code organization

```
packages/db/src/schema.ts                      MODIFY  add park_digests pgTable
packages/db/migrations/0006_*.sql              CREATE  drizzle-kit generate (park_digests)
packages/db/src/queries/park-digest.ts         CREATE  getParkDigest(db,provider,pageId),
                                                        upsertParkDigest(db, rec),
                                                        (optional) pruneOrphanDigests
packages/db/src/index.ts                       MODIFY  export ./queries/park-digest
packages/types/src/alerts.ts                   MODIFY  ScanRunKind += 'digest'
packages/core/src/availability/digest.ts       CREATE  buildSiteClassMap(entries, pageId),
                                                        filterDigest(digest, siteClass, filters),
                                                        SiteClassEntry type
packages/core/src/availability/map-transforms.ts  (unchanged; reused by builder + fallback)
packages/core/src/index.ts                     MODIFY  export digest helpers + type
apps/scanner/src/run-digest-build.ts           CREATE  the runDigestBuild phase (above)
apps/scanner/src/main.ts                       MODIFY  call runDigestBuild after MV refresh,
                                                        before runAlertScan; own scan_runs row
apps/api/src/trpc/routers/map.ts               MODIFY  availability: digest read → filterDigest,
                                                        else fallback to buildParkAvailability
```

No web changes: `ParkAvailabilityResponse` shape is preserved, `use-park-availability.ts`
and `ParkDetail.tsx` are untouched.

### `filterDigest` contract (the load-bearing new pure fn)
```
filterDigest(
  digest: ParkAvailabilityResponse,          // unfiltered, from the stored row
  siteClass: Record<string, SiteClassEntry>, // per-site classification (no regex at call time)
  filters: MapAvailabilityFilters,           // access/kinds/hide + from/to
): ParkAvailabilityResponse
```
- Reproduces `makeTaxonomyPredicate` semantics via `siteClass` lookups (unknown site name
  → treat as passing only if it would pass with default drive_in class; **but** every site
  in the digest is guaranteed to be in `siteClass` because both are built from the same
  `entries` in the same scanner pass — a missing key is a build bug, fail closed = drop).
- Filters `AvailableDateCampground.sites` / `.walkUpSites` and every
  `WeekendCampground.sites{3Night,2NightFri,2NightSat,1NightFri,1NightSat}` / `.walkUpSites`.
- Recomputes `availableSiteCount` from the filtered `sites`.
- Drops date entries / weekend campgrounds / weekends that become empty (parity with
  `buildParkAvailability`'s `.filter(...)` / `continue` rules).
- Applies `from`/`to` range filtering to `nextAvailableDates` and to weekend arrivals.
- Recomputes `earliestAvailableDate` from the filtered dates.
- **walk_up hide:** when `hide` includes `walk_up`, drop `walkUpSites` (parity with the
  `excludeWalkUp` path); otherwise leave them (they are never in the bookable `sites`).

---

## Testing

- **core (unit) — `filterDigest`/`buildSiteClassMap`:** the keystone. For a representative
  fixture (multi-campground park with tent/hookup/cabin, group, equestrian, walk-up,
  hike-in, boat-in, and NULL-kind sites): assert `buildParkAvailability(entries, F)` deep-
  equals `filterDigest(buildParkAvailability(entries, {}), buildSiteClassMap(entries), F)`
  for a matrix of `F` (each access, each kind incl. NULL-kind exclusion, each hide,
  combinations, and empty). **This equivalence test is the correctness proof** that moving
  the filter out of the compute path changes nothing observable. Include a `from`/`to`
  range case and a min-2-night-implied weekend-tier case.
- **core (unit) — `buildSiteClassMap`:** every distinct site name present, day-use omitted,
  `PARK_ACCESS_OVERRIDES` respected (thread `parkPageId`, e.g. Angel Island 468).
- **db (local PG):** `upsertParkDigest` insert + conflict-update; `getParkDigest` by PK
  returns the stored `digest`/`siteClass`/`asOf`; provider-scoping; (if FK added) cascade
  on park delete.
- **scanner (unit) — `runDigestBuild`:** with a fake `getEntriesForParks`, asserts one
  upsert per park, per-park try/catch isolation (one park throwing still digests the rest,
  `errors` incremented), and a `scan_runs` row `kind='digest'` written. Mirror
  `run-calendar-sync` test style (inject deps, no network).
- **api (createCaller) — `map.availability`:** (a) digest row present → returns the
  filtered digest, and the returned object equals `filterDigest(...)`; (b) digest row
  absent → falls back to `buildParkAvailability` and still returns a valid response
  (no throw). Both with a seeded local PG.
- **types:** `ScanRunKind` accepts `'digest'`.

No new manual/live-service verification is required (unlike 2b-3's OAuth). The one manual
step is running the migration + one scan against Neon, then confirming Lake Perris (651)
loads in the live panel without 1102 (the whole point).

---

## Manual setup YOU must provide (gates deploy, not build)
1. **Run the Neon migration** (`park_digests`) against Neon with `?sslmode=require`
   (`bun --filter @campbrain/db migrate` or the project's migrate command).
2. **Trigger one scan** (GitHub Actions `Proactive Scan`, or a manual scanner run against
   Neon) so `park_digests` is populated; before that the D-E fallback serves.
3. **Deploy the Worker** (`VITE_API_URL=<origin> bun --filter @campbrain/web build` then
   `bunx wrangler deploy` from `apps/api`) — no new secrets, no new bindings.
Until (1)+(2), the Worker serves via the fallback (current behavior, still 1102-prone for
Lake Perris); after (2) the fast path fixes it. **No OAuth client, no third-party account,
no new env var.** Everything is unit-testable locally before deploy.

---

## Guardrails re-checked
- **TS strict, no `any`:** `SiteClassEntry` + `filterDigest` are fully typed; JSONB
  columns are read back through a typed row shape (like `calendar.ts`).
- **Provider-scoped table:** `park_digests` PK leads with `provider`, FK to `providers`.
- **Day-use excluded on every user-facing surface:** day-use sites are excluded at digest
  **build** time (empty-filter `buildParkAvailability` already drops them via the taxonomy
  predicate's `isDayUse` short-circuit), and omitted from `site_class`, so they can never
  re-enter via the Worker filter.
- **Walk-up preserved:** `walkUpSites` stay in their separate arrays in the stored digest;
  `filterDigest` keeps them separate and only drops them under `hide=walk_up`. Never
  counted in `availableSiteCount`.
- **Overlapping-window dedupe:** done once in the scanner by the reused `buildDateSiteMap`
  (Set per (date, cg)); the Worker never sees raw windows.
- **Worker bundle lean:** no new deps; heavy work (regex classify, weekend intersections)
  is scanner-only. neon-serverless read of one PK row is the only added Worker I/O.
- **Not a booking bot:** read-only precompute; no change to polling cadence or provider I/O.

## Deferred / out of scope
- Precomputing the three min-stay **summary** variants (only if `map.summary` ever trips
  the cap — it does not today; D-C).
- Compressing the JSONB app-side (Postgres TOAST already compresses; revisit only if a
  park exceeds ~1 MB).
- Incremental digest rebuild (only rebuild parks whose windows changed this scan) — a
  perf optimization for the scanner, not needed at 88 parks / 6 h; note for later.
- Serving the digest from Cloudflare KV/R2 as a read-cache in front of Neon (only if the
  per-request Neon read ever becomes the bottleneck; it is not the CPU problem being
  fixed).

## Self-review
- Root cause is the in-Worker recompute in `buildParkAvailability`, confirmed by the
  585/469/651 CPU-scaling evidence — the fix moves that compute to the scanner and leaves
  the Worker a linear filter. Decisions D-A..D-F all resolved.
- **Correctness keystone:** the `buildParkAvailability(entries, F)` ≡
  `filterDigest(buildParkAvailability(entries, {}), siteClass, F)` equivalence test proves
  filter-parity; a single `filterDigest` is the only place the predicate lives (no
  drift with `classifySite`).
- **No response-shape change** → zero web changes; `ParkDetail.tsx` keeps reading
  `data.asOf`. **No new Worker deps** → bundle stays neon-only.
- **Failure-safe:** own `scan_runs` kind, best-effort phase, per-park isolation, and a
  transient compute fallback so first-deploy and not-yet-built parks never hard-fail.
- Reuses the 2b-1/2b-3 scanner-phase pattern and the existing `buildParkAvailability`,
  `getEntriesForParks`, `getCatalogParks`, `scan_runs` machinery.
- Open sub-decision for the Planner: whether to add the composite `parks` FK with
  `ON DELETE CASCADE` on `park_digests` (recommended) vs. prune orphans in the build phase.
```
