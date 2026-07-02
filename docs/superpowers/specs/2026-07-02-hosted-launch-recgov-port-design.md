# CampBrain Hosted Launch — Recreation.gov Provider Port Design

**Status:** drafted 2026-07-02 — **REVIEW + the "Manual setup you must provide" section before implementation.** Live Rec.gov data is gated on the owner adding a `RIDB_API_KEY` GitHub Actions secret **only if** the RIDB discovery path is chosen; the seeded catalog + availability scan work with **no key** (see O-D and Manual setup).
**Branch:** `hosted-launch`. Closes the Phase-1a scope cut ("Recreation.gov provider — defer to a later pass; CA-parks first" — `docs/superpowers/plans/2026-06-19-hosted-launch-phase1a-domain-core.md` line 28) and advances the Phase 2 feature-parity exit in `docs/superpowers/specs/2026-06-17-hosted-launch-design.md`.

## Goal

Make Recreation.gov (federal campgrounds) a **live second availability provider** on the hosted stack, so its campgrounds appear on the map and `/explore` alongside CA State Parks, distinguished by the already-built "federal" pin glyph and legend. Port the working legacy adapter (`src/providers/recreation-gov-provider.ts`) and its month→8-day-window model into `@campbrain/core`, seed the existing `data/catalog/recreation-gov.json` into Neon, and interleave a **polite** Rec.gov scan into the GitHub-Actions scanner. No booking automation; polling stays within CLAUDE.md limits.

## What already exists (the port is smaller than it looks)

An audit of the `hosted-launch` tree found the multi-provider substrate is **mostly already in place** — the Phase-1 CA port was built provider-agnostic in anticipation of this work:

| Layer | State on `hosted-launch` | Implication |
|---|---|---|
| DB schema | All tables keyed on composite `(provider_id, park_page_id)`; `providers` FK exists | No schema change for a second provider |
| `mv_available_stays` (`packages/db/src/mv.ts`) | Groups by `s.provider_id`; joins on `p.provider_id = s.provider_id` (no `'california-parks'` literal) | Provider-agnostic already; **no MV change** |
| DB reads (`getEntriesForParks`, `getParkAvailabilityCounts`, `searchAvailableStays`, `getCatalogParks`, `findNextAvailableDates`) | No `provider_id = 'california-parks'` filters; scoped by composite keys | Reads return mixed providers for free |
| `AvailabilityProvider` interface (`packages/core/src/providers/availability-provider.ts`) | Already declares `proactiveConcurrency`, `batchDelayMs`, and the `'unsupported'` return, with doc comments citing Rec.gov ("Rec.gov is strict — use 1", "Rec.gov needs 2000ms") | **The interface was pre-shaped for Rec.gov** |
| `upsertEntry` (`packages/db/src/queries/upsert.ts`) | Threads `site.recGovCampsiteType` into `classifySite(...)`; takes `providerId` param | Rec.gov classification path is wired |
| `classifySite` (`packages/core/src/catalog/site-classifier.ts`) | Prefers the Rec.gov `campsite_type` field | Already supports Rec.gov |
| Map UI (`apps/web/src/features/map`) | `getParkType(provider)` → `'state' | 'federal'`; separate federal pin glyph; legend row "Federal · Recreation.gov"; `ParkDetail`/`useParkAvailability` thread `park.provider`; map + search tRPC inputs accept `provider` | **The provider badge/styling work is DONE** — no new `ProviderBadge` component (unlike the legacy plan) |
| Catalog seed data | `data/catalog/recreation-gov.json` exists, populated by the legacy public-search discovery (CA campgrounds, `campgrounds: []`, coords, `defaultBookingRule`) | Seed data ready; discovery need not be re-run to ship |

**What is genuinely missing (this slice):**
1. `RecreationGovProvider` does not exist in `@campbrain/core` (only in legacy `src/`).
2. `apps/scanner/src/run-proactive-scan.ts` is **single-provider** — it hardcodes `const PROVIDER_ID = "california-parks"` and takes one `provider` + one `parks` list.
3. `apps/scanner/src/main.ts` loads only `california-parks.json`.
4. `packages/db/src/seed-catalog.ts` is CA-hardcoded (`PROVIDER_ID`/`PROVIDER_NAME`/`defaultCatalogPath`); the Rec.gov catalog is never seeded into Neon.
5. Rec.gov catalog rows have `campgrounds: []` (bare facility, no per-site catalog), so they are seeded as **park rows with zero sites** and only gain sites at scan time — this needs an explicit decision (O-C).
6. Three read queries group by `park_page_id` without `provider_id` — a latent cross-provider collision (O-F).

## Resolved decisions

- **O-A = Port the legacy adapter into `@campbrain/core`, not rewrite.** Copy `src/providers/recreation-gov-provider.ts` → `packages/core/src/providers/recreation-gov-provider.ts`, drop `.js` import extensions, repoint types to `../availability/types` + `../catalog/types` + `./availability-provider`, and **drop the alert-path exports** (`ScanCandidate`/`AvailabilityHit` imports, `evaluateRecGovCandidate`, `isSiteAvailableForAllDates`, `requiredDates`) — those belong to the Phase-2 alert scanner, not this map/scan slice. Keep: `RecreationGovProvider` (with `generateCacheWindows` + `proactiveScanWindow` + `fetchWithRetry`), `buildAvailabilityUrl`, `buildBookingUrl`, `monthStartForDate`, `RecGovAvailabilityResponse`, `REC_GOV_RETRY_DELAYS_MS`. The class already implements the current `@campbrain/core` `AvailabilityProvider` interface signature (it returns `AvailabilityWindowEntry | 'unsupported' | null` and sets `proactiveConcurrency = 1`, `batchDelayMs = 1_500`).

- **O-B = Generalize `runProactiveScan` to be provider-parameterized; run it once per provider.** Replace the hardcoded `PROVIDER_ID` with a `providerId: string` field on `ScanDeps` (defaulting to `"california-parks"` for back-compat). `main.ts` then calls `runProactiveScan` **twice** — once for CA parks (existing provider + CA catalog), once for Rec.gov (`new RecreationGovProvider()` + Rec.gov catalog) — each with its own `startScanRun`/`finishScanRun` bracket. Sequential, not concurrent, so the two providers never contend for the DB or hammer both hosts at once. This is a smaller, safer change than a single interleaved loop and keeps each provider's cadence/concurrency independent (the scanner already reads `provider.proactiveConcurrency` / `provider.batchDelayMs`).

- **O-C = Seed Rec.gov catalog as bare park rows (no sites); the scan discovers sites.** The Rec.gov availability API returns the full per-site grid, so per-site catalog data is not needed up front. Extend `seed-catalog.ts` to also seed `recreation-gov.json`: insert the `providers` row (`'recreation-gov'`, "Recreation.gov") + `parks` rows (with lat/lon). Parks with `campgrounds: []` seed **zero campgrounds/sites** — that is fine; the first successful `proactiveScanWindow` upserts the campground + sites via `upsertEntry`. **Consequence:** a Rec.gov park has **no map pin until its first successful scan** (pins come from `getCatalogParks`, which INNER JOINs `sites`). This is acceptable for a background-populated cache and mirrors how a brand-new CA park behaves. Note it in the plan; do not add a placeholder-site hack.

- **O-D = Runtime availability scan needs NO API key; RIDB is only for (optional, offline) catalog discovery.** This reconciles a discrepancy between the legacy design doc (assumed RIDB for everything) and the shipped legacy code:
  - The **availability** endpoint `https://www.recreation.gov/api/camps/availability/campground/{id}/month?start_date=...` is the **public website API — no key** (the ported `proactiveScanWindow` uses only a `User-Agent` header). So the live scan runs with **no secret**.
  - The **catalog** was populated by the legacy **public search API** (`discover-recreation-gov.ts`, no key) and is already committed as `recreation-gov.json`. Re-discovery is **not required to ship**.
  - `RIDB_API_KEY` is therefore **optional** and only relevant if the owner later wants to **regenerate/expand** the catalog via the RIDB facilities API (`ridb.recreation.gov`). We port the availability scan now; catalog re-discovery-on-hosted is **out of scope** for this slice (the seed JSON is the source). The scanner **must not require** `RIDB_API_KEY` to run.
  - **Skip pattern for the (deferred) discovery path:** if/when a hosted catalog-refresh CLI is added, it clean-skips with a log line when `RIDB_API_KEY` is unset — mirroring `run-calendar-sync.ts` lines 30-33 (`if (!clientId || !clientSecret) { log("... skipped: ... not set"); return; }`). This slice does **not** add that CLI; it only documents the pattern so the Manual-setup section is honest about the one optional secret.

- **O-E = Polite cadence, unchanged from the legacy adapter.** The ported `RecreationGovProvider` sets `proactiveConcurrency = 1` (fully sequential — recreation.gov CloudFront burst-blocks concurrent requests) and `batchDelayMs = 1_500` (≈30 req/min). `fetchWithRetry` backs off on HTTP 429 with `[15s, 45s, 90s]` and treats 400/404 as permanently `'unsupported'` (wilderness/permit facilities with no campground endpoint). The scanner already honors `provider.proactiveConcurrency`/`provider.batchDelayMs`. This satisfies CLAUDE.md polling limits (normal ≥60–120 min; the whole scan runs on the 6-hourly GitHub-Actions cron). **No change** to these numbers — they are the values confirmed to work reliably against Rec.gov.

- **O-F = Fix the cross-provider `park_page_id` collision in the three read queries.** `searchAvailableStays` (groups `parkMap` by `park_page_id` alone), `findNextAvailableDates` (`GROUP BY s.park_page_id, p.park_name`), and `getParkAvailabilityCounts` (`GROUP BY s.park_page_id`) key on `park_page_id` without `provider_id`. With two providers this can merge two different parks that share an id. CA ids are 3–4 digits; Rec.gov facility ids are 6–8 digits, so a **collision is very unlikely** in practice — but the fix is cheap and correct: include `provider_id` in the GROUP BY / result key and carry it through to the DTO where a downstream consumer needs it. **Decision: apply the minimal correctness fix** (add `provider_id` to the grouping key in these three queries) as part of this slice, since we are the change that makes two providers coexist. The map summary pin-lighting keys pins by `parkPageId` in the web layer too — verify `getParkAvailabilityCounts` consumers tolerate the same `parkPageId` appearing under two providers, or extend the result to `{ providerId, parkPageId }`.

- **O-G = Rec.gov booking URL: link to the campground page, do not fake date params.** Rec.gov booking URLs are `https://www.recreation.gov/camping/campgrounds/{id}` (from `buildBookingUrl`), a plain campground page that (unlike ReserveCalifornia) does **not** document `date`/`night` query-param pre-selection. The web `injectBookingDates` helper (`apps/web/src/lib/booking-url.ts`) appends `date`/`night` params via `URL.searchParams.set` — harmless on a Rec.gov URL (Rec.gov ignores unknown params), but misleading. **Decision:** keep `injectBookingDates` as-is (it is a safe no-op on Rec.gov), and store the plain campground URL as `bookingUrl` so the "Book" link opens the correct campground page. Do **not** build a Rec.gov-specific date-injection path in this slice (Rec.gov's date selection is an in-app calendar, not URL-driven). Optionally: skip the `injectBookingDates` call for federal parks so no spurious params are appended — a one-line guard keyed on `park.provider !== 'california-parks'`; flag as a nice-to-have for the plan, not a blocker.

## Architecture

```
data/catalog/recreation-gov.json ──seedCatalog(providerId='recreation-gov')──► Neon (parks rows, 0 sites)
                                                                                      │
GitHub Actions cron (0 */6 * * *) → apps/scanner/src/main.ts
   ├─ runProactiveScan({ providerId:'california-parks', provider: new CaliforniaParksProvider(), parks: caParks })   [existing]
   └─ runProactiveScan({ providerId:'recreation-gov',   provider: new RecreationGovProvider(),   parks: recParks })  [NEW]
                                                                                      │
              proactiveScanWindow(facilityId, monthWindow) → GET recreation.gov/api/.../month  (public, no key)
                                                                                      │
                                        upsertEntry(db, entry, 'recreation-gov')  → parks/campgrounds/sites/availability
                                                                                      │
                                              refreshMaterializedView(db)  (once, after both scans)
                                                                                      │
                       map tRPC (catalog/availability/summary) + search tRPC  → mixed CA + federal results
                                                                                      │
                          apps/web map: federal pin glyph + "Recreation.gov" legend (already built)
```

### The month → 8-day-window impedance match (the core adapter idea)

The scanner/DB model an entry as a **park × one 8-day window** with a per-site per-day grid. Rec.gov's API returns a **full calendar month** per call. The legacy adapter resolves this cleanly and the port preserves it:

- `generateCacheWindows(rangeStart, rangeEnd)` returns **one window per calendar month** (`windowStart = YYYY-MM-01`, `windowEnd = end of month`), stepping back to the 1st of the month containing `rangeStart`. These are naturally-sized windows, not 8-day windows — the `CacheWindow` contract only requires `{ windowStart, windowEnd }`, and `scan_windows` stores whatever range it is given. So a Rec.gov "window" is a month; a CA "window" is 8 days. Both coexist in `scan_windows` because they are keyed by `(provider_id, park_page_id, window_start)`.
- `proactiveScanWindow(facilityId, monthWindow, ...)` fetches that month's JSON once, groups `campsites` by their `site` display name, maps `'Available' → 'available'` / everything-else → `'unavailable'`, clips each site's dates to `[windowStart, windowEnd]`, and returns a single-campground `AvailabilityWindowEntry`. Any night-count query (1N/2N/3N) is answered at **read time** from the stored grid, exactly as for CA — no per-night fetches.
- **`recGovCampsiteType`** is carried onto each `SiteDailyAvailability` when present, so `upsertEntry`'s `classifySite(..., site.recGovCampsiteType, ...)` uses the type field (already wired).

Because the read layer and MV are provider-agnostic and TTL/staleness key on `window_start` (a month-start date for Rec.gov), the existing `ttlMinutes`/`evictExpired`/`findStaleWindows`/overlap-dedupe logic all apply unchanged — a monthly window simply has a longer lifetime bucket than an 8-day one.

## Code organization

```
packages/core/src/providers/recreation-gov-provider.ts   CREATE  PORT of src/providers/recreation-gov-provider.ts
                                                                  (drop .js; repoint types; DROP alert-path exports —
                                                                   ScanCandidate/AvailabilityHit, evaluateRecGovCandidate,
                                                                   isSiteAvailableForAllDates, requiredDates). Keep the
                                                                   class + URL builders + response type + retry delays.
packages/core/src/providers/recreation-gov-provider.test.ts CREATE  generateCacheWindows (monthly, no gaps/dupes) +
                                                                   proactiveScanWindow (mocked fetch: shape, status map,
                                                                   date clipping, 'unsupported' on 400/404, null on error,
                                                                   429 retry with injected [0,0,0] delays).
packages/core/src/index.ts                               MODIFY  export * from "./providers/recreation-gov-provider"
packages/db/src/seed-catalog.ts                          MODIFY  parameterize: seedCatalog(sql, { providerId, providerName,
                                                                  catalogPath }); default = CA. CLI seeds BOTH catalogs.
packages/db/src/queries/search.ts                        MODIFY  O-F: include provider_id in parkMap key (searchAvailableStays)
                                                                  and GROUP BY (findNextAvailableDates); carry providerId in DTOs.
packages/db/src/queries/summary.ts                       MODIFY  O-F: GROUP BY (provider_id, park_page_id); result carries providerId.
apps/scanner/src/run-proactive-scan.ts                   MODIFY  O-B: add providerId to ScanDeps (default 'california-parks');
                                                                  use it in upsertEntry(...) and the log line; MV refresh
                                                                  stays a caller concern (see main.ts change).
apps/scanner/src/main.ts                                 MODIFY  load recreation-gov.json (filter to scannable parks);
                                                                  call runProactiveScan a 2nd time with the Rec.gov provider +
                                                                  its own scan_runs bracket; refresh MV once after BOTH.
apps/web/src/features/map/... / search router            VERIFY  provider already threaded (no change expected);
                                                                  confirm getParkType/legend render federal pins for real data.
```

> **MV-refresh sequencing (O-B detail):** today `runProactiveScan` calls `evictExpired` + `refreshMaterializedView` at the end of its single run. When called twice, refreshing the MV between the two providers is wasteful and briefly shows partial federal data. **Recommend:** add a `refreshMv?: boolean` (default true) to `ScanDeps`; `main.ts` passes `false` for the first (CA) call and `true` for the second (Rec.gov) call, OR moves `evictExpired`+`refreshMaterializedView` out of `runProactiveScan` into `main.ts` after both scans. Decide the exact shape in the plan; either keeps a single MV refresh per cron.

## What ports vs. what's net-new

- **Port (legacy `src/providers/recreation-gov-provider.ts`):** `RecreationGovProvider.generateCacheWindows` (monthly windows), `proactiveScanWindow` (month JSON → `AvailabilityWindowEntry`, status map, date clipping, `recGovCampsiteType` passthrough), `fetchWithRetry` (429 backoff, 400/404 → `'unsupported'`), `buildAvailabilityUrl` (percent-encoded ISO), `buildBookingUrl`, `monthStartForDate`, `RecGovAvailabilityResponse`, `REC_GOV_RETRY_DELAYS_MS`, `proactiveConcurrency = 1`, `batchDelayMs = 1_500`.
- **Net-new / modified:** `providerId` parameterization of `runProactiveScan` + the second scan call in `main.ts`; `seedCatalog` parameterization + Rec.gov seed invocation; the O-F provider-scoping fix in three read queries; the Rec.gov unit test file.
- **Explicitly NOT ported (Phase 2, alert path):** `evaluateRecGovCandidate` and its helpers, the `scan(target, candidates)` alert method, any `Target`/`ScanCandidate`/`AvailabilityHit` coupling. The hosted alert scanner (`apps/scanner/src/run-alert-scan.ts`) is a separate, saved-search-driven path; wiring Rec.gov into alerts is out of scope here.
- **Explicitly NOT built (unlike the legacy plan):** a `ProviderBadge` React component / `PROVIDER_BADGES` map — the hosted map already renders federal pins + a "Recreation.gov" legend via `getParkType`. A hosted RIDB catalog-discovery CLI — out of scope (seed JSON is the source).

## Guardrails (this is NOT a booking bot)

- **No new providers** beyond Recreation.gov. No CAPTCHA bypass, queue evasion, automated checkout, login automation, proxy rotation.
- **Polite scraping only:** Rec.gov scan is fully sequential (`proactiveConcurrency = 1`), 1.5 s between calls, 429-backoff, on a 6-hourly cron. The public availability endpoint is the same one the website calls; a `User-Agent` identifying the tool is sent. No high-frequency abusive polling.
- **No booking automation:** the "Book" link opens the Rec.gov campground page for the user to complete the reservation manually (O-G).

## Testing

- **core (unit, `@campbrain/core`):** port the legacy `test/recreation-gov-provider.test.ts` cases for `generateCacheWindows` (one window per month, `-01` starts, EOM ends, 180-day span no gaps) and `proactiveScanWindow` with a **mocked `global.fetch`**: correct `AvailabilityWindowEntry` shape, `'Available'→'available'` / else→`'unavailable'`, date clipping to the window, `recGovCampsiteType` passthrough, `null` on network error, `'unsupported'` on 400/404, and a 429-retry case using `fetchWithRetry(..., [0,0,0])` to skip real waits. (Live Rec.gov is not unit-coverable — mock it.)
- **db (local PG):** `seedCatalog` with `providerId='recreation-gov'` inserts the provider + park rows (0 sites) and does not disturb CA rows; `upsertEntry(db, recEntry, 'recreation-gov')` creates campground+sites+availability under the correct provider namespace and `mv_available_stays` (after refresh) returns rows carrying `provider_id='recreation-gov'`. O-F: a synthetic same-`park_page_id`-different-provider fixture proves `searchAvailableStays`/`findNextAvailableDates`/`getParkAvailabilityCounts` no longer merge the two.
- **scanner (unit, mocked provider):** `runProactiveScan({ providerId:'recreation-gov', provider: fakeProvider, parks })` upserts with `'recreation-gov'` and honors `proactiveConcurrency`/`batchDelayMs`; `main.ts`'s two-call structure is smoke-tested by asserting both providers' `startScanRun`/`finishScanRun` fire and the MV refreshes once.
- **web (controller/render):** confirm a federal-provider park renders the federal pin glyph + "Recreation.gov" legend and that `ParkDetail` fetches with `provider='recreation-gov'`. (Existing map tests already exercise `getParkType`; add a fixture park with `provider:'recreation-gov'` if not present.)
- **Manual end-to-end (post-deploy):** seed Rec.gov into Neon, run the scanner once, confirm real federal pins light up on the live map with correct availability and a working Book link.

## Manual setup YOU must provide

1. **Seed the Rec.gov catalog into Neon** (one-time; the JSON is already in the repo): run the extended `seedCatalog` against Neon with `?sslmode=require` so the `providers` row `'recreation-gov'` + the Rec.gov `parks` rows exist. Until this runs, the scanner has no Rec.gov parks to scan and no federal pins appear.
2. **(No secret required for the live scan.)** The Rec.gov availability API is public — the GitHub-Actions scanner needs **no new secret** to fetch federal availability. `DATABASE_URL` is already set.
3. **`RIDB_API_KEY` is OPTIONAL — only if you later re-discover/expand the catalog.** If the owner wants to regenerate `recreation-gov.json` (more or different CA facilities) via the RIDB facilities API, register for a free key at `https://ridb.recreation.gov/` and add it as a **GitHub Actions secret** (`RIDB_API_KEY`). The (deferred) discovery CLI clean-skips with a log line when it is unset. This slice does **not** build that CLI and does **not** require the key to run the scan.
4. **First scan lag:** federal pins/availability appear only **after the first successful 6-hourly scan** populates sites (O-C). Expect a gap between seeding and pins.

## Deferred / out of scope

- Wiring Rec.gov into the **alert scanner** / saved-search matching (Phase 2 alert path; needs `evaluateRecGovCandidate` + the saved-search `provider` field).
- A **hosted RIDB catalog-refresh CLI** (re-discovery on the hosted stack) — the committed seed JSON is the source for now.
- **Per-loop campground breakdown:** the adapter groups all of a facility's campsites under one campground card. Facilities with sub-loops under a single id show mixed sites (a known legacy limitation, carried forward).
- Rec.gov-specific booking-URL date pre-selection (O-G) and any additional federal orgs' pin sub-categorisation (`orgName` is captured in the catalog but not yet used for styling).
- Lottery providers, SMS/Slack — unrelated roadmap items.

## Self-review

- **All open decisions resolved (O-A..O-G).** The one sub-decision flagged for the plan is the exact MV-refresh sequencing shape (`refreshMv` flag vs. hoist to `main.ts`) — both yield a single refresh per cron.
- **Smaller than the legacy plan by design:** the hosted read layer, MV, provider interface, `classifySite` Rec.gov path, and map federal-pin UI are **already built**, so this slice is (1) a pure-logic adapter port, (2) two orchestration params (`providerId`, Rec.gov seed), and (3) a correctness fix (O-F). No new UI component; no MV rewrite; no schema migration.
- **Workers-safety preserved:** the ported adapter uses only `dayjs` + global `fetch` (no Node-only deps), consistent with `@campbrain/core`'s Workers-pure constraint. It runs in the GitHub-Actions scanner, not the Worker, but stays bundle-safe regardless.
- **Guardrails re-applied:** sequential 1.5 s-spaced polling with 429 backoff on a 6-hourly cron; public endpoint; manual booking only; no new providers; no automation.
- **Reconciled the RIDB discrepancy (O-D):** the live scan needs **no key**; RIDB is optional catalog-discovery tooling only. The Manual-setup section is honest that seeding + scan work key-free.
- **Data-isolation keystone honored:** all writes/reads stay provider-scoped by composite key; O-F closes the last place two providers could bleed together.
