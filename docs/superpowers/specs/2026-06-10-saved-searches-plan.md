# User-Defined Saved Searches — Implementation Plan

**Date:** 2026-06-10
**Status:** Implemented (all phases complete, merged to main 2026-06-10).
**Owner at plan time:** planner
**Spec:** [2026-06-10-saved-searches-design.md](2026-06-10-saved-searches-design.md) — read it fully before starting any phase. This plan does not restate decisions; it orders the spec's file-level change map into verifiable steps.

## How to use this plan

- Execute phases in order. Each phase ends with a **verification gate** that must pass before the next phase starts.
- Agent assignment per step: `src/` + API routes → **backend-developer**; `web/` UI → **frontend-developer**; Vitest coverage → **tester**.
- TDD-first where the spec defines pure logic (schema validation, `expandStayWindows`, `matchSavedSearch`, hit-key derivation, migration mapping): write the failing test from the spec's acceptance criteria, then implement. These steps are marked **[TDD]**.
- Critical-path ends at Phase 8. Legacy-path retirement (Phase 9) is explicitly **post-verification** per the spec and must NOT be started until the saved-search scanner is confirmed against migrated data.
- No `any`. Files kebab-case. Types PascalCase. Postgres columns snake_case. No park-specific constants outside seed/tests.

## CampBrain ordering notes for this feature

- The `saved_searches` table is **not** part of `mv_available_stays` — no MV rebuild is needed. `npm run db:init` is idempotent and creates the new table; that is the only schema-apply step.
- Matching **reuses** `searchAvailableStays` (the `/explore` read path); no new SQL and no MV shape change. The dedupe-across-overlapping-windows guarantee comes for free from `searchAvailableStays` / `getAvailableSitesForStay`.
- Walk-up exclusion is already enforced by `searchAvailableStays` (`available_sites` MV column never contains walk-up). The matcher must surface only `availableSites` (never `walkUpSites`) as openings — assert this in tests.
- Region resolution stays out of `src/`: `parkRegionOf` is **injected** into the matcher (web supplies a `classifyRegion`-over-catalog impl; tests supply a stub). Do not import `web/lib/regions.ts` from `src/`.

---

## Phase 0 — Schema + types + store (foundation)

Everything else depends on the table, the zod schemas, and the data-access boundary. No readers exist yet, so this phase is self-contained.

**Steps**

1. **[TDD] backend-developer** — Create `src/saved-search/types.ts` with the zod schemas and inferred types exactly as in the spec ("Domain model"): `SavedSearchScopeSchema` (with the region-XOR-parkPageIds refinement — both non-empty rejected), `SavedSearchDatePatternSchema` (discriminated union `fixed_range` | `any_weekend`), `SavedSearchFiltersSchema`, `SavedSearchSchema`, and a `SavedSearchInput` type = schema omitting `id`/`createdAt`/`updatedAt`. Test first: valid object accepted; both `region` and `parkPageIds` non-empty rejected; defaults applied (`alertEnabled=false`, `emailEnabled=true`, `minNights=1`, empty filter arrays).
2. **backend-developer** — Add the `saved_searches` table + the two indexes to `initDb()` in `src/cache/db.ts` (idempotent `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`), placed after the `availability` table block and before the MV definition. Use the DDL verbatim from the spec ("Storage"). Do NOT touch `MV_DEFINITION` or `rebuildMaterializedView`.
3. **[TDD] backend-developer** — Create `src/saved-search/store.ts` with the six functions from the spec (`listSavedSearches`, `getSavedSearch`, `createSavedSearch`, `updateSavedSearch`, `deleteSavedSearch`, `listAlertEnabledSavedSearches`). Each write validates with the zod schema before persisting; `createSavedSearch` assigns `crypto.randomUUID()` + `createdAt`/`updatedAt`; `updateSavedSearch` bumps `updatedAt`. Reads parse JSONB back through the schema and **skip rows that fail validation** (mirrors `listAlerts`). `userId` defaults to `null`. Tests: create→get→list→update→delete round-trip; JSONB parse-back deep-equals input definition; `listAlertEnabledSavedSearches` returns only `alert_enabled=true` rows; a deliberately-corrupt JSONB row is skipped (not thrown) on list.

**Verification gate**
- `npm run typecheck`
- `npm test` (new `types.ts` + `store.ts` suites green)
- Manual: `npm run db:init` runs clean and idempotently (run it twice); confirm `\d saved_searches` shows the table + both indexes.

**Acceptance criteria (from spec "Testing")**
- `SavedSearchSchema` accepts valid; rejects both `region` and `parkPageIds` non-empty; defaults applied.
- `store.ts` round-trip passes; JSONB parse-back equals input; alert-enabled filter correct; bad-JSONB row skipped.
- `npm run db:init` creates `saved_searches` idempotently.

---

## Phase 1 — Shared pure helpers (extractions)

Extract the two reusable pure functions the spec calls out, so the matcher (Phase 2) and the existing scanner share one implementation. Pure refactors with no behavior change — existing tests must stay green.

**Steps**

1. **[TDD] backend-developer** — Create `src/rules/weekend-arrivals.ts` exporting a pure Fri/Sat arrival generator extracted from `generateNextAvailableWeekend` in `src/rules/scan-candidates.ts` (signature roughly `weekendArrivals(today: string, horizonDays: number, minNights: 1|2|3): { arrivalDate: string; nights: number }[]`). Refactor `generateNextAvailableWeekend` to call the shared helper so both call sites agree. Tests: only Fri + Sat arrivals; Sat yields 1N only and is dropped when `minNights > 1`; arrivals stay within `[today+1, today+horizonDays]`; horizon respected.
2. **[TDD] backend-developer** — Create `src/cache/freshness.ts` exporting `oldestCoveringScan(windows, dates)` extracted verbatim from `src/scanner/match-candidates.ts`. Update `match-candidates.ts` to import it (delete the local copy). Tests: oldest `scannedAt` among covering windows; `undefined` when no window covers the stay.

**Verification gate**
- `npm run typecheck`
- `npm test` (full suite — existing scan-candidates + match-candidates tests must remain green, proving the extraction is behavior-preserving)

**Acceptance criteria**
- No behavior change: pre-existing tests unchanged and passing.
- `weekend-arrivals.ts` matches spec semantics (Fri+Sat, minNights gating, horizon bound).
- `oldestCoveringScan` shared by `match-candidates.ts` and importable by the new matcher.

---

## Phase 2 — Matcher (pure orchestration)

The matcher is the heart of the feature and the contract the scanner, the `/run` route, and the UI preview all share. It depends on Phase 0 types + Phase 1 helpers. Inject `searchAvailableStays`, `parkRegionOf`, and `getEntriesForPark` as deps (spec) so it stays pure-testable with stubs.

**Steps**

1. **[TDD] backend-developer** — Create `src/saved-search/match.ts` with `expandStayWindows(search, today)`. `fixed_range` → one window per arrival in `[from, to - minNights]` spanning `minNights` nights. `any_weekend` → call `weekendArrivals` (Phase 1) with `horizonDays`/`minNights`. Tests (pure, no DB): `fixed_range` arrival sets for minNights 1/2/3; `any_weekend` yields only Fri/Sat arrivals within horizon; horizon clamp at 180.
2. **[TDD] backend-developer** — In `src/saved-search/match.ts` add `SavedSearchOpening` interface (spec shape) and `matchSavedSearch(search, deps, today)`. Algorithm per spec "Matching algorithm": expand windows → one `searchAvailableStays` call per window with `filters.access/kinds/hide` → scope-filter parks (`parkPageIds` non-empty wins; else region via injected `parkRegionOf`; else all parks) → emit one opening per `(park, campground, availableSite, arrival, nights)`, sourcing `availabilityAsOf` from `oldestCoveringScan` over `getEntriesForPark` windows. Only `availableSites` become openings — never `walkUpSites`. Tests with injected stubs: region scope filters parks; explicit `parkPageIds` overrides region; access/kinds/hide passed through to the stub; walk-up site never an opening; `availabilityAsOf` = oldest covering scan; empty cache → no openings.
3. **[TDD] backend-developer** — Add the saved-search hit-key form to `src/state/scan-state.ts`. Extend `AvailabilityHitRecord` with optional `savedSearchId?`, `parkPageId?`, `parkName?`, `campgroundName?`. Make `hitKey` emit the `ss:${savedSearchId}|${parkPageId}|${campgroundName}|${siteName}|${arrivalDate}|${departureDate}` form when `savedSearchId` is set, and the legacy `${targetId}|${siteName}|...` form otherwise. Add `openingsToHitRecords(openings, now)`. Tests: saved-search key never collides with a legacy Target key; `openingsToHitRecords` maps every opening field onto the record.

**Verification gate**
- `npm run typecheck`
- `npm test` (match.ts + scan-state key tests green; existing scan-state tests unaffected)

**Acceptance criteria (from spec "Testing")**
- `expandStayWindows` correct for both patterns + horizon clamp.
- `matchSavedSearch` honors scope/filters, excludes walk-up, computes freshness, empty-cache safe.
- Saved-search hit key never collides with a legacy Target key.

---

## Phase 3 — Hit-state v3 + reconcile integration

Bump the hit store to v3 and confirm `reconcileHits` (unchanged) handles saved-search openings end to end. Depends on Phase 2 record extensions.

**Steps**

1. **[TDD] backend-developer** — In `src/state/scan-state.ts` bump the persisted `version` to `3` in `readHitsState`/`writeHitsState`. Add the v2→v3 path: old v2 records load unchanged (no `notifiedAt` rewrite — v2 already has it; v3 only adds optional opening fields that are simply absent on old records). Keep the existing v1→v2 path. Tests: a v2 file loads with no notification burst and no field loss; a v3 file round-trips.
2. **[TDD] tester** — Add a `reconcileHits` integration test fed by `openingsToHitRecords` output (not Target hits): new opening → in `toNotify`; same opening next run → not re-notified; checked-but-absent → `disappearedAt` set, not notified; reappeared → notified; past-arrival pruned. Use the spec's `checkedKeys` definition (currently-stored hits for this search whose window was re-evaluated this run, unioned with incoming keys) so disappear→reappear works without enumerating the catalog.

**Verification gate**
- `npm run typecheck`
- `npm test`

**Acceptance criteria (from spec "Testing")**
- v2→v3 loader: old records load unchanged, no notification burst.
- New opening → notify; repeat → no re-notify; disappeared → `disappearedAt` no notify; reappeared → notify; past-arrival pruned.

---

## Phase 4 — Scanner integration (`runScan`)

Wire the saved-search source into the existing pipeline alongside (transitionally) the legacy Target path. Both feed the same `reconcileHits` + `notify`. Depends on Phases 2–3.

**Steps**

1. **backend-developer** — Extend `src/scanner/run-scan.ts`: after the existing legacy alert loop, add a saved-search source — `listAlertEnabledSavedSearches()` → `matchSavedSearch(...)` (supplying the real deps: `searchAvailableStays`, `getEntriesForPark`, and a `parkRegionOf` resolver — see note below) → `openingsToHitRecords` → push into `allIncoming`. Build `checkedKeys` for each saved search per the spec's previously-seen-bounded definition. Branch `buildAvailabilityAlerts`: when `hit.savedSearchId` is set, source `parkName`/`campgroundName` from the hit record and `bookingUrl` from the opening (not from a legacy `Alert`); email body + freshness line unchanged. `emailEnabled` gating reads `email_enabled` on the saved search.
2. **backend-developer** — Provide the `parkRegionOf` resolver usable from the worker (a non-Next process). Since `src/` must not import `web/lib/regions.ts`, place the catalog-backed region classifier where both `src/` scanner and `web/` can reach it, or inject a thin resolver built from the catalog loader the scanner already uses. Keep it injected into `matchSavedSearch` — do not hardcode region logic inside `src/saved-search/match.ts`.

**Verification gate**
- `npm run typecheck`
- `npm test`
- Manual: `npm run scan` runs without error against current data (legacy Targets still scanned; saved-search source present even if zero alert-enabled rows). No duplicate notifications.

**Acceptance criteria (from spec "Scanner integration")**
- Saved-search source feeds the same downstream pipeline; `reconcileHits`/`notify` unchanged.
- `buildAvailabilityAlerts` branches correctly on `savedSearchId`.
- Alert default is OFF (only `alert_enabled=true` searches are scanned).

---

## Phase 5 — Migration command

One-time `data/targets.json` → `saved_searches` import. Depends on Phase 0 store. Idempotent (upsert on `id`). Does not delete `targets.json`.

**Steps**

1. **[TDD] backend-developer** — Create `src/cli/commands/migrate-targets.ts` mapping each legacy `Target`/`Alert` to a `SavedSearch` per the spec's mapping table: `date_range` → `fixed_range`; `weekend_range`/`next_available_weekend`/`weekendsOnly` → `any_weekend` (horizon = `rangeEnd - today` clamped to 180, or `nextWeeksCount*7`, default 90); `exact_dates` → `fixed_range`; `minNights` clamped to 1–3 with warn; `campingType: 'hike-in'` → `filters.access=['hike_in']`; `yosemite-lottery` rows **skipped with a warning**; `enabled`→`alert_enabled`, `emailEnabled`→`email_enabled`; `acceptableSites` + other dropped fields preserved under `definition.legacy` (lossless). Idempotent upsert on `id`. Tests: each date-mode mapping; lottery skipped with warning; `acceptableSites` preserved under `definition.legacy`; re-run produces no duplicate rows.
2. **backend-developer** — Register `db:migrate-targets` in `src/cli/index.ts` and add the `db:migrate-targets` script to `package.json`.

**Verification gate**
- `npm run typecheck`
- `npm test`
- Manual: `npm run db:migrate-targets` imports the existing Angel Island row as a park-scoped saved search; re-running is a no-op (row count unchanged).

**Acceptance criteria (from spec "Testing")**
- Date-mode mappings correct; lottery skipped; `acceptableSites` preserved under `definition.legacy`; idempotent on re-run.
- Existing Angel Island target imports as a park-scoped saved search.

---

## Phase 6 — API routes

Thin REST handlers over the store + matcher. Depends on Phases 0 + 2. Mirror the `/api/search` pattern (`dynamic = 'force-dynamic'`, zod via store, 400/404/500).

**Steps**

1. **backend-developer** — Create `web/lib/saved-searches.ts`: re-export the store for the web layer (mirrors `web/lib/alerts.ts`) and supply a catalog-backed `parkRegionOf` (using `classifyRegion` over catalog coords, same approach as `/api/search`) for the `/run` route's matcher call.
2. **backend-developer** — Create `web/app/api/saved-searches/route.ts`: `GET` (→ `{ savedSearches }`, `userId=null`) and `POST` (validate `SavedSearchInput` via store → `201 { savedSearch }`). Signatures verbatim from spec.
3. **backend-developer** — Create `web/app/api/saved-searches/[id]/route.ts`: `GET` (→ `{ savedSearch }` or `404`), `PATCH` (`Partial<SavedSearchInput>` → `{ savedSearch }`), `DELETE` (→ `204`). `ctx: { params: Promise<{ id: string }> }` per Next 15.
4. **backend-developer** — Create `web/app/api/saved-searches/[id]/run/route.ts`: `POST` → load search, run `matchSavedSearch` with the real deps (`searchAvailableStays`, `getEntriesForPark`, web `parkRegionOf`) → `{ openings }`. This is the same matcher the scanner uses, so preview and email can't diverge.

**Verification gate**
- `npm run typecheck`
- `npm test`
- Manual: with a created row, `curl` each route — `GET`/`POST` list+create, `GET`/`PATCH`/`DELETE [id]`, and `POST [id]/run` returns openings; bad body → 400, missing id → 404.

**Acceptance criteria (from spec "API routes")**
- All six handlers match the spec signatures and status-code contract.
- `/run` returns the same openings the scanner would alert on (shared matcher).

---

## Phase 7 — UI surface

Create-from-current-filters on `/explore`, the `/saved` index, nav link, and RecentOpenings rendering. Depends on Phase 6 routes. All `web/` work.

**Steps**

1. **frontend-developer** — Create `web/components/SaveSearchModal.tsx` (reuse `web/components/ui/Modal`): name field (prefilled, e.g. "Bay Area · Jul 4 weekend"), Fixed-dates ↔ Any-weekend toggle (default `fixed_range` when coming from explicit date inputs; `any_weekend` offers a 30/60/90/180 horizon select), and an "Alert me by email" toggle (default off → maps to `alertEnabled`). Save → `POST /api/saved-searches` → toast.
2. **frontend-developer** — Edit `web/app/explore/FindCampsitesClient.tsx`: add a "Save this search" button to the filter bar that captures live filter state (region, from/to, minNights if present, access/kinds/hide) into a `SavedSearchInput` and opens the modal. Also read `?savedSearch=<id>` to render a "Showing: <name>" banner + an inline "Edit this search" link.
3. **frontend-developer** — Create `web/app/saved/page.tsx` + `web/app/saved/SavedSearchesClient.tsx`: list saved searches as cards (reuse `ui/Card`, `ui/Badge`, `ui/StatusDot`) showing name · scope summary · date-pattern summary · filter chips · an Alert `StatusDot` (green when `alertEnabled`). Per-card actions: **Run** (primary), **Edit**, **Alert on/off** toggle (`PATCH`), **Delete**. Run serializes the search into a URL: `fixed_range` → `/explore?from=&to=&region=&access=&kinds=&hide=&minNights=&savedSearch=<id>`; `any_weekend` → `/map?weekendsOnly=true&...&savedSearch=<id>` with the horizon preset. Empty state via `ui/EmptyState` ("No saved searches yet — filter on Find Campsites and hit Save this search.").
4. **frontend-developer** — Add `{ href: '/saved', label: 'Saved' }` to `web/app/components/nav-links.ts`.
5. **frontend-developer** — Update the dashboard **RecentOpenings** panel to render the new optional record fields (`parkName`/`campgroundName` straight from the record, link each row to `/saved` + the booking URL). No structural component change.

**Verification gate**
- `npm run typecheck`
- `npm test`
- Manual (`npm run dev`): `/saved` and `/explore` load with no console/hydration errors; `/explore` → set filters → "Save this search" → row appears on `/saved`; `/saved` → Run navigates to `/explore` (fixed) or `/map` (weekend) prefilled with the "Showing: <name>" banner.

**Acceptance criteria (from spec "UI surface")**
- Save-this-search captures live filters; saved row appears on `/saved`.
- Run reuses `/explore` (fixed) / `/map` (weekend) by URL prefill with banner.
- Alert toggle / edit / delete work; empty state renders; nav link present.

---

## Phase 8 — End-to-end verification (critical-path close)

No new code. Prove the full loop against migrated data before any legacy retirement.

**Steps**

1. **tester** — Run the spec's integration/manual checklist end to end:
   - `npm run db:init` idempotent; `npm run db:migrate-targets` imports Angel Island, re-run is a no-op.
   - Enable Alert on a saved search whose scope currently has availability → `npm run scan` (or a `npm run worker` cycle) produces an opening → email sent (with freshness line) → second cycle sends no duplicate → dashboard RecentOpenings shows the opening.
   - `POST /api/saved-searches/[id]/run` returns the same openings the scanner alerts on.
2. **reviewer** — Gate the full diff (risk: shared scanner pipeline + new persistence). Confirm no `any`, kebab-case files, no park-specific constants outside seed/tests, `src/` does not import `web/`.

**Verification gate**
- `npm run verify` (typecheck + test + upcoming + scan + web build) green.
- Clean `npm run dev` load of `/saved` + `/explore`, no console/hydration errors.

**Acceptance criteria (from spec "Gate")**
- All integration/manual checks pass; no duplicate emails; preview == scanner openings.
- `npm run typecheck`, `npm test`, clean dev load; no `any`; conventions honored.

---

## Phase 9 — Legacy retirement (POST-verification — NOT on the critical path)

Per the spec, this happens **only after** the saved-search scanner is confirmed working against migrated data (Phase 8 signed off). Owned by the **doc-steward** as a separate pass, not part of the build's hot path. Listed here for completeness only.

- Remove the legacy Target path: `src/config/alerts.ts`, `src/config/schemas.ts` Target wiring; `web/lib/alerts.ts`; the `matchCandidates`/`generateScanCandidates` Target branch in `runScan`. `data/targets.json` is left on disk.
- Reconcile docs: CLAUDE.md Next Steps (`[ ] User-defined saved searches` → done), Cache Architecture (new table), Site Filters/Three Engines (Trip Target Engine now persisted), and the surface docs under `docs/reference/`.

**Do not begin Phase 9 as part of this plan's execution.** Route it to the doc-steward once Phase 8 is verified in use.

---

## Phase / step summary

| Phase | Focus | Owner(s) | ~Steps | Gate |
|---|---|---|---|---|
| 0 | Schema + types + store | backend, tester | 3 | typecheck, test, `db:init` |
| 1 | Shared pure helpers (weekend, freshness) | backend | 2 | typecheck, test (no regressions) |
| 2 | Matcher (expand + match + hit-key) | backend | 3 | typecheck, test |
| 3 | Hit-state v3 + reconcile | backend, tester | 2 | typecheck, test |
| 4 | Scanner `runScan` integration | backend | 2 | typecheck, test, `npm run scan` |
| 5 | Migration command | backend | 2 | typecheck, test, `db:migrate-targets` |
| 6 | API routes | backend | 4 | typecheck, test, curl routes |
| 7 | UI (modal, `/saved`, nav, RecentOpenings) | frontend | 5 | typecheck, test, dev load |
| 8 | End-to-end verification | tester, reviewer | 2 | `npm run verify`, dev load |
| 9 | Legacy retirement (post-verify) | doc-steward | — | out of hot path |

**Total critical-path steps (Phases 0–8): ~25.** Dependency spine: schema/store → pure helpers → matcher → hit-state → scanner → migration → API → UI → verify. Each phase has an explicit gate; pure-logic steps are TDD-first.
