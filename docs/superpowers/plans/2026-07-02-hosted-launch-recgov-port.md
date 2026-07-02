# CampBrain Hosted Launch — Recreation.gov Provider Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. **Self-contained; read the cited legacy `src/providers/recreation-gov-provider.ts` for the adapter port and the existing `packages/core/src/providers/california-parks-provider.test.ts` for the test harness style.**
> **Verification boundary:** everything here is buildable + unit/integration-testable WITHOUT any live Rec.gov call. The Rec.gov `fetch` is replaced by a mocked `global.fetch` in unit tests (mirroring the legacy `test/recreation-gov-provider.test.ts`). NO live recreation.gov requests in any test. The LIVE federal-pin end-to-end (seed Neon → run the 6-hourly scanner → pins light up) is a manual owner check — do NOT block tasks on live Rec.gov data.

**Goal:** Make Recreation.gov a **live second availability provider** on the hosted stack — federal campgrounds appear on `/map` and `/explore` alongside CA State Parks, distinguished by the already-built federal pin glyph + "Recreation.gov" legend. Port the working legacy adapter into `@campbrain/core` (dropping the alert-path exports), seed the committed `data/catalog/recreation-gov.json` into Neon, generalize the GitHub-Actions scanner to run once per provider with a single MV refresh, and close the cross-provider `park_page_id` collision in three read queries. **No booking automation; polite polling only.**

**Architecture:** The ported `RecreationGovProvider` is a pure-logic adapter (`dayjs` + global `fetch`, Workers-safe) living in `@campbrain/core`. It models each 8-day-window contract as one calendar month (`generateCacheWindows` → `YYYY-MM-01`..EOM; `proactiveScanWindow` fetches the public month JSON once and returns a single-campground `AvailabilityWindowEntry`). `main.ts` calls the generalized `runProactiveScan` twice — CA parks, then Rec.gov — each in its own `scan_runs` bracket, sequential, with a **single** MV refresh after both. The DB read layer + `mv_available_stays` are already provider-agnostic; the only correctness change is scoping three group-by keys to `(provider_id, park_page_id)`.

**Tech Stack:** Bun · Turborepo · TS strict (no `any`) · Drizzle/Neon · `postgres` (seed) · tRPC v11 · React 19 (verify-only) · Vitest.

**Spec:** docs/superpowers/specs/2026-07-02-hosted-launch-recgov-port-design.md (decisions O-A..O-G).

**Env note (local PG for migrations/tests):** the db/scanner suites need `DATABASE_URL` inline: `postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain`. Bring Docker up first: `docker compose -f docker-compose.dev.yml up -d`.

**CLAUDE.md guardrails re-applied (this is NOT a booking bot):** no CAPTCHA bypass / queue evasion / automated checkout / login automation / proxy rotation; no new providers beyond Recreation.gov. Rec.gov scan stays fully sequential (`proactiveConcurrency = 1`), 1.5 s-spaced, 429-backoff `[15s,45s,90s]`, on the 6-hourly cron — within CLAUDE.md polling limits (normal ≥60–120 min). The "Book" link opens the plain Rec.gov campground page for manual booking (O-G). Parse-uncertainty debug payloads are written to the scanner debug dir (`SCAN_DEBUG_DIR`, surfaced as a GitHub Actions artifact), matching the CA provider's `onUnexpectedHtml` behavior — but note Rec.gov returns JSON, not HTML, so there is no HTML-snapshot path; a malformed-JSON facility surfaces as a `null` window (retry next cycle) and a 400/404 surfaces as `'unsupported'`.

---

## Task 0: Environment up + migrated + seeded (no commit)
```bash
cd /Users/nimajelveh/campbrain && docker compose -f docker-compose.dev.yml up -d && \
  DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun --filter @campbrain/db migrate && \
  DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun --filter @campbrain/db seed:catalog
```
Expected: PG `Up`; `✅ migrations + MV applied`; seed reports CA parks. No commit.

- [ ] **CRITICAL — confirm Docker's PG is not shadowed.** A Homebrew `postgresql@18` on the host binds `127.0.0.1:5432` + `::1:5432` and shadows Docker's `:5432`; when shadowed, PG-backed suites **silently SKIP** and schema tests fail with `role "campbrain" does not exist`. Before proceeding run `lsof -nP -iTCP:5432 -sTCP:LISTEN` and confirm the listener is `com.docker` / `docker` — not `postgres`. If Homebrew's is up: `brew services stop postgresql@18` (or stop it however it was started), then re-run Task 0.

---

## Task 1: Port `RecreationGovProvider` into `@campbrain/core` (adapter only, alert path dropped)
**Files:** Create `packages/core/src/providers/recreation-gov-provider.ts` (PORT of `src/providers/recreation-gov-provider.ts`); Create `packages/core/src/providers/recreation-gov-provider.test.ts`; Modify `packages/core/src/index.ts`.

Read the legacy file `src/providers/recreation-gov-provider.ts` in full first. This is a **port, not a rewrite** (O-A) — the class already implements the current `@campbrain/core` `AvailabilityProvider` signature (returns `AvailabilityWindowEntry | 'unsupported' | null`, sets `proactiveConcurrency = 1`, `batchDelayMs = 1_500`). Model the new test on `packages/core/src/providers/california-parks-provider.test.ts` and the legacy `test/recreation-gov-provider.test.ts` cases.

- [ ] **Step 1: Write the failing test** `recreation-gov-provider.test.ts` FIRST (import from `./recreation-gov-provider`, NO `.js`). Port these cases from `test/recreation-gov-provider.test.ts`, **dropping every `evaluateRecGovCandidate` / `ScanCandidate` case** (those are the alert path, not in scope):
  - `buildAvailabilityUrl` — contains `/campground/999/`, percent-encoded ISO `start_date=2026-08-01T00%3A00%3A00.000Z`.
  - `buildBookingUrl('232447')` → `https://www.recreation.gov/camping/campgrounds/232447`.
  - `monthStartForDate('2026-08-14')` → `'2026-08-01'`; `'2026-06-01'` → `'2026-06-01'`.
  - `generateCacheWindows`: one window per month, `-01` starts, EOM ends (`2026-06-01`→`2026-06-30`, `2026-07-01`→`2026-07-31`), a 180-day span (`2026-06-04`..`2026-12-01`) with no gaps.
  - `proactiveScanWindow` (mock `global.fetch`, restore it in `afterEach`): correct `AvailabilityWindowEntry` shape; `'Available'→'available'` else→`'unavailable'`; dates clipped to `[windowStart, windowEnd]`; **`recGovCampsiteType` passthrough** (add a fixture campsite with `campsite_type` and assert `sites[i].recGovCampsiteType`); `null` on network reject; `null` on non-429 non-ok (503); empty `campgrounds` array when `campsites` is `{}`; `'unsupported'` on 400 and on 404.
  - `fetchWithRetry(url, name, windowStart, [0,0,0])` — 429 once then success (assert 2 calls), **no real waits** (inject zero delays).
- [ ] **Step 2: Run → fail** (`bun --filter @campbrain/core test recreation-gov-provider` — file/module not found).
- [ ] **Step 3: Port the implementation.** Copy the legacy file, then:
  - Drop the `.js` extension from all imports; repoint types to `../availability/types` (`AvailabilityWindowEntry`, `CampgroundWindow`, `SiteDailyAvailability`), `../catalog/types` (`CampgroundCatalogEntry`), and `./availability-provider` (`AvailabilityProvider`, `CacheWindow`).
  - **DROP the alert-path exports** (O-A): remove the `import type { ScanCandidate, AvailabilityHit } from '../types/scanner.js'` line and the functions `requiredDates`, `isSiteAvailableForAllDates`, `evaluateRecGovCandidate`. There is no `../types/scanner` in `@campbrain/core` — it must not be referenced.
  - **KEEP:** `RecreationGovProvider` (with `generateCacheWindows`, `proactiveScanWindow`, `fetchWithRetry`, `proactiveConcurrency = 1`, `batchDelayMs = 1_500`), `buildAvailabilityUrl`, `buildBookingUrl`, `monthStartForDate`, `RecGovAvailabilityResponse`, `REC_GOV_RETRY_DELAYS_MS`.
  - Replace the legacy `console.warn`/`console.error` calls with the same behavior (they are fine in the scanner's Node context; keep them — the CA provider threads an `onUnexpectedHtml` callback, but Rec.gov's JSON path has no HTML snapshot, so console logging + `null`/`'unsupported'` returns are the debug surface). Do **not** add an `onUnexpectedHtml` param — the interface's `options` arg is optional and Rec.gov ignores it.
- [ ] **Step 4: Barrel-export** — add `export * from "./providers/recreation-gov-provider";` to `packages/core/src/index.ts`.
- [ ] **Step 5: Run → green** + `bun --filter @campbrain/core typecheck`. Commit `feat(core): port Recreation.gov availability provider (adapter only)`.

---

## Task 2: Fix the cross-provider `park_page_id` collision in the three read queries (O-F)
**Files:** Modify `packages/db/src/queries/search.ts` (`searchAvailableStays`, `findNextAvailableDates`); Modify `packages/db/src/queries/summary.ts` (`getParkAvailabilityCounts`); extend `packages/db/test/search.test.ts` + `packages/db/test/summary.test.ts`.

`searchAvailableStays` groups `parkMap` by `park_page_id` alone; `findNextAvailableDates` does `GROUP BY s.park_page_id, p.park_name`; `getParkAvailabilityCounts` does `GROUP BY s.park_page_id`. With two providers these merge two different parks sharing an id. CA ids are 3–4 digits and Rec.gov facility ids are 7–8 digits, so a real collision is unlikely — but this slice is what makes two providers coexist, so apply the **minimal correctness fix** (O-F). TDD with a synthetic same-`park_page_id`-different-provider fixture.

- [ ] **Step 1: Write failing tests FIRST** (read the existing `packages/db/test/search.test.ts` + `summary.test.ts` harness — they seed via `seedCatalog` + `upsertEntry` against local PG; PASS not skipped). Add a fixture that seeds **two providers with the SAME `park_page_id`** (e.g. `california-parks` park `500` and `recreation-gov` facility `500`) each with distinct sites + availability, then assert:
  - `searchAvailableStays` returns **two separate `SearchParkResult`s** (not one merged park), each with its own campgrounds/sites — assert on a `providerId` field in the result.
  - `findNextAvailableDates` returns **two rows** for the shared id (one per provider) — assert on `providerId`.
  - `getParkAvailabilityCounts` returns **two `ParkAvailabilityCount`s** for the shared id — assert on `providerId`.
- [ ] **Step 2: Run → fail** (current code merges to one).
- [ ] **Step 3: Fix `searchAvailableStays`** — SELECT `p.provider_id`; key `parkMap` by `` `${row.provider_id}:${row.park_page_id}` `` (not `row.park_page_id`); add `providerId: string` to `SearchParkResult` and set it. Keep the `ORDER BY` stable.
- [ ] **Step 4: Fix `findNextAvailableDates`** — SELECT `s.provider_id`; `GROUP BY s.provider_id, s.park_page_id, p.park_name`; add `providerId` to `NextAvailableResult` and carry it through.
- [ ] **Step 5: Fix `getParkAvailabilityCounts`** — for BOTH branches (the SQL `GROUP BY s.park_page_id` branch AND the `minNights` in-memory `perPark`/`bySite` grouping): SELECT/carry `s.provider_id`, group by `(provider_id, park_page_id)` (in the min-stay path, key `bySite`/`perPark` maps on `` `${providerId}:${parkPageId}` `` and store `providerId` on the entry). Add `providerId: string` to `ParkAvailabilityCount` and populate it.
- [ ] **Step 6: Run → green** + `bun --filter @campbrain/db typecheck`.
- [ ] **Step 7: Decide + handle the summary→pin web join (O-F downstream).** `apps/web/src/features/map/lib/filter-derivations.ts` `buildAvailByPark` keys the summary `Map` by `parkPageId` alone (line 33) and looks pins up by `parkPageId` alone (lines 53, 65); `getCatalogParks` already keys pins by `${provider_id}:${park_page_id}` (`packages/db/src/queries/catalog.ts`), and `ParkCount`/`ParkAvailabilitySummary` carry no `providerId`. This is the same collision one layer up. **Because `getParkAvailabilityCounts` now returns `providerId`, extend the web join to match:** add `providerId` to the web `ParkCount` type + the tRPC `summary` output (`MapSummary*`/`ParkAvailabilityCount` DTO in `packages/types`), key `buildAvailByPark` on `` `${providerId}:${parkPageId}` ``, and look pins up with `getParkType`-adjacent `${park.provider}:${park.parkPageId}`. If threading `providerId` through the web summary type balloons scope beyond a mechanical rename, STOP and re-plan with the Architect rather than half-wiring it — but the mechanical version is the expected path. Typecheck web after.
- [ ] **Step 8: Commit** `fix(db): scope park_page_id grouping by provider_id (cross-provider collision)`.

---

## Task 3: Parameterize `seedCatalog` and seed Rec.gov as bare park rows (O-C)
**Files:** Modify `packages/db/src/seed-catalog.ts`; extend `packages/db/test/*` (a seed test — reuse/extend the existing seed coverage or add a focused case).

Rec.gov catalog rows have `campgrounds: []`, so they seed as **park rows with zero campgrounds/sites** — the first successful scan upserts sites via `upsertEntry` (O-C). No placeholder-site hack. A Rec.gov park therefore has **no map pin until its first scan** (`getCatalogParks` INNER JOINs `sites`) — this is acceptable and mirrors a brand-new CA park; note it, add nothing.

- [ ] **Step 1: Write failing test FIRST** — seed with `{ providerId: 'recreation-gov', providerName: 'Recreation.gov', catalogPath: <recreation-gov.json> }` against local PG and assert: a `providers` row `'recreation-gov'` exists; Rec.gov `parks` rows exist with lat/lon; **zero `campgrounds`/`sites`** were inserted for a `campgrounds: []` park; and the existing CA rows are **undisturbed** (seed CA first, then Rec.gov, assert CA counts unchanged). PASS not skipped.
- [ ] **Step 2: Run → fail** (current signature is CA-hardcoded; `opts` has only `catalogPath`).
- [ ] **Step 3: Parameterize `seedCatalog`.** Change the signature to `seedCatalog(sql, opts: { providerId?: string; providerName?: string; catalogPath?: string } = {})`, defaulting `providerId='california-parks'`, `providerName='California State Parks'`, `catalogPath=defaultCatalogPath()` (back-compat: an argless call still seeds CA). Replace the module-level `PROVIDER_ID`/`PROVIDER_NAME` usages inside the function with the resolved opts. The `campgrounds.length === 0 → continue` path already handles bare parks — verify it seeds the park row before `continue` (it does: park insert precedes the `cgs.length === 0` guard). Add a `recreationGovCatalogPath()` helper (`../../../data/catalog/recreation-gov.json`).
- [ ] **Step 4: Extend the CLI `main()`** to seed BOTH catalogs sequentially: CA (default opts) then `seedCatalog(sql, { providerId: 'recreation-gov', providerName: 'Recreation.gov', catalogPath: recreationGovCatalogPath() })`; log both count lines.
- [ ] **Step 5: Run → green.** Re-run Task 0's seed step locally and confirm it now reports Rec.gov parks too (zero sites). `bun --filter @campbrain/db typecheck`. Commit `feat(db): seed Recreation.gov catalog as bare park rows`.

---

## Task 4: Generalize `runProactiveScan` to a `providerId` param (O-B)
**Files:** Modify `apps/scanner/src/run-proactive-scan.ts`; extend `apps/scanner/test/run-proactive-scan.test.ts` (mirror the existing scanner test harness; local PG + a fake `ScanProvider`).

`runProactiveScan` hardcodes `const PROVIDER_ID = "california-parks"` and calls `refreshMaterializedView` + `evictExpired` at the end of its single run. Two providers must share **one** MV refresh per cron (O-B). Chosen shape (per the spec's MV-refresh note): add `providerId` + `refreshMv` to `ScanDeps`; `main.ts` passes `refreshMv:false` for CA and `refreshMv:true` for Rec.gov (single refresh, after both).

- [ ] **Step 1: Write failing test FIRST** — `runProactiveScan({ providerId: 'recreation-gov', provider: fakeProvider, parks, db })` with an injected fake `ScanProvider` returning a synthetic monthly `AvailabilityWindowEntry`. Assert: `upsertEntry` wrote rows under `provider_id = 'recreation-gov'` (query the DB); the fake's `proactiveConcurrency`/`batchDelayMs` are honored (assert the injected `sleep` was called between batches / concurrency respected via a counter); and with `refreshMv: false` the MV is **not** refreshed (assert via a spy or by checking the MV is unchanged), with `refreshMv: true` it is.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.** Add `providerId?: string` (default `"california-parks"`) and `refreshMv?: boolean` (default `true`) to `ScanDeps`. Replace the hardcoded `PROVIDER_ID` constant usage in `upsertEntry(deps.db, result, PROVIDER_ID)` with the resolved `providerId`; include it in the opening log line. Wrap the `refreshMaterializedView` block so it runs only when `refreshMv` is true (keep `evictExpired` unconditional — it is provider-agnostic and cheap; running it in both calls is harmless). Keep the `deps.provider ?? new CaliforniaParksProvider()` default so an argless CA call is unchanged.
- [ ] **Step 4: Run → green** + `bun --filter @campbrain/scanner typecheck`. Commit `feat(scanner): parameterize runProactiveScan by providerId + refreshMv`.

---

## Task 5: Wire the second (Rec.gov) scan into `main.ts` with a single MV refresh (O-B)
**Files:** Modify `apps/scanner/src/main.ts`; extend `apps/scanner/test/*` (smoke the two-call structure if the harness allows; otherwise assert behavior via the run-proactive-scan test + a main-level structural check).

`main.ts` currently loads only `california-parks.json` and runs one proactive scan (with `refreshMv` implicitly true). Add a Rec.gov load + a second `runProactiveScan` call in its own `scan_runs` bracket, sequential after CA, with CA passing `refreshMv:false` and Rec.gov `refreshMv:true`.

- [ ] **Step 1: Add `loadRecGovParks()`** — mirror `loadCaParks()`: read `../../../data/catalog/recreation-gov.json`, `JSON.parse` as `{ parks: ParkCatalogEntry[] }`. Filter to scannable parks: `p.discoveryStatus !== 'failed'` (do NOT require `campgrounds.some(c => c.sites.length > 0)` — Rec.gov catalog parks have `campgrounds: []` by design; requiring sites would filter out every Rec.gov park). All catalog parks are candidates; the scan itself returns `'unsupported'` for facilities with no availability endpoint.
- [ ] **Step 2: Change the CA proactive call** to pass `refreshMv: false` and (optionally, for clarity) `providerId: 'california-parks'`.
- [ ] **Step 3: Add the Rec.gov proactive call** after the CA one, BEFORE `runAlertScan`: a new `startScanRun(db, 'proactive')` bracket, `runProactiveScan({ db, providerId: 'recreation-gov', provider: new RecreationGovProvider(), parks: loadRecGovParks(), refreshMv: true, log, onUnexpectedHtml: <same debug sink> })`, then `finishScanRun` with `status: 'ok'|'error'`. Import `RecreationGovProvider` from `@campbrain/core`. Keep the CA `0-cache-writes` outage warning per-provider if trivial, else leave CA's as-is (do not gate the whole job's exit code on the Rec.gov run — a Rec.gov outage must not fail the CA scan; wrap the Rec.gov bracket so its failure is logged + counted but does not throw past its own `finishScanRun`).
- [ ] **Step 4: Confirm the single MV refresh.** After both proactive runs, the MV has been refreshed exactly once (by the Rec.gov call's `refreshMv:true`). `evictExpired` runs in both — fine. `bun --filter @campbrain/scanner typecheck`.
- [ ] **Step 5: Run the scanner suite → green.** Commit `feat(scanner): run Recreation.gov scan as a second provider pass`.

---

## Task 6: Web verification — federal pins render for real Rec.gov data (VERIFY, code-change-gated)
**Files:** Read-only unless Task 2 Step 7 touched the web summary type. If it did, extend `apps/web/src/features/map/lib/filter-derivations.test.ts` for the `${providerId}:${parkPageId}` join.

The federal pin glyph + "Recreation.gov" legend + `provider` threading are **already built** (`map-pins.ts` `getParkType`/`GLYPHS.federal`/`PIN_LEGEND`; `ParkDetail`/`use-park-availability` thread `park.provider`; map/search tRPC inputs accept `provider`). No new `ProviderBadge` component. This task is a confirmation, upgraded to a real check ONLY where Task 2 Step 7 changed web code.

- [ ] **Step 1: If Task 2 Step 7 modified web code** (`ParkCount`/`buildAvailByPark`/summary DTO) — add/extend a `filter-derivations.test.ts` case proving the summary→pin `Map` join now keys on `${providerId}:${parkPageId}` and a federal park (`provider: 'recreation-gov'`) with a shared `parkPageId` does NOT pick up a CA park's counts. Run → green.
- [ ] **Step 2: Read-only confirmation** (always) — verify `getParkType('recreation-gov') === 'federal'` (it returns `'state'` only for `'california-parks'`), the `PIN_LEGEND` has the `glyph-federal` "Federal · Recreation.gov" row, and the map/search routers accept `provider: 'recreation-gov'`. No visual `preview_*` pass is required unless Step 1 changed rendering; if it did, run the existing map-page dev-stub visual harness and confirm a seeded `recreation-gov` fixture park renders the federal glyph with correct counts.
- [ ] **Step 3: Commit** only if code changed: `test(web): federal-provider summary→pin join`. Otherwise no commit (verification only).

---

## Task 7: Full-repo verification + cleanup
- [ ] **`bun run typecheck`** — all packages green.
- [ ] **`bun run test`** with local PG up: `DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun run test`. **The db/scanner suites MUST RUN, not skip** — eyeball the new O-F collision tests (Task 2), the Rec.gov seed test (Task 3), and the `providerId` proactive-scan test (Task 4) in the output; each must report as run + passed, NOT skipped. **If any PG suite skipped:** Docker's `:5432` is shadowed — run `lsof -nP -iTCP:5432 -sTCP:LISTEN`, stop the Homebrew `postgresql@18` listener, and re-run. A `role "campbrain" does not exist` schema-test failure is the same shadowing symptom.
- [ ] **`grep -n "RecreationGovProvider" apps/scanner/src/main.ts`** (Rec.gov wired) and **`grep -n "recreation-gov" packages/db/src/seed-catalog.ts`** (seed wired).
- [ ] **`bun run build`** — Vite web build + all package builds clean.
- [ ] **Worker dry-run** (`cd apps/api && bunx wrangler deploy --dry-run`) — MUST build clean AND confirm **no new heavy deps leaked into the Worker bundle**. The Rec.gov adapter is `@campbrain/core` (Workers-pure: `dayjs` + global `fetch` only) and runs in the GitHub-Actions scanner, NOT the Worker — but `@campbrain/core` IS imported by the Worker, so confirm the bundle size/deps did not grow (no `googleapis`, no new Node-only packages). String literals containing "recreation.gov" in the bundle are fine (URL builders); package code is not.
- [ ] **Confirm the tree is clean** — no throwaway harness/fixtures left; `git status` shows only intended changes (the pre-existing untracked `.claudeignore` is the user's, ignore it).

---

## Manual setup the USER provides (gates LIVE verification + deploy — NOT a code task)
1. **Seed the Rec.gov catalog into Neon** (one-time; the JSON is already in the repo): run the extended `seed:catalog` against Neon with `?sslmode=require` so the `providers` row `'recreation-gov'` + the Rec.gov `parks` rows exist. Until this runs, the scanner has no Rec.gov parks and no federal pins appear.
2. **NO new secret required for the live scan (O-D).** The Rec.gov availability endpoint (`recreation.gov/api/camps/availability/campground/{id}/month`) is the public website API — the GitHub-Actions scanner needs **no new secret** to fetch federal availability. `DATABASE_URL` is already set.
3. **`RIDB_API_KEY` is OPTIONAL — deferred, catalog-regeneration only (O-D).** Only relevant if the owner later wants to re-discover/expand `recreation-gov.json` via the RIDB facilities API. This slice does NOT build a hosted discovery CLI and does NOT require the key. If added, register a free key at `https://ridb.recreation.gov/` and add it as a GitHub Actions secret; the (future) discovery CLI clean-skips with a log line when unset.
4. **First-scan lag (O-C):** federal pins/availability appear only **after the first successful 6-hourly scan** populates sites. Expect a gap between seeding and pins — a Rec.gov park has no pin until its first scan (pins come from `getCatalogParks`, which INNER JOINs `sites`).

## Deferred / out of scope
- Wiring Rec.gov into the **alert scanner** / saved-search matching (Phase 2 alert path; needs the dropped `evaluateRecGovCandidate` + a saved-search `provider` field).
- A **hosted RIDB catalog-refresh CLI** — the committed seed JSON is the source.
- Rec.gov-specific booking-URL date pre-selection (O-G) — the "Book" link opens the plain campground page; `injectBookingDates` is a safe no-op on Rec.gov URLs. The optional one-line federal guard on `injectBookingDates` is a nice-to-have, not planned here.
- Per-loop campground breakdown (facilities with sub-loops under one id show mixed sites — carried-forward legacy limitation); `orgName` pin sub-categorisation; lottery/SMS/Slack roadmap items.

## Self-Review
**Coverage:** core adapter port + unit tests, alert path dropped (T1) · O-F cross-provider collision fix in 3 read queries + DTOs + web join (T2) · `seedCatalog` parameterization + bare Rec.gov rows (T3) · `runProactiveScan` providerId/refreshMv (T4) · second Rec.gov scan in `main.ts`, single MV refresh (T5) · web federal-pin verify, code-gated (T6) · full-repo gates + Worker-bundle-clean (T7). Live Rec.gov scan + federal-pin end-to-end explicitly deferred to the owner's manual check.
**Type consistency:** `AvailabilityWindowEntry`/`SiteDailyAvailability.recGovCampsiteType` (T1) → `upsertEntry`'s `classifySite` (already wired) → `mv_available_stays` (provider-agnostic, no change); `providerId` added to `SearchParkResult`/`NextAvailableResult`/`ParkAvailabilityCount` (T2) flows to the summary tRPC output + web `ParkCount`/`buildAvailByPark` (T2 Step 7 / T6).
**Worker-bundle safety:** the ported adapter uses only `dayjs` + global `fetch` (Workers-pure); it runs in the GitHub-Actions scanner, not the Worker; re-verified in T7's dry-run (no `googleapis`, no new Node deps).
**Data isolation:** all writes/reads stay provider-scoped by composite `(provider_id, park_page_id)`; O-F (T2) closes the last place two providers could bleed together (three group-by keys + the web summary→pin join). No schema migration, no MV rewrite, no new UI component.
**Guardrails:** sequential 1.5 s-spaced polling, 429 backoff `[15s,45s,90s]`, 400/404→`'unsupported'`, public endpoint, `User-Agent` header, manual booking only, no new providers — all preserved by the port (T1) and honored by the scanner (T4/T5).
