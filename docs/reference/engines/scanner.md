# CampBrain — Scanner Engine

**Status:** shipped

The proactive scanner is the write-side of the system. It runs on a background interval, fetches availability grids from each provider, and stores the raw per-site per-day data in Postgres. It does not serve reads — all queries go through the [cache engine](cache.md).

---

## Purpose

Maintain a fresh 180-day availability grid for every eligible park across all configured providers. Runs immediately on worker start, then every 2 hours (`DEFAULT_PROACTIVE_INTERVAL_MINUTES = 120`).

---

## Responsibilities

- Generate the full set of `(park, window)` candidates covering `today+2` through `today+180`.
- Filter candidates to only stale or missing windows (via TTL tiers — see [data-model.md invariants](../data-model.md#invariants)).
- Fetch each stale window from the appropriate provider adapter.
- Write results to Postgres via `upsertEntry()`.
- Evict expired windows after each scan cycle.
- Refresh `mv_available_stays` after each cycle completes.
- Permanently skip parks that return HTTP 400/404 (no availability endpoint) by marking `discoveryStatus: 'failed'` in the catalog JSON.

---

## Key files

| Path | Role |
|---|---|
| `src/scanner/proactive-scanner.ts` | `runProactiveScan()` — main orchestrator |
| `src/scanner/run-scan.ts` | `runScan()` — alert-based scan; sources saved searches only (legacy Target loop removed) |
| `src/saved-search/match.ts` | `matchSavedSearch()` — expands a saved search into openings via the cache read path |
| `src/saved-search/store.ts` | `listAlertEnabledSavedSearches()` + full CRUD |
| `src/cli/commands/worker.ts` | `workerCommand()` — schedules both scan types; enforces min interval of 15 min |
| `src/rules/weekend-arrivals.ts` | Shared pure Fri/Sat arrival generator (used by both the matcher and legacy scan-candidates) |
| `src/cache/freshness.ts` | `oldestCoveringScan()` — shared freshness helper |
| `src/utils/concurrency.ts` | `runWithConcurrency()` — sliding-window worker pool |

---

## Algorithms & invariants

### Window generation

`generateWindowStarts(daysAhead, today?)` in `src/cache/availability-cache.ts`:

```
offset = 2
while offset <= daysAhead:
  push(today + offset)
  offset += WINDOW_DAYS   // 8
```

Starting at `today+2` (not today) to avoid the current day. Each daily execution shifts the base by one day, so `scan_windows` accumulates **overlapping** windows over time (e.g. windows starting at day 2, then day 3, then day 4 …). See the dedupe invariant in [data-model.md](../data-model.md#window-overlap-and-dedupe).

In the scanner itself, `generateCacheWindows(rangeStart, rangeEnd)` is called per provider (method on the `AvailabilityProvider` interface). CA Parks steps by 8 days; Rec.gov steps monthly.

### Stale window detection

`findStaleWindows(candidates, providerName)` in `src/cache/availability-cache.ts`:

1. Loads all existing `scan_windows` rows for the provider where `window_end >= CURRENT_DATE`.
2. For each candidate key `(parkPageId, windowStart)`: missing → stale; present but `isEntryStale()` → stale.
3. Also re-scans any existing window not in today's candidate set if its TTL has expired (handles the daily base-shift — yesterday's windows would otherwise never get refreshed).

TTL tiers are keyed on `window_start` (days until the window starts):

| Days until `window_start` | TTL |
|---|---|
| < 7 | 30 minutes |
| 7–29 | 2 hours |
| 30–89 | 4 hours |
| ≥ 90 | 8 hours |

### Expired window eviction

`evictExpired()` deletes rows from `scan_windows WHERE window_end < today` and orphaned `availability WHERE date < today`. Called at the end of every scan cycle (even if nothing was stale).

### Concurrency and rate limiting

Each provider declares `proactiveConcurrency` and `batchDelayMs`:

| Provider | Concurrency | Batch delay |
|---|---|---|
| CA Parks | 5 | 500 ms |
| Rec.gov | 1 (sequential) | 1500 ms |

Concurrency is enforced by `runWithConcurrency(tasks, limit)` — a sliding-window pool (not chunked). The batch delay fires between every group of `concurrency` tasks. For Rec.gov with `concurrency=1`, this means 1500 ms between every single request (~40 req/min).

### Permanent skip (unsupported parks)

If `proactiveScanWindow()` returns `'unsupported'` (HTTP 400 or 404), the scanner calls `updateParkMetadata(parkPageId, { discoveryStatus: 'failed' })` and skips all remaining windows for that park in the current run. Future runs filter out parks where `discoveryStatus === 'failed'`.

### Post-scan MV refresh

After all windows are written and eviction completes, `refreshMaterializedView()` is called. It uses `REFRESH MATERIALIZED VIEW CONCURRENTLY` when the MV is populated, falling back to a plain refresh otherwise. A failure here is non-fatal (logged, scan continues).

### Alert-based scan (`runScan`)

Separate from the proactive cache scan. Sources **alert-enabled saved searches** (`listAlertEnabledSavedSearches()` from `src/saved-search/store.ts`). For each saved search, `matchSavedSearch()` expands the date pattern into stay windows and queries the Postgres cache (not live provider fetches). Openings are compared against the prior hits state (v3, `src/state/scan-state.ts`); new openings trigger email/console notifications via the existing Resend pipeline.

The legacy Target loop (`listAlerts → generateScanCandidates → matchCandidates → resultsToHitRecords`) was removed in Phase 9. `data/targets.json` targets are no longer an alert source; they remain on disk for the booking-window / calendar-sync use cases only.

---

## Reproduction checklist

1. Ensure Postgres is running: `docker compose up -d` (see [deployment](../deployment.md)).
2. Initialize schema: `npm run db:init`.
3. Populate the catalog (CA Parks): `npm run catalog:refresh`.
4. Optionally seed Rec.gov: `npm run catalog:refresh -- --provider=recreation-gov` (requires `RIDB_API_KEY` in `.env`).
5. Run a one-off scan: `npm run scan` — verifies provider fetch, parse, and cache write.
6. Start the background worker: `npm run worker` — runs immediately and every 2 hours.
7. Confirm data: run `npm run dev`, open `/explore`, filter to any CA park, verify sites appear.
8. Verify MV freshness: `npm run cache:refresh` forces a manual MV refresh without a full scan.

---

## Dependencies

- [cache.md](cache.md) — `upsertEntry`, `findStaleWindows`, `evictExpired`, `refreshMaterializedView`
- [providers.md](providers.md) — provider adapters called per window
- [../data-model.md](../data-model.md) — schema written to; TTL and overlap invariants
