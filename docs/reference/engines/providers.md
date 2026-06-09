# CampBrain — Providers Engine

**Status:** shipped (CA Parks: full; Rec.gov: partial — proactive scan operational, alert scan limited)

The providers layer is the adapter boundary between CampBrain and external availability APIs. All provider-specific HTTP fetching, HTML/JSON parsing, and URL construction stays inside `src/providers/`. Business logic (TTL, deduplication, UI rendering) never touches provider internals.

---

## Purpose

Isolate the details of each provider's API contract so that the scanner and alert system can call a uniform interface regardless of which provider backs a park. Adding a new provider means adding one file under `src/providers/` and one catalog-discovery file under `src/catalog/`.

---

## Responsibilities

- Implement the `AvailabilityProvider` interface for each provider.
- Generate the correct cache window schedule for each provider (`generateCacheWindows`).
- Fetch and parse a single availability window (`proactiveScanWindow`).
- Support alert-based (target-specific) scanning (`scan`).
- Save raw HTML snapshots to `.campbrain/debug/` when parser confidence is low.
- Signal permanently unsupported parks (HTTP 400/404) so the scanner can skip them.
- Discover and seed park catalogs (`src/catalog/`).

---

## Key files

| Path | Role |
|---|---|
| `src/providers/availability-provider.ts` | `AvailabilityProvider` interface + `CacheWindow` type |
| `src/providers/california-parks-provider.ts` | CA Parks adapter; `buildAvailabilityUrl` |
| `src/providers/california-parks-parser.ts` | Cheerio-based HTML parser; `parseAllAvailability`, `parseAvailabilityHtml`, `evaluateCandidate` |
| `src/providers/recreation-gov-provider.ts` | Rec.gov JSON adapter; `fetchWithRetry`, `buildAvailabilityUrl`, `evaluateRecGovCandidate` |
| `src/catalog/discover-california-parks.ts` | `discoverCaliforniaParkCatalog` — fetches catalog from CA Parks HTML |
| `src/catalog/discover-recreation-gov.ts` | `discoverRecreationGovCatalog` — fetches catalog from RIDB API |

---

## The `AvailabilityProvider` interface

Defined in `src/providers/availability-provider.ts`:

```typescript
export interface AvailabilityProvider {
  name: string;

  /** Max simultaneous proactiveScanWindow calls. Default: 5. Rec.gov: 1. */
  proactiveConcurrency?: number;

  /** Milliseconds between task batches. Rec.gov: 1500ms. CA Parks: 500ms. */
  batchDelayMs?: number;

  /** Alert-based scan — check specific date candidates against a target. */
  scan(
    target: Target,
    candidates: ScanCandidate[],
    debugMode?: boolean
  ): Promise<ScanResult[]>;

  /**
   * Return the list of cache windows to cover rangeStart–rangeEnd.
   * CA Parks: 8-day windows. Rec.gov: calendar-month windows.
   */
  generateCacheWindows(rangeStart: string, rangeEnd: string): CacheWindow[];

  /**
   * Fetch a single cache window. Returns:
   *   AvailabilityWindowEntry — success
   *   'unsupported'           — HTTP 400/404: no availability endpoint; scanner skips permanently
   *   null                    — temporary failure; retry next cycle
   */
  proactiveScanWindow(
    parkPageId: string,
    window: CacheWindow,
    parkName: string,
    campgrounds: CampgroundCatalogEntry[]
  ): Promise<AvailabilityWindowEntry | 'unsupported' | null>;
}
```

---

## Algorithms & invariants

### CA Parks — endpoint and the `length` gotcha

Endpoint:
```
https://www.parks.ca.gov/AvailabilityInfo?arrival_date=YYYY-MM-DD&length=N&page_id=PARKID
```

`buildAvailabilityUrl(pageId, candidate)` in `california-parks-provider.ts` sets `length = candidate.nights`.

**Critical invariant:** `length` is a **consecutive-nights filter**, not a column-count control. The API always returns 8 date columns regardless of `length`. Setting `length=2` does not return a wider grid — it only filters the rows to sites with 2 consecutive available nights. Use `length=1` to get the full per-site grid. The proactive scanner always passes `nights: 1` when building the window URL.

### CA Parks — probing strategy

When a window's first date is fully booked, the API returns a "Availability: No" page (no `<section class="card">` elements). `isNoAvailabilityPage(html)` detects this. The scanner probes up to `WINDOW_DAYS` (8) offsets within the window until it finds a date with actual site data. If all 8 dates are fully booked it stores an empty `campgrounds: []` entry. If the response is neither a grid nor a "fully booked" page, it returns `null` (temporary failure).

### CA Parks — HTML parser

`parseAllAvailability(html)` in `california-parks-parser.ts` uses Cheerio to:
1. Find all `section.card` elements (one per campground).
2. Extract the campground name from `header.card-header h4`.
3. Parse date columns from `thead tr th` (skip the first "Unit" column).
4. Parse each `tbody tr` for `td.unit-name` (site name) and subsequent cells.
5. Classify each cell as `available`, `unavailable`, or `unknown` based on CSS classes and `title` attributes.

Sites where any cell status is `unknown` trigger a debug HTML save to `.campbrain/debug/`.

`parseAvailabilityHtml(html, target)` is the alert-scan variant — filters to `target.acceptableSites` only and returns a `ParsedCampground` struct.

### CA Parks — debug HTML saves

`saveDebugHtml()` (from `src/utils/files.ts`) writes a snapshot to `.campbrain/debug/<targetId>/<date>-<nights>n.html` when:
- `debugMode = true` (CLI flag)
- `parsed === null` (section not found)
- `parsed.sitesMissing.length > 0` (configured sites absent from HTML)
- `parsed.hasUnknownStatuses` (parser uncertain about a cell)

### Rec.gov — endpoint and window schedule

Rec.gov uses a monthly availability JSON endpoint keyed by campground ID and month:
```
https://www.recreation.gov/api/camps/availability/campground/{campgroundId}/month?start_date=YYYY-MM-01T00%3A00%3A00.000Z
```

The colons in the ISO datetime **must be percent-encoded** — the API returns HTTP 400 "query not encoded" otherwise.

`generateCacheWindows` for Rec.gov steps monthly (first of month through end of month), unlike CA Parks which steps every 8 days.

### Rec.gov — rate limiting and retry

`proactiveConcurrency = 1` (sequential) and `batchDelayMs = 1500` (1.5 s between requests, ~40 req/min).

`fetchWithRetry(url, parkName, windowStart, retryDelaysMs)` handles HTTP 429 with exponential backoff:
- Retry delays: 15 s, 45 s, 90 s.
- HTTP 400 or 404 → returns `'unsupported'` (permanent skip signal).
- Other non-OK status → throws (caller returns `null`).

`retryDelaysMs` is injectable for testing (pass `[0, 0, 0]` to skip real waits).

### Rec.gov — permanent skip

`REC_GOV_RETRY_DELAYS_MS = [15_000, 45_000, 90_000]` is exported for tests.

When `proactiveScanWindow` returns `'unsupported'`, the scanner in `proactive-scanner.ts` calls `updateParkMetadata(parkPageId, { discoveryStatus: 'failed' })` and adds the `parkPageId` to an `unsupportedParkIds` Set to skip its remaining windows in the current run.

### Catalog discovery

CA Parks: `discoverCaliforniaParkCatalog()` fetches the parks.ca.gov HTML and extracts campgrounds + sites using `parseCampgroundsFromHtml()`. Writes to `data/catalog/california-parks.json`.

Rec.gov: `discoverRecreationGovCatalog()` queries the RIDB search API (`https://ridb.recreation.gov/api/v1/recareas`) using `RIDB_API_KEY`. Results are filtered by `isLikelyCampground()` and written to the catalog JSON.

CLI: `npm run catalog:refresh` (CA Parks) and `npm run catalog:refresh -- --provider=recreation-gov` (Rec.gov, requires `RIDB_API_KEY`).

---

## Reproduction checklist — adding a new provider adapter

1. Create `src/providers/<name>-provider.ts` implementing `AvailabilityProvider`.
   - Set `proactiveConcurrency` and `batchDelayMs` appropriate to the API's rate limits.
   - Return `'unsupported'` from `proactiveScanWindow` on HTTP 400/404 (permanent failure signal).
   - Return `null` on transient errors (scanner retries next cycle).
   - Save debug HTML when parse confidence is low.
2. Create `src/catalog/discover-<name>.ts` with a `discover*Catalog()` function.
3. Add the provider to the `getProvider(providerName)` switch in `proactive-scanner.ts` and `run-scan.ts`.
4. Add the `provider_id` seed row in `src/cache/db.ts` `initDb()`.
5. Run `npm run db:init` to seed the new provider row.
6. Run catalog discovery to populate `data/catalog/<name>.json`.
7. Run `npm run scan` with a test target; confirm data appears in Postgres.
8. Run `npm run typecheck && npm test`.

---

## Dependencies

- [scanner.md](scanner.md) — calls `proactiveScanWindow` and `scan` on these adapters
- [../data-model.md](../data-model.md) — `AvailabilityWindowEntry` shape that `proactiveScanWindow` must return
- `src/catalog/` — catalog data consumed by the scanner to enumerate eligible parks
