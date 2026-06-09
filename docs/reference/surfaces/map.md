# Surface: /map — Interactive Park Map

**Status:** shipped

## Purpose

Full-viewport Leaflet/OpenStreetMap map of all CA Parks and Rec.gov parks as interactive pins, with distance-based hard filtering, date/availability soft filtering (blue = bookable match, grey = no match), and a per-park detail panel showing available dates and weekend stay tiers.

---

## Behavior / Contract

**Route:** `GET /map` — `force-dynamic` async server component (`web/app/map/page.tsx`).

**Data loading strategy:**

- Catalog data (lat/lon, campground list, provider) is loaded **server-side** in `web/app/map/page.tsx` via `listParksWeb()` (from `web/lib/catalog.ts`) and `listParksFromDb()` (from `src/cache/availability-cache.ts`). The result is merged into `MapPark[]` and passed as the `initialParks` prop to `<MapClient>`. The `/api/map/catalog` route is **not** called by this page.
- Rec.gov facilities are grouped by `parentId` (catalog field); facilities with no parent become their own group. Group `parkPageId` is prefixed `recgov-<parentId>` to prevent collisions with CA Parks page IDs.
- Per-park availability detail is fetched **client-side** by `MapClient.tsx` on pin click, via `GET /api/map/availability` (see [api.md](../api.md)).
- Pin-lighting (blue/grey) is driven by `GET /api/map/availability/summary` (see [api.md](../api.md)), called client-side with a 400ms debounce when `availFrom`, `availTo`, `activeFilters`, or `tab` changes.

**Filter controls (all in `MapClient`):**

| Control | Behavior |
|---|---|
| Park dropdown | Selects one park by `parkPageId`; hard-filters the count display and opens the detail panel. |
| Weekends / All dates toggle | Sets `tab` (`'weekends'` or `'dates'`); passed to detail panel and `weekendsOnly` param of summary API. |
| Night count: All / 1N / 2N | Sets `nightCount` (`null`, `1`, or `2`); controls which stay tiers render in the detail panel. |
| Site filters (`SiteFilterPanel`) | Six filter chips from `web/lib/site-filters.ts` — toggled client-side; forwarded in the `filters` param of summary API and applied in the detail panel via `passesSiteFilters()`. |
| Location search | Free-text input → Nominatim geocode (`https://nominatim.openstreetmap.org/search`) → resolves to `{ lat, lon, name }`. "Use my location" button uses `navigator.geolocation`. |
| Distance chips | `Any`, `25mi`, `50mi`, `100mi`, `200mi`. Requires a resolved location. **Hard-removes** pins from the map (distance filter is applied to `displayedParks`). |
| Date range pickers | `<input type="date">` from/to — triggers summary API call; also constrains availability detail panel. Quick-set buttons: "2 weeks", "1 month". |

**Pin color semantics:**

- **Blue pin** — park has at least one bookable available site matching current filters in the date range (`parksInDateRange` set contains the park's `facilityPageIds`).
- **Grey pin** — park is within the distance radius but has no bookable availability matching filters.
- Pins hard-removed by distance filter do not appear at all.
- Walk-up sites are always excluded from pin-lighting (enforced server-side by `getParksWithAvailability()` in `FILTER_SQL`).

**Detail panel** (`DetailPanel` component in `MapClient.tsx`):

- Opens when a pin is clicked; overlays the right side of the viewport (`.map-detail-panel`).
- Shows park name, `ProviderBadge`, `discoveryStatus` badge, campground/site counts, and "Cache as of X ago".
- Fetches availability via `useParkAvailability()` hook, which calls `GET /api/map/availability` with `facilityPageIds`, `parkPageId`, `from`, `to`, and `provider`. Result is cached in component state per `(parkPageId|from|to)` key.
- **Weekends tab** — renders `WeekendRow` for each `WeekendEntry`. Each row shows stay tiers filtered by `nightCount`:
  - Fri–Mon (3N): `sites3Night` + `BookLink(arrival=fridayDate, nights=3)`
  - Fri–Sun (2N): `sites2NightFri` + `BookLink(arrival=fridayDate, nights=2)`
  - Sat–Mon (2N): `sites2NightSat` + `BookLink(arrival=saturdayDate, nights=2)`
  - Fri (1N): `sites1NightFri` + `BookLink(arrival=fridayDate, nights=1)`
  - Sat (1N): `sites1NightSat` + `BookLink(arrival=saturdayDate, nights=1)`
  - `walkUpSites` shown with `WalkUpLine` (walk-up badge, "first-come, not reservable") — never in bookable tier arrays.
- **Dates tab** — renders `DateRow` for each `AvailableDateEntry`. Each row lists available sites per campground and a `BookLink` (arrival = date, nights = `nightCount ?? 1`). For 2N filter, client intersects adjacent nights to show only sites available on consecutive pairs.
- Empty-state messages distinguish: no weekend openings (but weekday exists), fully booked (shows next opening from `earliestAvailableDate`), filters eliminated everything, and no cached data.

**API calls made by this surface** (see [api.md](../api.md)):

| Call | When |
|---|---|
| `GET /api/map/availability?parkPageId=&facilityIds=&from=&to=&provider=` | On park pin click or select |
| `GET /api/map/availability/summary?from=&to=&filters=&weekendsOnly=` | Debounced 400ms on date range / filter / tab change |

**Invariants:**

- Walk-up sites (`isWalkUpSite()`) are excluded from all bookable counts and pin-lighting. They appear only in `WalkUpLine` display rows within the detail panel.
- Distance chips are enabled only after a location is resolved; selecting a distance chip without a location shows an error message rather than filtering.
- Rec.gov park availability is fetched using `facilityPageIds` (real DB IDs), not the synthetic `recgov-<parentId>` `parkPageId`, because the synthetic key has no DB row.

---

## Presentation

**Layout** (`.map-page` overrides `.main` defaults — no padding, full height):

```
.map-page
  .map-filters          filter bar (top, --surface bg, bottom border)
    Row 1: park dropdown + Weekends/All dates toggle + night chips + park count + Reset
    Row 2: SiteFilterPanel (6 site filter chips)
    Row 3: location input + geocode button + "use my location" + distance chips
           | (divider) | date-from picker + date-to picker + "2 weeks" / "1 month" buttons
  .map-container        Leaflet map (flex:1, fills remaining height)
  .map-detail-panel     400px right overlay (z-index 1000, box-shadow) when park selected
    .map-detail-header  park name + status/provider badges + close button
    DateRow / WeekendRow list
```

**Leaflet map** (`LeafletMap` component, loaded via `next/dynamic` with `ssr: false`): OpenStreetMap tiles; Nominatim geocoding. Pans to `focusLocation` when a location is resolved; draws a distance circle when `distanceMiles` is set.

**Component links:** `SiteFilterPanel`, `ProviderBadge`, `badge-green`/`badge-gray`/`badge-blue`, `.btn`/`.btn-sm`, `.map-page`/`.map-filters`/`.map-container`/`.map-detail-panel` — all defined in [design-system.md](../design-system.md).

**Book links** in both tabs use `injectBookingDates(cg.bookingUrl, arrivalDate, nights)` from `web/lib/booking-url.ts` — injects the exact arrival date and night count for ReserveCalifornia.

---

## Reproduction checklist

1. Add `web/app/map/page.tsx` as a `force-dynamic` async server component. Load catalog via `listParksWeb()` and DB parks via `listParksFromDb()`. Merge into `MapPark[]`, grouping Rec.gov facilities by `parentId` (prefix group key with `recgov-`). Pass as `initialParks` prop to `<MapClient>`.
2. Create `web/app/map/MapClient.tsx` as a `'use client'` component. State: `parks`, `selectedPark`, `activeFilters`, `nightCount`, `tab`, `locationQuery`, `resolvedLocation`, `distanceMiles`, `availFrom`, `availTo`, `parksInDateRange`.
3. Load the Leaflet map component via `next/dynamic` with `ssr: false` to prevent SSR errors (see [design-system.md](../design-system.md) for the `.map-page` layout class).
4. Implement distance hard-filter: `displayedParks` = parks within `distanceMiles` of `resolvedLocation` (haversine); removed parks do not appear as pins. Set `matchingParkIds` for pin coloring: `null` when no non-distance filter is active (all blue), otherwise the set of `parkPageId`s with availability.
5. Wire `GET /api/map/availability/summary` with a 400ms debounce on date range / filters / tab change. Store result as `parksInDateRange: Set<string>` of `facilityPageIds` (see [api.md](../api.md)).
6. On pin click, open `DetailPanel`. Call `GET /api/map/availability` using `facilityPageIds` (not the synthetic `parkPageId` for Rec.gov groups) so the query hits real DB rows. Cache per `(parkPageId|from|to)` key.
7. Render **Weekends tab** weekend stay tiers (3N Fri–Mon, 2N Fri–Sun, 2N Sat–Mon, 1N Fri, 1N Sat) filtered by `nightCount`. Each tier uses `BookLink` with the correct arrival date and nights from `injectBookingDates()`.
8. Render **Dates tab** date rows with campground site lists. For `nightCount=2`, intersect adjacent-day site arrays client-side. Each row has a `BookLink`.
9. Render `WalkUpLine` for walk-up sites in both tabs — badge + "first-come, not reservable". Walk-up sites must never appear in bookable tier arrays or count badges.
10. Implement location geocoding via Nominatim (User-Agent header required: `CampBrain/1.0`). "Use my location" via `navigator.geolocation`.
11. Add `<SiteFilterPanel>` (see [design-system.md](../design-system.md)) and wire `activeFilters` to both the summary API call and the client-side `passesSiteFilters()` filtering of detail panel results.
12. Verify: distance chip hard-removes pins; date filter greys (not removes) pins; walk-up sites excluded from bookable counts; Book links encode correct arrival + nights; Rec.gov groups show combined availability.

---

## Dependencies

- [engines/cache.md](../engines/cache.md) — `getEntriesForParks()` and `getParksWithAvailability()` back the two map API routes
- [api.md](../api.md) — `GET /api/map/availability` and `GET /api/map/availability/summary`
- [data-model.md](../data-model.md) — `MapPark`, `ParkAvailabilityResponse`, `WeekendEntry`, walk-up invariants
- [design-system.md](../design-system.md) — `SiteFilterPanel`, `ProviderBadge`, map layout classes, badges, buttons
