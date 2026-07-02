# CampBrain Hosted Launch — Precomputed Park Availability Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. **Self-contained; read the cited files (`map-transforms.ts`, `map.ts`, scanner `main.ts` / `run-calendar-sync.ts`, `packages/db/queries/*`, `site-classifier.ts`) before writing code.**
> **Verification boundary:** everything here is buildable + unit/integration-testable locally against Docker Postgres WITHOUT a live Neon/Worker deploy. The one manual gate is running the migration + one scan against Neon, then confirming Lake Perris (651) loads in the live panel without error 1102 (the whole point). Do NOT block build tasks on the live deploy.

**Goal:** Fix the live production outage — Cloudflare **error 1102** (Workers free-plan 10 ms CPU cap) on the tRPC `map.availability` endpoint for site-heavy parks (Lake Perris 651 = 426 sites, 100% failing today). Move the expensive per-request compute (`buildParkAvailability`: regex classify per site per window, overlapping-window dedupe, weekend-tier date intersections) **out of the Worker** and into the GitHub-Actions scanner (Node, no CPU cap). The scanner precomputes an **unfiltered** per-park digest + a per-site classification map into a new Neon table; the Worker serves a cheap PK read + a pure linear in-Worker filter.

**Architecture:** A new `runDigestBuild` scanner phase (mirrors the 2b-1/2b-3 phase pattern) runs after the proactive scan's MV refresh and before the alert scan, building each park's digest via the **existing** `buildParkAvailability(entries, {})` (no filters) plus a `buildSiteClassMap` classification map, and upserting one JSONB row per park into `park_digests`. The Worker's `map.availability` reads the row by PK and applies a new pure `filterDigest(digest, siteClass, filters)` reducer (taxonomy **and** date range, zero regex, zero date-intersection); on a missing row it falls back to today's `getEntriesForParks` + `buildParkAvailability` path (transient, ≤6 h). The response shape (`ParkAvailabilityResponse`) is unchanged → **zero web changes**.

**Tech Stack:** Bun · Turborepo · TS strict (no `any`) · Drizzle/Neon · tRPC v11 · Hono (Worker) · Vitest. No new dependencies in any package (the Worker bundle stays neon-only; the digest builder reuses `buildParkAvailability` verbatim).

**Spec:** docs/superpowers/specs/2026-07-02-hosted-launch-availability-digest-design.md

**Resolved open sub-decision (from the spec's Self-review):** add the **composite FK to `parks(provider_id, park_page_id)` with `ON DELETE CASCADE`** on `park_digests` (the spec's recommendation) — a removed park drops its digest automatically; no `pruneOrphanDigests` build step needed.

**Env note:** local migrate/tests need `DATABASE_URL` inline: `postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain`, and Docker Postgres up first.

**Layer order (repo dependency flow):** `packages/types` → `packages/db` (schema + migration) → `packages/core` (pure `buildSiteClassMap` + `filterDigest` + equivalence tests) → `apps/scanner` (`runDigestBuild` phase) → `apps/api` (router read path + fallback) → full-repo verification.

---

## Task 0: Environment up + migrated + seeded

```bash
cd /Users/nimajelveh/campbrain && docker compose -f docker-compose.dev.yml up -d && \
  DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun --filter @campbrain/db migrate && \
  DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun --filter @campbrain/db seed:catalog
```

Expected: PG container `Up`; `✅ migrations + MV applied`; seed reports parks. No commit.

> **If any db/api test suite reports 0 tests / silently skips**, the local PG is unreachable through the expected socket. See the Task 6 shadow-Postgres caveat — a Homebrew `postgresql@18` on the host binds `127.0.0.1`/`::1` on `:5432` and shadows Docker. Resolve it before proceeding (`lsof -nP -iTCP:5432 -sTCP:LISTEN`; `brew services stop postgresql@18`).

---

## Task 1: `@campbrain/types` — `ScanRunKind` += 'digest'

**Files:** Modify `packages/types/src/alerts.ts`; Test `packages/types/test/alerts.test.ts` (or add a case to the existing types test file — check what exists).

- [x] **Step 1: Failing test** — assert `ScanRunKind.parse("digest")` succeeds and `ScanRunKind.options` includes `"digest"` (alongside the existing `proactive | alert | calendar`).
- [x] **Step 2: Run → fail.**
- [x] **Step 3: Implement** — in `packages/types/src/alerts.ts` change `export const ScanRunKind = z.enum(["proactive", "alert", "calendar"])` → add `"digest"`: `z.enum(["proactive", "alert", "digest", "calendar"])`. No barrel change (already exported).
- [x] **Step 4: Run → pass; typecheck; commit** `feat(types): ScanRunKind += 'digest'`.

---

## Task 2: `park_digests` table + migration `0007`

**Files:** Modify `packages/db/src/schema.ts`; Generated `packages/db/migrations/0007_*.sql`; Test `packages/db/test/park-digest.test.ts` (smoke — structural, extended in Task 4).

- [x] **Step 1: Add the table def** to `packages/db/src/schema.ts` (mirror `savedSearches`/`calendarSyncState` styles; `foreignKey`/`primaryKey`/`index`/`jsonb`/`timestamp` are already imported):
```ts
export const parkDigests = pgTable("park_digests", {
  provider: text("provider").notNull().references(() => providers.providerId),
  parkPageId: text("park_page_id").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }),         // max scannedAt across windows; null when no windows
  digest: jsonb("digest").notNull(),                        // the unfiltered ParkAvailabilityResponse
  siteClass: jsonb("site_class").notNull(),                 // Record<siteName, SiteClassEntry>; day-use omitted
  builtAt: timestamp("built_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.provider, t.parkPageId] }),
  foreignKey({
    columns: [t.provider, t.parkPageId],
    foreignColumns: [parks.providerId, parks.parkPageId],
  }).onDelete("cascade"),
]);
```
Rationale: PK leads with `provider` (provider-scoped-tables guardrail, matches the single-row `WHERE provider = $1 AND park_page_id = $2` read); the composite FK to `parks` with `ON DELETE CASCADE` (resolved sub-decision) drops a removed park's digest automatically.

- [x] **Step 2: Generate + apply** — from `packages/db`: `DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun run generate` then `… bun --filter @campbrain/db migrate`. Expected: `0007_*.sql` creates ONLY `park_digests` (+ the composite FK to `parks` + the PK) — **no ALTERs to existing tables**. Confirm with `\d park_digests`.

- [x] **Step 3: Smoke test** `packages/db/test/park-digest.test.ts` (mirror `packages/db/test/calendar.test.ts` harness — `dbReachable()` guard + `it.skipIf(!hasDb)`): insert a `park_digests` row (seed a `providers` + `parks` row first to satisfy the FK) with a minimal `{digest, siteClass}` JSONB, read it back, assert the JSONB round-trips. PASS not skipped.

- [x] **Step 4: Typecheck + commit** `feat(db): park_digests table + 0007 migration`.

---

## Task 3: `@campbrain/db` — `park_digest` queries (get + upsert)

**Files:** Create `packages/db/src/queries/park-digest.ts`; Modify `packages/db/src/index.ts` (barrel); extend `packages/db/test/park-digest.test.ts`.

The `SiteClassEntry` / `ParkAvailabilityResponse` types come from `@campbrain/core` (defined in Task 4 / already exported respectively) — import the types here (types-only; no runtime dep). Functions (mirror `calendar.ts` `upsert*`/`get*` style — typed row shape, `crypto.randomUUID` where needed, `sql` tagged template, `::text` casts on timestamps):

- `getParkDigest(db, provider, parkPageId)` → `{ digest: ParkAvailabilityResponse; siteClass: Record<string, SiteClassEntry>; asOf: string | null } | undefined` — single PK read: `SELECT digest, site_class, as_of::text FROM park_digests WHERE provider = $1 AND park_page_id = $2`. JSONB columns come back already-parsed from `postgres` — cast through the typed row shape (no `any`), like `calendar.ts` does.
- `upsertParkDigest(db, { provider, parkPageId, asOf, digest, siteClass })` → `ON CONFLICT (provider, park_page_id) DO UPDATE SET as_of = EXCLUDED.as_of, digest = EXCLUDED.digest, site_class = EXCLUDED.site_class, built_at = now()`. Serialize the JSONB with `${JSON.stringify(digest)}::jsonb` (confirm how `saved-searches.ts`/`calendar.ts` write JSONB and match it).

- [x] **Step 1: Failing test** (extend `park-digest.test.ts`): `upsertParkDigest` insert then `getParkDigest` returns the stored `digest`/`siteClass`/`asOf`; a second `upsertParkDigest` with a changed digest **conflict-updates** (not duplicates) and bumps `built_at`; provider-scoping (a different provider returns `undefined`); (FK cascade) deleting the `parks` row removes the digest row.
- [x] **Step 2: Run → fail** (functions don't exist).
- [x] **Step 3: Implement** `packages/db/src/queries/park-digest.ts`; barrel-export `export * from "./queries/park-digest";` in `packages/db/src/index.ts`.
- [x] **Step 4: Run → pass (not skipped); typecheck; commit** `feat(db): getParkDigest + upsertParkDigest queries`.

---

## Task 4: `@campbrain/core` — `buildSiteClassMap` + `filterDigest` (the correctness keystone)

**Files:** Create `packages/core/src/availability/digest.ts`; Modify `packages/core/src/index.ts` (barrel); co-located test `packages/core/src/availability/digest.test.ts`.

`map-transforms.ts` is **unchanged** and reused by both the scanner builder and the Worker fallback. The new module adds the two pure functions + the `SiteClassEntry` type.

**`SiteClassEntry`** (day-use omitted — day-use sites never enter the digest):
```ts
export interface SiteClassEntry {
  access: SiteAccess;          // from @campbrain/core site-classifier
  siteKind: SiteKind | null;
  isGroup: boolean;
  isEquestrian: boolean;
  isWalkUp: boolean;
}
```

**`buildSiteClassMap(entries: AvailabilityWindowEntry[], parkPageId?: string): Record<string, SiteClassEntry>`**
- Iterate every campground/site in `entries`; call `classifySite(site.name, cg.name, site.recGovCampsiteType, parkPageId)` **once per distinct site name**.
- **Omit day-use sites** (`info.isDayUse === true`) entirely — they are never in the digest.
- Thread `parkPageId` so `PARK_ACCESS_OVERRIDES` (e.g. Angel Island `468`) is respected — parity with `makeTaxonomyPredicate(filters, entries[0].parkPageId)`.
- Key by `site.name` (the digest arrays hold bare site-name strings). Last-write-wins is fine — `classifySite` is deterministic per name+cg, and the digest already dedupes by name.

**`filterDigest(digest: ParkAvailabilityResponse, siteClass: Record<string, SiteClassEntry>, filters: MapAvailabilityFilters, now?: Date): ParkAvailabilityResponse`** — the single Worker-side reducer (the ONLY place the predicate lives besides `classifySite`; do NOT reimplement `makeTaxonomyPredicate` regex here — look each site name up in `siteClass`):
- **Taxonomy predicate parity** with `makeTaxonomyPredicate` (`map-transforms.ts:131-148`), driven by `siteClass` lookups:
  - empty `access` = all; else keep only `access.includes(entry.access)`.
  - empty `kinds` = all **including NULL-kind sites**; selecting a kind **excludes NULL-kind sites** (`entry.siteKind === null || !kinds.includes(entry.siteKind)` → drop).
  - `hide` includes `group`/`equestrian`/`walk_up` → drop sites whose `isGroup`/`isEquestrian`/`isWalkUp` is true.
  - **Missing key = build bug → fail closed (drop the site).** Every digest site is guaranteed present in `siteClass` (both built from the same `entries` in the same scanner pass).
- Apply the predicate to `AvailableDateCampground.sites` **and** `.walkUpSites`, and to every `WeekendCampground.{sites3Night,sites2NightFri,sites2NightSat,sites1NightFri,sites1NightSat,walkUpSites}`.
- **walk_up hide:** when `hide` includes `walk_up`, drop `walkUpSites` arrays (parity with the `excludeWalkUp` path); otherwise keep them (never in the bookable `sites`).
- **Recompute `availableSiteCount`** from the filtered bookable `sites` on each `AvailableDateCampground`.
- **Drop empties** (parity with `buildParkAvailability`'s `.filter(...)` / `continue` rules): drop a date-campground with 0 bookable + 0 walk-up; drop a `WeekendCampground` whose `sites1NightFri`/`sites1NightSat`/`walkUpSites` are all empty; drop a date entry / weekend with no surviving campgrounds.
- **Date range (`from`/`to`):** reproduce `rangeStart`/`isInRange` from `map-transforms.ts:271-274,323-324` — `rangeStart = from && from > today ? from : today`; keep `nextAvailableDates` entries with `date >= rangeStart && (!to || date <= to)`; keep a `WeekendEntry` only if its `fridayDate` or `saturdayDate` is in range (drop `sites3Night`/`sites2NightFri`/`sites1NightFri` when the Friday is out of range, and `sites2NightSat`/`sites1NightSat` when the Saturday is out of range — then re-apply the empty-drop rule). `today = todayIso(now)`.
- **Recompute `earliestAvailableDate`** from the filtered `nextAvailableDates` (unfiltered stored value is stale under filters — keeps "Fully booked through / Next opening" copy in `ParkDetail.tsx` correct).
- Return a new `ParkAvailabilityResponse` (same `parkPageId`/`parkName`/`asOf`).

- [x] **Step 1: Failing test — the equivalence keystone.** Build a representative fixture `AvailabilityWindowEntry[]` for a multi-campground park with tent / hookup / cabin / NULL-kind / group / equestrian / walk-up / hike-in / boat-in sites across overlapping windows and at least one weekend + one weekday available date. Assert, across a **filter matrix** `F`:
```
buildParkAvailability(entries, F, PARK_ID)
  deepEquals
filterDigest(buildParkAvailability(entries, {}, PARK_ID), buildSiteClassMap(entries, PARK_ID), F)
```
Matrix `F`: `{}` (empty); each single `access` (drive_in / hike_in / boat_in); each single `kind` (tent / hookup / cabin — **assert NULL-kind exclusion**); each single `hide` (group / equestrian / walk_up); a `hide:['walk_up']` case (assert `walkUpSites` dropped); a combined `{access, kinds, hide}` case; a `{from, to}` date-range case (sub-window inside the horizon); and a case that exercises the weekend-tier path (a Friday-anchored weekend with 3N/2N/1N sites). **Pin `now`** (pass the same fixed `now` to both sides) so the `today`/`rangeStart` math is deterministic. This equivalence is the correctness proof that moving the filter out of the compute path changes nothing observable.
- [x] **Step 2: `buildSiteClassMap` unit test** — every distinct non-day-use site name present; day-use omitted; `PARK_ACCESS_OVERRIDES` respected (thread `parkPageId='468'` Angel Island, assert residual drive_in → hike_in on a name with no access keyword).
- [x] **Step 3: Run → fail** (functions don't exist).
- [x] **Step 4: Implement** `packages/core/src/availability/digest.ts`; barrel-export in `packages/core/src/index.ts` (`export * from "./availability/digest";`). Import `classifySite`, `SiteAccess`, `SiteKind` from `../catalog/site-classifier`; `MapAvailabilityFilters`, `ParkAvailabilityResponse`, `todayIso` etc. from `./map-transforms`; `AvailabilityWindowEntry` from `./types`.
- [x] **Step 5: Run → all pass; typecheck; commit** `feat(core): buildSiteClassMap + filterDigest (equivalence-tested vs buildParkAvailability)`.

---

## Task 5: Scanner — `runDigestBuild` phase, wired into `main.ts`

**Files:** Create `apps/scanner/src/run-digest-build.ts`; Modify `apps/scanner/src/main.ts`; Test `apps/scanner/test/run-digest-build.test.ts`.

**`run-digest-build.ts`** — `runDigestBuild({ db, provider?, getEntries?, log? })` (mirror `run-calendar-sync.ts` dep-injection + best-effort + `startScanRun`/`finishScanRun` style):
```ts
export interface DigestBuildDeps {
  db: Db;
  provider?: string;                                                   // default 'california-parks'
  getEntries?: (db: Db, ids: string[], provider?: string) => Promise<AvailabilityWindowEntry[]>;  // default getEntriesForParks; tests inject a fake
  log?: (m: string) => void;
}
export async function runDigestBuild(deps: DigestBuildDeps): Promise<void>;
```
Logic:
1. `runId = startScanRun(db, 'digest')`.
2. `parks = getCatalogParks(db)` → the every-park-with-sites set (dedupe to distinct `(providerId, parkPageId)` — `getCatalogParks` returns one row per campground, so collapse first).
3. For each park in **its own try/catch** (one park's parse/serialize error must not abort the rest; increment `errors`, `continue`):
   - `entries = getEntries(db, [parkPageId], provider)`.
   - `digest = buildParkAvailability(entries, {}, parkPageId)` — **NO taxonomy/date filters**.
   - `siteClass = buildSiteClassMap(entries, parkPageId)`.
   - `upsertParkDigest(db, { provider, parkPageId, asOf: digest.asOf, digest, siteClass })` — **per-park upsert, not one giant transaction** (a mid-run crash leaves already-built parks with fresh digests).
   - increment `parksScanned`.
4. `finishScanRun(db, runId, { status: errors > 0 ? 'ok' : 'ok', parksScanned, errors })` (status `ok` unless the whole phase threw — column reuse: `parksScanned` = parks digested, `errors` = per-park failures). Wrap the whole body in try/catch that records `status='error'` on an unexpected throw (parity with `runCalendarSync`).

**`main.ts`** — compose the phase **after** the proactive scan's MV refresh (already inside `runProactiveScan`) and **before** `runAlertScan`, in its own best-effort try/catch so a digest-build failure logs but does not kill the job (a stale digest is still served via D-E fallback):
```ts
// after: await finishScanRun(db, proactiveRunId, {...}); console.log("✅ proactive scan complete: ...")
try {
  await runDigestBuild({ db, log: (m) => console.log(m) });
  console.log("✅ digest build complete");
} catch (e: unknown) {
  console.error(`digest build threw unexpectedly: ${String(e)}`);
}
// then: await runAlertScan(...); ... runCalendarSync(...)
```
Placement rationale (spec D-D): the digest depends on the just-refreshed MV / just-upserted rows; running it right after keeps inputs maximally consistent, and putting it before the failure-prone alert/calendar I/O phases means a later failure never leaves the digest unbuilt.

- [x] **Step 1: Failing test** `run-digest-build.test.ts` (local PG + a **fake `getEntries`** injected via `deps.getEntries`, mirror `run-calendar-sync.test.ts` `dbReachable()` guard): seed 2 parks; a fake `getEntries` returns fixture entries for park A and **throws** for park B. Assert: `upsertParkDigest` ran for park A (row present via `getParkDigest`), park B's throw was isolated (`errors` counted, park A still built), and a `scan_runs` row `kind='digest'` was written with `parksScanned`/`errors`. Assert the stored digest for park A equals `buildParkAvailability(fixtureEntries, {}, 'A')`.
- [x] **Step 2: Run → fail.**
- [x] **Step 3: Implement** `run-digest-build.ts` + wire `main.ts`.
- [x] **Step 4: Run → pass (not skipped); typecheck; commit** `feat(scanner): runDigestBuild phase (precompute park availability digests)`.

---

## Task 6: Worker — `map.availability` digest read + fallback

**Files:** Modify `apps/api/src/trpc/routers/map.ts`; Test `apps/api/test/map-router.test.ts` (extend the existing suite).

Rewrite `availability` to the D-E logic (read digest → filter; else fallback-compute for that park only):
```ts
availability: publicProcedure.input(MapAvailabilityInputSchema).query(async ({ ctx, input }) => {
  const filters = { from: input.from, to: input.to, access: input.access, kinds: input.kinds, hide: input.hide };
  const row = await getParkDigest(ctx.db, input.provider ?? "california-parks", input.parkPageId);
  if (row) {
    return filterDigest(row.digest, row.siteClass, filters);   // fast path — no regex, no date-intersection
  }
  // Transient fallback (≤6 h before first digest, or a genuinely new/tiny park):
  const entries = await getEntriesForParks(ctx.db, [input.parkPageId], input.provider);
  return buildParkAvailability(entries, filters, input.parkPageId);
}),
```
- Import `getParkDigest` from `@campbrain/db` and `filterDigest` from `@campbrain/core` (both already-imported packages — **no new Worker deps**).
- Default the provider consistently with the builder (`"california-parks"`) so the read matches the stored row.
- Do **not** harden the fallback for big parks — the digest is the fix; the fallback only avoids a hard failure in the ≤6 h pre-build window (spec D-E guardrail).

- [x] **Step 1: Failing test** (extend `map-router.test.ts`, `it.skipIf(!hasDb)`): (a) **digest present** — seed a `park_digests` row via `upsertParkDigest` for a test park, call `caller.map.availability({parkPageId, access:[], kinds:[], hide:[]})`, assert the returned object equals `filterDigest(row.digest, row.siteClass, filters)` (i.e. it took the fast path — assert `parkPageId` matches and the shape is a `ParkAvailabilityResponse`); (b) **digest absent** — a parkPageId with no `park_digests` row falls back to `buildParkAvailability` and still returns a valid response **without throwing** (`nextAvailableDates`/`nextAvailableWeekends` present).
- [x] **Step 2: Run → fail** (endpoint still ignores the digest).
- [x] **Step 3: Implement** the router change.
- [x] **Step 4: Run → pass (not skipped); typecheck; commit** `fix(api): serve map.availability from precomputed digest (fixes error 1102)`.

> **No web changes:** `ParkAvailabilityResponse` shape is preserved (`asOf` stays the max `scannedAt`, computed by `buildParkAvailability` at build time and stored inside the JSONB), so `apps/web/src/features/map/components/ParkDetail.tsx:467` (`Cache as of {relativeTime(data.asOf)}`) and `use-park-availability.ts` are untouched.

---

## Task 7: Full-repo verification + deploy notes

- [x] **Run the full suite green:**
```bash
cd /Users/nimajelveh/campbrain && docker compose -f docker-compose.dev.yml up -d && \
  DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun --filter @campbrain/db migrate && \
  bun run typecheck && \
  DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun run test && \
  bun run build
```
Expected: typecheck 0 errors; all tests pass with **0 skipped** in the new suites.
- [x] **CRITICAL — confirm the PG-backed suites RUN, not skip.** The `packages/db/test/park-digest.test.ts`, `apps/scanner/test/run-digest-build.test.ts`, and `apps/api/test/map-router.test.ts` suites use a `dbReachable()` / `it.skipIf(!hasDb)` guard — **a silent skip looks like a pass.** Eyeball the reporter: the new digest tests must show as RUN. **If they skip** (or schema tests fail with `role "campbrain" does not exist`), a Homebrew `postgresql@18` service on the host is shadowing Docker's `:5432` — it binds `127.0.0.1`/`::1` specifically, so Docker's bind never wins. Check and resolve:
```bash
lsof -nP -iTCP:5432 -sTCP:LISTEN     # look for a non-docker (postgres/postgresql@18) listener
brew services stop postgresql@18     # then re-run the suite; confirm the digest tests RUN
```
Do not accept "all green" until the digest db/scanner/api suites are confirmed RUNNING.
- [x] **Wiring greps:** `grep -n "runDigestBuild" apps/scanner/src/main.ts` (phase wired before runAlertScan); `grep -n "getParkDigest\|filterDigest" apps/api/src/trpc/routers/map.ts` (read path + filter wired).
- [x] **Worker dry-run** — from `apps/api`: `bunx wrangler deploy --dry-run`. MUST build clean AND confirm **no new dependency** entered the bundle (`filterDigest`/`buildSiteClassMap` are in `@campbrain/core`, `getParkDigest` in `@campbrain/db` — both already imported; the Worker stays neon-only).
- [x] Confirm the tree is clean (no throwaway harness files).
- [x] Commit any residual verification-only changes: `chore: verify availability-digest slice (typecheck+test+build+wrangler dry-run)`.

**Deploy notes (manual, gate LIVE fix — NOT a code task):**
1. **Migration auto-applies to Neon:** the `0007` migration ships with the merge; the next scheduled scan runs `bun --filter @campbrain/db migrate` before scanning (per `.github/workflows/scan.yml`), so `park_digests` is created on Neon automatically — no manual migrate step needed.
2. **One scan populates the table:** after the migration lands, the next `Proactive Scan` (or a manual scanner run against Neon) runs `runDigestBuild`; before that, the D-E fallback serves (current behavior, still 1102-prone for Lake Perris until the digest exists).
3. **Worker deploy is manual:** `VITE_API_URL=https://campbrain-api.jelvehn.workers.dev bun --filter @campbrain/web build` then `bunx wrangler deploy` from `apps/api`. No new secrets, no new bindings.

**Acceptance evidence (after deploy + one scan):** `curl` the live endpoint for park **651** (Lake Perris, 426 sites — currently 6/6 failing) and park **469** (Samuel P. Taylor), **6× each**, and require **6/6 HTTP 200** on both (the whole point — 1102 is gone). Sample:
```bash
for i in $(seq 6); do
  curl -s -o /dev/null -w "651 try $i → %{http_code}\n" \
    'https://campbrain-api.jelvehn.workers.dev/trpc/map.availability?input=%7B%22parkPageId%22%3A%22651%22%2C%22access%22%3A%5B%5D%2C%22kinds%22%3A%5B%5D%2C%22hide%22%3A%5B%5D%7D'
done
# repeat for parkPageId 469 — both must be 6/6 200
```
(Confirm the exact tRPC GET query-string encoding against a working endpoint before running; the input is the URL-encoded `MapAvailabilityInput` JSON.)

---

## Self-Review

**Coverage:** `ScanRunKind += 'digest'` (T1) · `park_digests` table + FK cascade + migration (T2) · `getParkDigest`/`upsertParkDigest` (T3) · `buildSiteClassMap` + `filterDigest` with the **equivalence keystone** (T4) · `runDigestBuild` scanner phase, per-park isolation, wired before alert scan (T5) · Worker digest read + transient fallback (T6) · full-repo gates + shadow-PG caveat + live acceptance curl (T7). No web changes (response shape preserved).

**Correctness keystone:** T4's `buildParkAvailability(entries, F) ≡ filterDigest(buildParkAvailability(entries, {}), buildSiteClassMap(entries), F)` across the filter matrix proves moving the filter out of the compute path changes nothing observable; `filterDigest` is the ONLY place the predicate lives besides `classifySite` (no drift).

**Type consistency:** `SiteClassEntry` (T4, core) ← `buildSiteClassMap` (T4) → stored `site_class` JSONB (T2/T3) → `filterDigest` (T4) → Worker read (T6). `ScanRunKind='digest'` (T1) ← `startScanRun` in `runDigestBuild` (T5). `ParkAvailabilityResponse` (existing core type) is the digest payload end-to-end, unchanged for the web.

**Failure-safe (spec D-D/D-E):** own `scan_runs` kind `digest`, best-effort phase in `main.ts` (throw ≠ job kill), per-park try/catch + independent upsert, and a transient compute fallback so first-deploy and not-yet-built parks never hard-fail.

**Reuse:** the digest builder calls the existing `buildParkAvailability` verbatim; `getEntriesForParks`, `getCatalogParks`, `scan_runs` machinery, and the 2b-1/2b-3 scanner-phase pattern (`run-calendar-sync.ts`) are all reused. **No new dependency in any package** → Worker bundle stays neon-only (re-verified in T7's dry-run).

**Resolved sub-decision:** composite `parks` FK with `ON DELETE CASCADE` on `park_digests` (T2) — no `pruneOrphanDigests` build step.

---

## Acceptance evidence (recorded 2026-07-02, post-deploy + scan run 28626680106)

Live `map.availability` on the deployed Worker after migration 0007 auto-applied and `runDigestBuild` populated Neon:
- Park **651** (Lake Perris, 426 sites — 6/6 failing with error 1102 before the fix): **6/6 HTTP 200**, ~1.1–1.9s, 3.27MB digest served.
- Park **469** (Samuel P. Taylor, 56 sites — 4/6 failing before): **6/6 HTTP 200**, ~0.7–1.2s.
Error 1102 eliminated. ✅
