# Find Campsites — Design Spec
**Date:** 2026-06-02  
**Status:** Approved

## Summary

Replace the existing "Take Me Camping!" (`/explore`) page with a cache-backed campground search engine called "Find Campsites." Retire the "What's Available" (`/available`) page, which is now redundant with the Map page. The new page lets the user pick check-in/check-out dates, filter by region and site type, and see available campsites grouped by park — results update reactively, no live network scan required.

---

## Architecture

### What changes

| Location | Change |
|---|---|
| `web/app/explore/` | Replaced by new `FindCampsitesClient.tsx` (in-place revamp) |
| `web/app/explore/page.tsx` | Updated to serve new client |
| `web/app/api/explore/route.ts` | Replaced by `web/app/api/search/route.ts` |
| `web/app/available/` | Deleted |
| `web/app/api/available/route.ts` | Deleted |
| `web/app/api/available/refresh/route.ts` | Deleted |
| `web/app/layout.tsx` | Nav: remove "What's Available", rename "Take Me Camping!" → "Find Campsites", update href to `/explore` |
| `src/cache/availability-cache.ts` | New export: `searchAvailableStays()` |

### What stays the same

- `/map` page and all `/api/map/*` routes — untouched
- All other pages (alerts, scan-history, calendar, settings, etc.)
- The proactive scanner and Postgres schema — no changes needed

---

## UI

### Search form (top of page)

```
Check-in [date picker]   Check-out [date picker]   Nights: N (auto-calculated, read-only)

Region:   [ All ] [ North Coast ] [ Bay Area ] [ Sierra ] [ Central Coast ] [ SoCal ]

Filters:  [ Exclude group ] [ Exclude walk-up ] [ Hike-in only ] [ Exclude equestrian ]
```

- Requires both check-in and check-out to be set before showing results
- Results update reactively on any filter/date change (no Search button)
- Nights label is computed as `(checkOut - checkIn)` days, shown as `2 nights` etc.
- Region chips use existing `btn` / `btn-primary` / `btn-ghost` styling
- Site filters reuse the existing `SiteFilterPanel` component

### Results (below form)

Grouped by park, sorted by available site count descending:

```
────────────────────────────────────────────────────────
Pfeiffer Big Sur SP · Central Coast · 4 sites available
  Pfeiffer Big Sur Campground   $35/night · $70 total  [Book ↗]
    Sites: 12, 47, 63, 89  (green chips)
  Gorge Campground   $35/night · $70 total
    (walk-up badge)  Sites: A, B  · first-come, not reservable
────────────────────────────────────────────────────────
Salt Point SP · Bay Area · 2 sites available
  Woodside Campground   $35/night · $70 total  [Book ↗]
    Sites: 4, 11
────────────────────────────────────────────────────────
```

- Walk-up sites shown with `walk-up` badge, excluded from the available count
- Book links use `injectBookingDates(bookingUrl, checkIn, nights)` (existing helper)
- Parks with zero available bookable sites are hidden (unless fallback is active)
- Loading state shown while query is in-flight

### Empty / fallback state

Shown when query returns zero parks with bookable available sites:

**Alternate dates** — query which parks in the selected region have any availability in the next 60 days; surface up to 5 with their earliest open date:
> "Pfeiffer Big Sur SP has openings starting Jun 21 · Salt Point SP from Jun 28"

**Relaxed filters** — if site-type filters are active, re-run the same query without them and report the count difference:
> "Removing 'Exclude group sites' reveals 6 more sites at 2 parks."

No fallback shown when no filters are set and dates have genuine zero results — clean empty state with a short message.

---

## Data Layer

### New cache query: `searchAvailableStays()`

**File:** `src/cache/availability-cache.ts`

**Signature:**
```ts
export async function searchAvailableStays(params: {
  from: string;   // YYYY-MM-DD check-in date
  to: string;     // YYYY-MM-DD check-out date (exclusive — last night is to - 1 day)
  siteFilters?: string[];   // e.g. ['exclude_group', 'exclude_walk_up']
}): Promise<SearchParkResult[]>
```

**Query logic:**

Find all sites with `status = 'available'` on every date in `[from, to)` (the consecutive nights the user will occupy the site). Uses the raw `availability` table — not the materialized view (which only has 1N/2N precomputed stays).

SQL sketch (actual schema: `sites` joins to `campgrounds` via `provider_id + park_page_id + campground_name`; `parks` has no lat/lon — that comes from the catalog JSON):
```sql
SELECT
  p.park_page_id, p.park_name,
  cg.campground_name, cg.nightly_fee, cg.booking_url,
  s.site_name,
  s.site_name ~* 'hike\s*[/&]?\s*bike' AS is_walk_up
FROM sites s
JOIN campgrounds cg
  ON cg.provider_id = s.provider_id
  AND cg.park_page_id = s.park_page_id
  AND cg.campground_name = s.campground_name
JOIN parks p
  ON p.provider_id = s.provider_id
  AND p.park_page_id = s.park_page_id
WHERE s.provider_id = 'california-parks'
  AND s.site_id IN (
    SELECT site_id FROM availability
    WHERE date >= $from AND date < $to AND status = 'available'
    GROUP BY site_id
    HAVING COUNT(DISTINCT date) = $night_count   -- all nights must be available
  )
ORDER BY p.park_name, cg.campground_name, s.site_name
```

Night count = `dayjs(to).diff(dayjs(from), 'day')`.

The API route enriches results with lat/lon from the catalog JSON (via `listParksWeb()`) and applies the region classifier before returning — no Postgres schema changes needed.

**Return type:**
```ts
type SearchParkResult = {
  parkPageId: string;
  parkName: string;
  lat?: number;
  lon?: number;
  campgrounds: {
    name: string;
    nightlyFee?: number;
    bookingUrl?: string;
    availableSites: string[];    // bookable/reservable sites (walk-up excluded)
    walkUpSites: string[];       // first-come sites
  }[];
};
```

### New API route: `GET /api/search`

**File:** `web/app/api/search/route.ts`

**Query params:** `from`, `to`, `filters` (comma-separated filter IDs, optional)

Calls `searchAvailableStays()`, attaches region label to each park result using the region classifier, returns `SearchParkResult[]`.

### Region classifier

**File:** `web/lib/regions.ts`

Maps park lat/lon to one of five region labels using bounding boxes derived from the actual lat/lon spread of the 88 parks:

| Region | Lat range | Lon range | Example parks |
|---|---|---|---|
| North Coast | lat > 39.5 | lon < -121.5 | Redwoods, Humboldt, MacKerricher |
| Bay Area | lat 37–39.5 | lon < -121.5 | Salt Point, Tamalpais, Samuel P. Taylor |
| Sierra | any | lon ≥ -121.5, lat > 35 | Tahoe, D.L. Bliss, Calaveras Big Trees |
| Central Coast | lat 33.5–37 | lon < -119 | Big Sur, Morro Bay, Pismo |
| SoCal | lat < 35 AND lon < -119, OR lat < 34 (any lon) | — | Malibu, Doheny, Anza-Borrego, Palomar |

Parks not matching any box (edge cases) fall into the nearest region by closest centroid. Region label is computed at query time — no catalog changes needed.

---

## Fallback Queries

### Alternate dates

When zero results for given dates + filters, call a second query:

```ts
export async function findNextAvailableDates(params: {
  nights: number;
  withinDays: number;   // search window, e.g. 60
  parkPageIds?: string[]; // restrict to parks in selected region
}): Promise<{ parkPageId: string; parkName: string; earliestDate: string }[]>
```

Returns up to 5 parks with their earliest check-in date that has `nights` consecutive available nights.

### Relaxed filters

Client-side: when filters are active and zero results, fire a second `GET /api/search` without the `filters` param and compare result counts. No new backend code needed.

---

## Migration Checklist

- [ ] Delete `web/app/available/` directory
- [ ] Delete `web/app/api/available/` directory  
- [ ] Replace `web/app/api/explore/route.ts` with `web/app/api/search/route.ts`
- [ ] Replace `web/app/explore/ExploreClient.tsx` with `FindCampsitesClient.tsx`
- [ ] Update `web/app/explore/page.tsx` to import new client
- [ ] Update `web/app/layout.tsx`: remove "What's Available" link, rename "Take Me Camping!" → "Find Campsites"
- [ ] Add `searchAvailableStays()` and `findNextAvailableDates()` to `src/cache/availability-cache.ts`
- [ ] Add `web/lib/regions.ts` with region classifier
- [ ] Update `web/lib/availability-cache.ts` re-exports if needed

---

## Out of Scope

- User-saved searches (separate future feature)
- Live scanning / forced refresh from this page (Map has manual refresh; this page is cache-only)
- Sorting options beyond available-site-count descending
- Map view of results (the `/map` page covers that)
