# Recreation.gov Provider Integration Design

**Date:** 2026-06-02  
**Status:** Approved  
**Scope:** Add Recreation.gov (federal campgrounds) as a second availability provider alongside California State Parks. Initial scope is California federal campgrounds; architecture must support nationwide expansion.

---

## Context

CampBrain currently pulls availability data only from California State Parks (ReserveCalifornia). Many desirable California campsites — Yosemite, Sequoia, national forest sites, BLM campgrounds — are booked through Recreation.gov. The frontend UX (Find Campsites page, map) should surface federal campgrounds identically to state park campgrounds, with a small provider badge distinguishing the source.

---

## What Already Exists

The codebase is further along than expected:

- `src/providers/recreation-gov-provider.ts` — `RecreationGovProvider` implements `AvailabilityProvider` for alert-based scanning (fetch JSON from Rec.gov, return `AvailabilityHit[]`). Works today for saved targets.
- DB schema — all tables (`parks`, `campgrounds`, `sites`, `scan_windows`, `availability`) use `(provider_id, park_page_id)` composite keys. No schema changes needed.
- `data/catalog/california-parks.json` — `ProviderCatalog` shape; `catalog-store.ts` has `readRecreationGovRaw()` and `SUPPORTED_PROVIDERS` already includes `'recreation-gov'`.
- `TargetSchema` — already enumerates `'recreation-gov'` as a valid provider.
- `getProvider()` in `run-scan.ts` — already dispatches to `RecreationGovProvider` for alert scanning.

**What is NOT done:**
- The proactive background scanner is hardcoded to `california-parks` only.
- `availability-cache.ts` has a module-level `const PROVIDER = 'california-parks'` used in every query.
- The materialized view `mv_available_stays` hardcodes `AND s.provider_id = 'california-parks'`.
- No `recreation-gov.json` catalog exists yet.
- The `providers` table only seeds California State Parks.

---

## Architecture

```
[RIDB API] ──catalog:refresh──► recreation-gov.json
                                        │
[Rec.gov availability API] ──proactiveScanWindow()──► AvailabilityWindowEntry
                                        │
                              upsertEntry(entry, 'recreation-gov')
                                        │
                                    Postgres
                                        │
                            mv_available_stays (provider-agnostic)
                                        │
                        /find-campsites + /map  (unchanged UX + provider badge)
```

---

## Design Details

### 1. Provider Interface Extension

**File:** `src/providers/availability-provider.ts`

Add two methods for proactive caching:

```typescript
export interface CacheWindow {
  windowStart: string; // YYYY-MM-DD
  windowEnd: string;   // YYYY-MM-DD
}

export interface AvailabilityProvider {
  name: string;
  // Alert-based scanning (existing)
  scan(target: Target, candidates: ScanCandidate[], debugMode?: boolean): Promise<ScanResult[]>;
  // Proactive background caching (new)
  generateCacheWindows(rangeStart: string, rangeEnd: string): CacheWindow[];
  proactiveScanWindow(
    parkPageId: string,
    window: CacheWindow,
    parkName: string,
    campgrounds: CampgroundCatalogEntry[]
  ): Promise<AvailabilityWindowEntry | null>;
}
```

`generateCacheWindows` returns the list of windows that should exist for a given date range. CA Parks returns 8-day windows; Rec.gov returns month-start windows (YYYY-MM-01 through end of month).

### 2. CA Parks Provider — Refactor

**File:** `src/providers/california-parks-provider.ts`

- Implement `generateCacheWindows` (existing `generateWindowStarts` logic, moved here)
- Implement `proactiveScanWindow` (extract existing proactive scanning body from `proactive-scanner.ts` into this method)

The proactive scanner in `proactive-scanner.ts` becomes a thin loop: for each park, call `provider.generateCacheWindows()` → filter stale → call `provider.proactiveScanWindow()` → upsert.

### 3. Rec.gov Provider — Proactive Scan

**File:** `src/providers/recreation-gov-provider.ts`

Implement `generateCacheWindows`:
- Returns first-of-month dates for all months spanning `rangeStart` to `rangeEnd`
- Months are naturally sized: `window_start = YYYY-MM-01`, `window_end = last day of that month`

Implement `proactiveScanWindow(campgroundId, window, parkName, campgrounds)`:
- Fetch: `GET https://www.recreation.gov/api/camps/availability/campground/{campgroundId}/month?start_date=YYYY-MM-01T00:00:00.000Z`
- No API key needed (same public endpoint as the website)
- Parse `RecGovAvailabilityResponse.campsites` into per-site per-day statuses
- Map `'Available'` → `'available'`; all other statuses → `'unavailable'`
- Return `AvailabilityWindowEntry` with the site grid; source URL = the API URL

Walk-up detection: apply the existing `isWalkUpSite(siteName)` helper to Rec.gov site names — most won't match, but the logic is free and consistent.

### 4. Proactive Scanner — Provider-Agnostic

**File:** `src/scanner/proactive-scanner.ts`

Remove `if (p.provider !== 'california-parks') return false`.

New loop structure:
```
for each park in listCatalogParks():
  provider = getProvider(park.provider)
  windows = provider.generateCacheWindows(today+2, today+182)
  staleWindows = filterStale(windows, park.parkPageId, provider.name, freshThresholdMinutes)
  for each stale window:
    entry = await provider.proactiveScanWindow(park.parkPageId, window, park.parkName, park.campgrounds)
    if entry: await upsertEntry(entry, provider.name)
```

Rate limiting: Rec.gov API calls get the same `pLimit` concurrency cap as CA Parks. The proactive scanner should use a reasonable limit (e.g. `pLimit(3)` for Rec.gov calls, same as today for CA Parks).

### 5. Cache Layer

**File:** `src/cache/availability-cache.ts`

- Remove `const PROVIDER = 'california-parks'`
- `upsertEntry(entry: AvailabilityWindowEntry, providerId: string)`: replace `PROVIDER` with the new parameter throughout the function
- All **read** queries (`findStaleWindows`, `getEntriesForPark`, `getParksWithAvailability`, `searchAvailableStays`, `findNextAvailableDates`, `listFreshEntries`, `evictExpired`, etc.): remove the `WHERE provider_id = 'california-parks'` filters. Data is naturally scoped by the `(provider_id, park_page_id)` composite keys, so reads are correct without the filter.
- `findStaleWindows(provider_id, park_page_id, windows)` — already takes park-level parameters; just remove the internal provider hardcode.

### 6. Database

**File:** `src/cache/db.ts`

Seed the providers table in `initDb()`:
```sql
INSERT INTO providers (provider_id, display_name, base_url)
VALUES ('recreation-gov', 'Recreation.gov', 'https://www.recreation.gov')
ON CONFLICT (provider_id) DO NOTHING;
```

Rebuild materialized view — remove `AND s.provider_id = 'california-parks'` from all four join clauses:
```sql
FROM stays s
JOIN parks p ON p.provider_id = s.provider_id AND p.park_page_id = s.park_page_id
JOIN campgrounds cg
  ON cg.provider_id = s.provider_id
  AND cg.park_page_id = s.park_page_id
  AND cg.campground_name = s.campground_name
```

After the code change, run `npm run db:rebuild-mv` to drop and recreate the view.

### 7. Catalog

**New file:** `data/catalog/recreation-gov.json`  
Shape: same `ProviderCatalog` as `california-parks.json`, with `provider: 'recreation-gov'`.

**CLI command:** `npm run catalog:refresh --provider=recreation-gov` (command already exists; needs a new discovery branch)

The CLI dispatches through `src/catalog/refresh-catalog.ts` → `selectParksToRefresh(parks, { provider: 'recreation-gov' })` → calls the provider-specific discover function.

**New file:** `src/catalog/discover-recreation-gov.ts` (parallel to `discover-california-parks.ts`)
- Exports `discoverRecreationGovCatalog(opts: DiscoverOptions): Promise<DiscoverResult>`
- RIDB API: `GET https://ridb.recreation.gov/api/v1/facilities?state=CA&activity=9&apikey={RIDB_API_KEY}&limit=50&offset=N`
  - `activity=9` = Camping
  - Pages until no more results
- Map each facility to `ParkCatalogEntry`:
  - `provider: 'recreation-gov'`
  - `parkPageId` = `FacilityID` (string)
  - `parkName` = `FacilityName`
  - `lat` / `lon` from `FacilityLatitude` / `FacilityLongitude`
  - `defaultBookingRule`: `{ type: 'rolling_months_before', monthsBefore: 6, releaseTime: '07:00', timezone: 'America/Los_Angeles', source: 'known', confidence: 'medium' }` (Recreation.gov opens 6 months ahead at 7 AM PT)
  - `campgrounds`: populated from the RIDB `/facilities/{id}/campsites` endpoint (site names, types)
- Writes to `data/catalog/recreation-gov.json`

**Update:** `src/catalog/refresh-catalog.ts` — dispatch to `discoverRecreationGovCatalog` when `provider === 'recreation-gov'`, else existing CA Parks path.

**Update:** `.env` — add `RIDB_API_KEY=` with a comment pointing to ridb.recreation.gov registration

### 8. Web UI — Provider Badge

**New file:** `web/lib/providers.ts`
```typescript
export interface ProviderBadgeConfig {
  label: string;
  color: 'green' | 'blue' | 'orange' | 'purple'; // expandable
}

export const PROVIDER_BADGES: Record<string, ProviderBadgeConfig> = {
  'california-parks': { label: 'CA State Parks', color: 'green' },
  'recreation-gov':   { label: 'Recreation.gov', color: 'blue' },
};
```

Adding a new provider = one line.

**New component:** `web/components/ProviderBadge.tsx`  
Small colored chip that reads from `PROVIDER_BADGES[providerId]`. Falls back gracefully if the provider isn't in the map.

**Usage:**
- Park cards in `FindCampsitesClient` — badge in the park name row
- Map popup in `MapClient` / `ParkMapPopover` — badge at the top of the detail panel
- The `provider` field is already returned by `/api/map/catalog`; the search API should also include it in each park result

**Text update:** `web/app/explore/page.tsx` line 11 — change `"Search available campsites across California state parks"` to `"Search available campsites across California"`.

---

## Data Flow: Rec.gov Availability into the UI

1. Worker runs `runProactiveScan()` → hits Rec.gov API for each CA campground → stores in `parks`, `campgrounds`, `sites`, `scan_windows`, `availability` tables
2. `refreshMaterializedView()` is called after each scan cycle → `mv_available_stays` now includes Rec.gov sites
3. `/api/search` queries `mv_available_stays` → returns mixed CA + federal results
4. `/api/map/availability/summary` → mixed results lighting pins on the map
5. Frontend renders identical cards/pins with a `ProviderBadge` chip

---

## Error Handling

- Rec.gov API rate limiting: if response is 429 or 503, log and return `null` from `proactiveScanWindow` (scanner skips and retries next cycle)
- Network errors: same as CA Parks — log, return null, don't crash the worker
- Missing campground data: if `recreation-gov.json` has a park with no campgrounds, the proactive scanner skips it (same behavior as CA Parks with empty campground list)
- RIDB API errors during catalog refresh: log per-page failures, continue, write what was successfully fetched

---

## Testing

- Unit tests for `RecreationGovProvider.proactiveScanWindow()` — mock the fetch, assert the `AvailabilityWindowEntry` shape matches what `upsertEntry` expects
- Unit tests for `generateCacheWindows` (monthly windows cover the full range, no gaps, no duplicates)
- Unit tests for `upsertEntry` with `provider_id = 'recreation-gov'` — assert park/site rows are inserted under the correct provider namespace
- Integration smoke: `npm run scan --provider=recreation-gov --park=<campgroundId>` fetches one campground and prints the grid
- MV rebuild: after seeding one rec.gov campground and running a scan, `refreshMaterializedView()` + query `mv_available_stays` returns rows for that campground
- UI: start the dev server, confirm a Rec.gov park card appears with a blue "Recreation.gov" badge

---

## Phased Delivery

**Phase 1 — Cache layer + MV (unblock multi-provider)**
- Remove `PROVIDER` hardcode from `availability-cache.ts`
- Rebuild MV without provider filter
- Seed `recreation-gov` provider in `providers` table

**Phase 2 — Rec.gov proactive scanning**
- Extend provider interface
- Refactor CA Parks proactive logic onto provider class
- Implement Rec.gov `proactiveScanWindow` + `generateCacheWindows`
- Update proactive scanner to be provider-agnostic

**Phase 3 — Catalog**
- Build `catalog:refresh --provider=recreation-gov` command
- Seed initial `recreation-gov.json` for CA

**Phase 4 — UI badge**
- `web/lib/providers.ts`, `ProviderBadge.tsx`
- Update `FindCampsitesClient`, `MapClient`/`ParkMapPopover`
- Update subtitle text

---

## Files Changed

| File | Change |
|------|--------|
| `src/providers/availability-provider.ts` | Add `CacheWindow`, `generateCacheWindows`, `proactiveScanWindow` to interface |
| `src/providers/california-parks-provider.ts` | Implement new interface methods; extract from proactive-scanner |
| `src/providers/recreation-gov-provider.ts` | Implement `generateCacheWindows` + `proactiveScanWindow` |
| `src/scanner/proactive-scanner.ts` | Remove CA-only filter; call provider interface methods |
| `src/cache/availability-cache.ts` | Remove `PROVIDER` constant; parameterize `upsertEntry`; remove provider filters from reads |
| `src/cache/db.ts` | Add rec.gov provider seed; rebuild MV without provider filter |
| `src/catalog/discover-recreation-gov.ts` | New: RIDB API discovery for Rec.gov campgrounds |
| `src/catalog/refresh-catalog.ts` | Dispatch to new discover fn when provider=recreation-gov |
| `data/catalog/recreation-gov.json` | New seed file |
| `.env` | Add `RIDB_API_KEY=` |
| `web/lib/providers.ts` | New: `PROVIDER_BADGES` config map |
| `web/components/ProviderBadge.tsx` | New: colored badge chip |
| `web/app/explore/page.tsx` | Update subtitle text |
| `web/app/find-campsites/FindCampsitesClient.tsx` | Add ProviderBadge to park header |
| `web/app/map/MapClient.tsx` or `ParkMapPopover.tsx` | Add ProviderBadge to map popup |
| `web/app/api/search/route.ts` | Include `provider` in search results |
