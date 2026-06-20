# CampBrain Hosted Launch — Phase 1a (Domain Core Port) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the pure, Cloudflare-Workers-safe domain logic from the legacy `src/` tree into a new `packages/core` workspace package (plus moving the saved-search Zod schemas into `packages/types`), so the Phase 1 scanner, DB queries, and map UI can build on it.

**Architecture:** `packages/core` holds framework-agnostic, side-effect-free domain logic (HTML parser, site/region classifiers, window + stay math, weekend-tier generator, the CA-parks provider) — no `fs`/`path`/`postgres`/DB access. DB access is provided to functions via dependency injection (already the pattern in the legacy code). Shared Zod DTOs (saved-search schemas) move to `packages/types`. Everything is ported with its existing Vitest tests so behavior is locked.

**Tech Stack:** Bun · TypeScript (strict) · Vitest · cheerio (Workers-compatible) · dayjs · zod.

**Spec:** `docs/superpowers/specs/2026-06-17-hosted-launch-design.md` (Phase 1 section). **Phase 0 is shipped + deployed** (see that spec's status line).

---

## Phase 1 decomposition (this is sub-plan 1a of 4)

Phase 1 (the "live map" milestone) is delivered as four sequential sub-plans. **This document is 1a.** The others get their own detailed plans when reached:

- **1a — Domain core port (THIS PLAN):** `packages/core` + saved-search DTOs → `packages/types`. Exit: pure domain logic ported with green tests; no Node-only deps.
- **1b — DB read layer + catalog seed:** `packages/db` map queries (`getEntriesForParks`, MV-backed `searchAvailableStays`, `getParkAvailabilityCounts`/summary, `listParksFromDb`, `buildEntriesFromRows`/`buildDateSiteMap` dedupe) + a way to load the `data/catalog/california-parks.json` catalog into Neon (seed script). Exit: availability + catalog queryable from Neon via typed functions.
- **1c — Scanner (Cron + Queues + R2):** a CF Cron enqueues per-(park,window) jobs; a Queue consumer fetches+parses (via `packages/core`) and upserts to Neon (via `packages/db`); separate crons refresh the MV and (Phase 2) run alerts; parser debug HTML → R2. Exit: real CA-parks availability flowing into Neon on a schedule.
- **1d — Map surface + allowlist enforcement:** tRPC `map` router (catalog, availability, summary) consuming `packages/db`; the Vite map page (Leaflet + filters + weekend tiers, ported from `web/app/map`); auth-aware nav with public read-only browse and login-to-save; **wire `isAllowlisted` into the auth flow** (the Phase-0-deferred gate); set the app `<title>` to CampBrain. Exit: the live map at the staging URL.

**Deliberately NOT in Phase 1a** (stays in legacy `src/` until its sub-plan/phase):
- Anything coupled to the legacy `Target` type (`rules/scan-candidates.ts`, `rules/booking-window.ts`, `providers/.../parseAvailabilityHtml`, `evaluateCandidate`, `scanner/match-candidates.ts`) — that's the **alert/booking-window** path → **Phase 2**.
- `saved-search/match.ts` (`matchSavedSearch`, `expandStayWindows`) — used by the alert scan, not the map → **Phase 2** (note: `weekendArrivals`, which `expandStayWindows` depends on, IS ported in 1a).
- All DB-coupled query functions, `catalog-store.ts` file I/O, `utils/files.ts`, state persistence, notifications, calendar.
- Recreation.gov provider — defer to a later pass; CA-parks first (note it, don't port in 1a).

---

## Port conventions (read once before starting)

This is a **port**, so most "implementation" is *copying an existing, working file and adjusting imports* — the source of truth is the existing file at the cited path. For each module:

1. **Copy the cited `src/...` file verbatim** to its `packages/core/src/...` destination, then apply the listed transforms.
2. **Drop `.js` extensions** from all relative imports (the monorepo uses `moduleResolution: "Bundler"`; the legacy tree used NodeNext `.js` specifiers). e.g. `from "./regions.js"` → `from "./regions"`.
3. **Rewrite cross-tree imports** to the new package layout as specified per task (e.g. saved-search types → `@campbrain/types`).
4. **Do not port** any function that imports the legacy `Target` type or `src/cache/db` / `src/cache/availability-cache` DB functions — if a ported file references those, the task says exactly which exports to keep vs. drop.
5. **Bring the test** from `/test/<name>.test.ts`, copy it next to the module (`packages/core/src/.../<name>.test.ts` or a `test/` dir — match whatever the package's vitest config globs), drop `.js` import extensions, and update the import path to the new module location. If the test exercises a dropped (Target-coupled) function, remove only those test cases and note it.

`packages/core` has **no DB or Node-only dependencies**. If a port pulls in `fs`/`path`/`postgres`, stop — it means a non-pure function slipped in; re-scope to the pure subset.

---

## File structure (`packages/core`)

```
packages/core/
  package.json            name @campbrain/core; deps: cheerio, dayjs, zod, @campbrain/types; devDeps vitest, typescript
  tsconfig.json           extends ../../tsconfig.base.json; include src
  vitest.config.ts        (or rely on root) — globs src/**/*.test.ts
  src/
    index.ts              barrel: re-export the public surface
    catalog/
      regions.ts          classifyRegion, CampRegion, REGION_LABELS, ALL_REGIONS   (from src/catalog/regions.ts)
      regions.test.ts
      site-classifier.ts  classifySite, isWalkUpSite, SiteAccess, SiteKind, SiteTypeInfo  (from src/catalog/site-classifier.ts)
      site-classifier.test.ts
      types.ts            ParkCatalogEntry, CampgroundCatalogEntry, SiteCatalogEntry, ProviderCatalog, CatalogBookingRule, catalogRuleToAlertRule  (from src/catalog/types.ts)
    availability/
      types.ts            SiteDailyAvailability, CampgroundWindow, AvailabilityWindowEntry, AvailableStay, AvailabilityCache  (from src/cache/types.ts)
      freshness.ts        oldestCoveringScan  (from src/cache/freshness.ts)
      freshness.test.ts
      windows.ts          generateWindowStarts, windowEnd, ttlMinutes, isEntryStale  (pure subset of src/cache/availability-cache.ts)
      windows.test.ts
      stays.ts            getAvailableSitesForStay, firstMatchingArrival, siteMatchesMinStay, CampgroundStayResult  (pure subset of src/cache/availability-cache.ts)
      stays.test.ts
    rules/
      weekend-arrivals.ts weekendArrivals, WeekendArrival  (from src/rules/weekend-arrivals.ts)
      weekend-arrivals.test.ts
    providers/
      availability-provider.ts   AvailabilityProvider, CacheWindow  (from src/providers/availability-provider.ts)
      california-parks-parser.ts parseAllAvailability, isNoAvailabilityPage + status types  (TRIMMED from src/providers/california-parks-parser.ts)
      california-parks-parser.test.ts
      california-parks-provider.ts CaliforniaParksProvider, buildAvailabilityUrl  (from src/providers/california-parks-provider.ts)
      california-parks-provider.test.ts
    utils/
      concurrency.ts      runWithConcurrency  (from src/utils/concurrency.ts)
      dates.ts            getWeekendDatesInRange, parseTimeInTimezone, formatDateTime, etc.  (from src/utils/dates.ts)
```

`packages/types` gains:
```
packages/types/src/saved-search.ts   SavedSearchSchema + all related schemas/types  (from src/saved-search/types.ts)
packages/types/src/index.ts          export * from "./saved-search"
```

---

## Task 1: Scaffold `packages/core` + move saved-search DTOs to `packages/types`

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`
- Create: `packages/types/src/saved-search.ts`; Modify: `packages/types/src/index.ts`; Modify: `packages/types/package.json` (no dep change — zod already present)

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@campbrain/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@campbrain/types": "workspace:*",
    "cheerio": "^1.0.0",
    "dayjs": "^1.11.13",
    "zod": "^3.24.0"
  },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.7.0" }
}
```
(Check the exact `cheerio`/`dayjs` versions used by the legacy root `package.json` history and match the majors.)

- [ ] **Step 2: Create `packages/core/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```
And `packages/core/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 3: Move saved-search Zod schemas into `packages/types`**

Copy `src/saved-search/types.ts` → `packages/types/src/saved-search.ts` verbatim, drop any `.js` import extensions (it only imports `zod`, so no path rewrites needed). It exports `SavedSearchScopeSchema`, `SavedSearchDatePatternSchema`, `SavedSearchFiltersSchema`, `SavedSearchSchema`, `SavedSearchInputSchema`, and the inferred types `SavedSearch`, `SavedSearchScope`, `SavedSearchDatePattern`, `SavedSearchFilters`, `SavedSearchInput`.

Then set `packages/types/src/index.ts`:
```ts
export * from "./saved-search";
```

- [ ] **Step 4: Create `packages/core/src/index.ts`** (placeholder barrel; grows per task)
```ts
export {}; // re-exports added as modules are ported
```

- [ ] **Step 5: Bring the saved-search types test across**

Copy `/test/saved-search-types.test.ts` → `packages/types/test/saved-search.test.ts`, drop `.js` extensions, repoint its import to `../src/saved-search`. Add a `test` script + `vitest` devDep to `packages/types/package.json` if not present:
```json
"scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p tsconfig.json" }
```
and ensure `vitest` is in devDependencies and tsconfig `include` covers `test`.

- [ ] **Step 6: Install + verify**

Run: `bun install`
Run: `bun --filter @campbrain/types test` → saved-search schema tests PASS.
Run: `bun --filter @campbrain/types typecheck` and `bun --filter @campbrain/core typecheck` → exit 0.

- [ ] **Step 7: Commit**
```bash
git add packages/core packages/types
git commit -m "feat(core): scaffold @campbrain/core; move saved-search DTOs to @campbrain/types"
```

---

## Task 2: Port the classifiers (region + site) — zero-dependency, pure

**Files:**
- Create: `packages/core/src/catalog/regions.ts` (+ `.test.ts`), `packages/core/src/catalog/site-classifier.ts` (+ `.test.ts`), `packages/core/src/catalog/types.ts`

- [ ] **Step 1: Port `regions.ts`** — copy `src/catalog/regions.ts` → `packages/core/src/catalog/regions.ts` verbatim (zero deps, no transforms beyond confirming no `.js` imports). Exports: `CampRegion`, `REGION_LABELS`, `ALL_REGIONS`, `classifyRegion(lat, lon)`.

- [ ] **Step 2: Port `site-classifier.ts`** — copy `src/catalog/site-classifier.ts` → `packages/core/src/catalog/site-classifier.ts` verbatim (zero deps). Exports: `SiteAccess`, `SiteKind`, `SiteTypeInfo`, `isWalkUpSite(siteName, campgroundName?)`, `classifySite(siteName, campgroundName, recGovCampsiteType?)`.

- [ ] **Step 3: Port `catalog/types.ts`** — copy `src/catalog/types.ts` → `packages/core/src/catalog/types.ts` verbatim (drop `.js` if any). Exports the catalog entry types + `catalogRuleToAlertRule`.

- [ ] **Step 4: Bring the tests**
Copy `/test/regions.test.ts` → `packages/core/src/catalog/regions.test.ts` and `/test/site-classifier.test.ts` → `packages/core/src/catalog/site-classifier.test.ts`. Repoint imports to `./regions` / `./site-classifier`, drop `.js`. (Also check `/test/site-taxonomy.test.ts`: if it tests `isWalkUpSite`/`classifySite` from the classifier, port the relevant cases to `site-classifier.test.ts`; if it tests `web/lib/site-taxonomy.ts` mapping, leave it for 1d.)

- [ ] **Step 5: Run + verify**
Run: `bun --filter @campbrain/core test` → region + classifier tests PASS.
Run: `bun --filter @campbrain/core typecheck` → exit 0.

- [ ] **Step 6: Add to barrel** — append to `packages/core/src/index.ts`:
```ts
export * from "./catalog/regions";
export * from "./catalog/site-classifier";
export * from "./catalog/types";
```

- [ ] **Step 7: Commit**
```bash
git add packages/core
git commit -m "feat(core): port region + site classifiers"
```

---

## Task 3: Port utils (concurrency + dates)

**Files:** Create `packages/core/src/utils/concurrency.ts`, `packages/core/src/utils/dates.ts` (+ any tests that exist)

- [ ] **Step 1: Port `concurrency.ts`** — copy `src/utils/concurrency.ts` → `packages/core/src/utils/concurrency.ts` verbatim (zero deps). Exports `runWithConcurrency<T>(tasks, limit)`.

- [ ] **Step 2: Port `dates.ts`** — copy `src/utils/dates.ts` → `packages/core/src/utils/dates.ts`; drop `.js`. It imports `dayjs` + plugins (utc, timezone, isSameOrBefore) — keep those imports. Exports `getWeekendDatesInRange`, `parseTimeInTimezone`, `getBookingWindowTime`, `getReminderTimes`, `formatDateTime`. (These are pure; `getBookingWindowTime`/`getReminderTimes` are booking-window helpers but are pure and dependency-free, so porting them now is fine and avoids a Phase-2 reach-back.)

- [ ] **Step 3: Bring tests** — if `/test/` has a dates or concurrency test, copy it across with repointed imports. If none exists, write a minimal real test for `runWithConcurrency` (it has no dedicated legacy test):
```ts
import { describe, it, expect } from "vitest";
import { runWithConcurrency } from "./concurrency";

describe("runWithConcurrency", () => {
  it("runs all tasks and preserves input order", async () => {
    const order: number[] = [];
    const tasks = [10, 1, 5].map((ms, i) => async () => {
      await new Promise((r) => setTimeout(r, ms));
      order.push(i);
      return i;
    });
    const results = await runWithConcurrency(tasks, 2);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([0, 1, 2]);
    expect(order.length).toBe(3);
  });
});
```

- [ ] **Step 4: Run + verify** — `bun --filter @campbrain/core test` and `typecheck` → green.

- [ ] **Step 5: Barrel + commit**
Append `export * from "./utils/concurrency";` and `export * from "./utils/dates";` to the barrel.
```bash
git add packages/core
git commit -m "feat(core): port concurrency + date utils"
```

---

## Task 4: Port the weekend-tier generator

**Files:** Create `packages/core/src/rules/weekend-arrivals.ts` (+ `.test.ts`)

- [ ] **Step 1: Port** — copy `src/rules/weekend-arrivals.ts` → `packages/core/src/rules/weekend-arrivals.ts` verbatim (zero deps). Exports `WeekendArrival` and `weekendArrivals(today, horizonDays, minNights)`.

- [ ] **Step 2: Bring the test** — copy `/test/weekend-arrivals.test.ts` → `packages/core/src/rules/weekend-arrivals.test.ts`, repoint import to `./weekend-arrivals`, drop `.js`.

- [ ] **Step 3: Run + verify** — `bun --filter @campbrain/core test` (weekend-arrivals cases pass) + `typecheck`.

- [ ] **Step 4: Barrel + commit**
Append `export * from "./rules/weekend-arrivals";`.
```bash
git add packages/core
git commit -m "feat(core): port weekend-arrivals generator"
```

---

## Task 5: Port availability data types + freshness

**Files:** Create `packages/core/src/availability/types.ts`, `packages/core/src/availability/freshness.ts` (+ `.test.ts`)

- [ ] **Step 1: Port data types** — copy `src/cache/types.ts` → `packages/core/src/availability/types.ts` verbatim (pure data shapes, drop `.js`). Exports `SiteDailyAvailability`, `CampgroundWindow`, `AvailabilityWindowEntry`, `AvailabilityCache`, `AvailableStay`.

- [ ] **Step 2: Port freshness** — copy `src/cache/freshness.ts` → `packages/core/src/availability/freshness.ts`; repoint its `AvailabilityWindowEntry` import to `./types`, drop `.js`. Exports `oldestCoveringScan(windows, dates)`.

- [ ] **Step 3: Bring the test** — copy `/test/freshness.test.ts` → `packages/core/src/availability/freshness.test.ts`, repoint imports (`../src/cache/freshness.js` → `./freshness`; types → `./types`).

- [ ] **Step 4: Run + verify** — `bun --filter @campbrain/core test` + `typecheck` → green.

- [ ] **Step 5: Barrel + commit**
Append `export * from "./availability/types";` and `export * from "./availability/freshness";`.
```bash
git add packages/core
git commit -m "feat(core): port availability types + freshness"
```

---

## Task 6: Port the pure window + stay helpers (from `availability-cache.ts`)

`src/cache/availability-cache.ts` mixes pure logic with DB queries. Port ONLY the pure functions into two focused files. Open `src/cache/availability-cache.ts` and copy each named function body verbatim; do NOT bring any function that calls `getSql()`/issues SQL.

**Files:** Create `packages/core/src/availability/windows.ts` (+ `.test.ts`), `packages/core/src/availability/stays.ts` (+ `.test.ts`)

- [ ] **Step 1: Port window helpers → `windows.ts`** — copy these pure functions verbatim from `availability-cache.ts`: `generateWindowStarts(daysAhead, today?)`, `windowEnd(windowStart)`, `ttlMinutes(windowStart, nowMs?)`, `isEntryStale(entry, nowMs?)`. Repoint any type imports to `./types`, drop `.js`. (These import only `dayjs` + the availability types.)

- [ ] **Step 2: Port stay helpers → `stays.ts`** — copy these pure functions verbatim: `getAvailableSitesForStay(windows, arrivalDate, nights)`, `firstMatchingArrival(availableDates, opts)`, `siteMatchesMinStay(availableDates, opts)`, and the `CampgroundStayResult` type. Repoint type imports to `./types` + `../catalog/site-classifier` (if it uses `classifySite`/`isWalkUpSite`), drop `.js`.

- [ ] **Step 3: Bring the tests** — port the pure-logic cases. `/test/min-nights.test.ts` covers `siteMatchesMinStay`/`firstMatchingArrival` → `packages/core/src/availability/stays.test.ts`. `/test/availability-cache-provider.test.ts` — port ONLY the cases that exercise the pure helpers above (skip cases that hit the DB layer); if a case needs the DB, drop it and note it. If `generateWindowStarts`/`windowEnd`/`ttlMinutes` lack dedicated tests, add real ones:
```ts
import { describe, it, expect } from "vitest";
import { generateWindowStarts, windowEnd, ttlMinutes } from "./windows";

describe("window helpers", () => {
  it("generateWindowStarts steps by 8 days from today+2", () => {
    const starts = generateWindowStarts(16, "2026-01-01");
    expect(starts[0]).toBe("2026-01-03"); // today + 2
    expect(starts[1]).toBe("2026-01-11"); // + 8 days
  });
  it("windowEnd is 7 days after the start (8-day inclusive window)", () => {
    expect(windowEnd("2026-01-03")).toBe("2026-01-10");
  });
  it("ttlMinutes shrinks as the window approaches", () => {
    const soon = ttlMinutes("2026-01-03", new Date("2026-01-01T00:00:00Z").getTime());
    const far = ttlMinutes("2026-06-01", new Date("2026-01-01T00:00:00Z").getTime());
    expect(soon).toBeLessThan(far);
  });
});
```
> Verify these assertions against the ACTUAL legacy behavior before relying on them — read the function bodies; adjust the expected values to match what the code does (the point is to lock real behavior, not to impose new behavior).

- [ ] **Step 4: Run + verify** — `bun --filter @campbrain/core test` + `typecheck` → green.

- [ ] **Step 5: Barrel + commit**
Append `export * from "./availability/windows";` and `export * from "./availability/stays";`.
```bash
git add packages/core
git commit -m "feat(core): port pure window + stay helpers"
```

---

## Task 7: Port the CA-parks parser + provider

**Files:** Create `packages/core/src/providers/availability-provider.ts`, `packages/core/src/providers/california-parks-parser.ts` (+ `.test.ts`), `packages/core/src/providers/california-parks-provider.ts` (+ `.test.ts`)

- [ ] **Step 1: Port the provider interface** — copy `src/providers/availability-provider.ts` → `packages/core/src/providers/availability-provider.ts`; repoint type imports (`CampgroundCatalogEntry` → `../catalog/types`; `AvailabilityWindowEntry` → `../availability/types`), drop `.js`. Exports `AvailabilityProvider`, `CacheWindow`.

- [ ] **Step 2: Port the parser (TRIMMED)** — copy `src/providers/california-parks-parser.ts` → `packages/core/src/providers/california-parks-parser.ts`, then **keep only the Target-free exports**: `parseAllAvailability(html)`, `isNoAvailabilityPage(html)`, and the status/data types they need (`AvailabilityStatus`, `AvailabilityConfidence`, `DailySiteStatus`, and the `AllAvailabilityCampground` shape). **Remove** `parseAvailabilityHtml`, `evaluateCandidate`, `ParsedCampground`, `CandidateEvaluation` and the `import ... from "../config/schemas"` / `"../types/scanner"` lines they require (those are Phase 2 alert logic). Keep the `cheerio` and `dayjs` imports.

- [ ] **Step 3: Port the provider** — copy `src/providers/california-parks-provider.ts` → `packages/core/src/providers/california-parks-provider.ts`; repoint imports: parser → `./california-parks-parser`; types → `../availability/types` / `../catalog/types`; drop `.js`. Keep `buildAvailabilityUrl(pageId, candidate)` (pure), `generateCacheWindows(rangeStart, rangeEnd)` (pure), and `proactiveScanWindow(...)` (uses global `fetch` — Workers-native, fine). If `buildAvailabilityUrl` references a `ScanCandidate` type from the legacy scanner types, replace its parameter with the minimal inline shape it actually uses (`{ arrivalDate: string; nights: number }`) so it doesn't drag in Target/scanner types — verify against the function body.

- [ ] **Step 4: Bring the tests** — copy `/test/california-parks-parser.test.ts` → `packages/core/src/providers/california-parks-parser.test.ts`, keeping only cases for `parseAllAvailability`/`isNoAvailabilityPage` (remove cases for the dropped Target-coupled functions). Copy the CA-parks cases from `/test/provider.test.ts` and `/test/california-parks-parser.test.ts` that cover `buildAvailabilityUrl`/`generateCacheWindows` → `packages/core/src/providers/california-parks-provider.test.ts`. Repoint imports; drop `.js`. If a test imported HTML fixtures from a `test/fixtures` path, copy those fixtures into `packages/core/src/providers/__fixtures__/` and repoint.

- [ ] **Step 5: Run + verify** — `bun --filter @campbrain/core test` (parser + provider cases pass) + `typecheck` → green. Confirm no import of `fs`/`path`/`postgres`/`../config` remains: `git grep -nE "from \"(node:|fs|path|postgres)" -- packages/core/src` returns nothing, and `git grep -n "config/schemas" -- packages/core/src` returns nothing.

- [ ] **Step 6: Barrel + commit**
Append `export * from "./providers/availability-provider";`, `export * from "./providers/california-parks-parser";`, `export * from "./providers/california-parks-provider";`.
```bash
git add packages/core
git commit -m "feat(core): port CA-parks parser + provider (map/scan subset)"
```

---

## Task 8: Final wiring + full-repo verification

**Files:** Modify `packages/core/src/index.ts` (confirm complete barrel)

- [ ] **Step 1: Confirm the barrel** — `packages/core/src/index.ts` re-exports every public module (catalog/regions, catalog/site-classifier, catalog/types, utils/concurrency, utils/dates, rules/weekend-arrivals, availability/types, availability/freshness, availability/windows, availability/stays, providers/availability-provider, providers/california-parks-parser, providers/california-parks-provider). Resolve any duplicate-name export conflicts with explicit `export { X } from "..."` if `export *` collides.

- [ ] **Step 2: Full-repo gates** — from repo root:
```bash
bun install
bun run typecheck
bun run test
```
Expected: all packages green (now 7: config, db, api, types, api-client, core, web — `core` and `types` tests included). Paste the summary.

- [ ] **Step 3: Workers-safety assertion** — confirm `packages/core` has zero Node-only imports:
```bash
git grep -nE "from \"node:|require\(|\bfs\b|\bpath\b|postgres" -- packages/core/src || echo "clean"
```
Expected: `clean` (cheerio/dayjs/zod/@campbrain/types only).

- [ ] **Step 4: Commit**
```bash
git add packages/core
git commit -m "feat(core): finalize barrel exports; phase 1a domain core complete"
```

---

## Self-Review

**Spec coverage (Phase 1a scope = the portable domain core from the spec's Phase 1 `packages/core` bullet):**
- CA-parks adapter (parser + provider + URL/window builders) → Task 7. ✅
- Catalog + site-classifier + regions → Task 2 (+ catalog types). ✅
- Reservation-window *rules* relevant to the map (weekend tiers) → Task 4. ✅ (Target-coupled scan-candidates/booking-window deferred to Phase 2 — explicitly scoped out above.)
- Scanner *window logic* (generateWindowStarts, ttl, staleness) → Task 6. ✅
- Stay/availability read helpers (getAvailableSitesForStay, min-stay) → Task 6. ✅
- Saved-search DTOs → `packages/types` (Task 1). ✅ (`matchSavedSearch` deferred to Phase 2 — scoped out.)
- Rec.gov provider → explicitly deferred (noted). ✅ (not a gap; documented scope cut.)

**Placeholder scan:** No "TBD/TODO". The port tasks reference exact source files + exact transforms; added tests (concurrency, windows) include real assertions with a note to verify expected values against actual legacy behavior. The two synthetic test blocks are starting points to be reconciled with real behavior, not placeholders.

**Type/name consistency:** Destination module names and barrel paths match across tasks (e.g. `availability/windows`, `availability/stays`, `providers/california-parks-parser`). `@campbrain/types` is the saved-search home referenced consistently. `classifySite`/`isWalkUpSite` consumed by `stays.ts` come from `catalog/site-classifier` (same package).

**Risk note for the executor:** the one real judgment call is Task 6/7 — extracting the *pure subset* from `availability-cache.ts` and trimming the parser. Read the legacy bodies carefully; if a "pure" function turns out to call a DB helper, port the helper's pure core or leave that function for 1b. Lock behavior with the existing tests; only add synthetic tests where the legacy had none.

---

## Execution Handoff

Recommended: **subagent-driven-development** (fresh subagent per task, spec + code-quality review between tasks) — same as Phase 0. Phase 1a is pure-logic and test-locked, so it should move fast.

After 1a lands, the next step is to **write the 1b plan** (DB read layer + catalog seed), then 1c (scanner), then 1d (map UI + allowlist enforcement).
