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

**Filter controls (all in `MapClient`) — four labeled rows:**

**Row 1 — When:**
| Control | Behavior |
|---|---|
| Horizon preset pills | `This weekend` / `Next 2 weeks` / `Next month` / `Anytime` — exactly one active; fills the date inputs. `Anytime` queries the full cached horizon (`from = today`, no `to`). |
| Date inputs | Native `<input type="date">` from/to; manual edit deselects the preset. |
| Weekends only pill | Adds `weekendsOnly` param to summary + detail queries; also switches the detail panel between weekend-tiers layout and date-rows layout. Forced on and visually locked while `This weekend` is the active preset. |

**Row 2 — Min stay + Near:**
| Control | Behavior |
|---|---|
| Min stay: Any / 1 / 2 / 3 nights | Sets `minNights` (sent to summary query via gaps-and-islands logic). In the dates view, Book links inject `max(minNights, 1)` nights. Weekend tiers hide tiers shorter than `minNights`. |
| Location search | Free-text → Nominatim geocode → `{ lat, lon, name }`. "Use my location" uses `navigator.geolocation`. Distance pills disabled until a location resolves. |
| Distance chips | `Any`, `25mi`, `50mi`, `100mi`, `200mi`. **Hard-removes** pins (applied to `displayedParks`). |

**Row 3 — Taxonomy filter groups:**
| Group | Values | Behavior |
|---|---|---|
| Access | `Drive-in` / `Hike-in` / `Boat-in` | Multi-select; empty = all access types. Forwarded as `access` CSV param. |
| Site kind | `Tent` / `Hookups (RV)` / `Cabin / yurt` | Multi-select; empty = all kinds. Forwarded as `kinds` CSV param. |
| Hide | `Group` / `Equestrian` / `Walk-up (first-come)` | Active style: slate + eye-off icon. Forwarded as `hide` CSV param. |

**Row 4 — Summary + Reset:**
| Control | Behavior |
|---|---|
| Summary sentence | One plain-language line ("N of 141 parks have a 2-night drive-in weekend stay …"). Replaces both old count displays. |
| Reset | Restores default state (This weekend, weekends only, min stay Any, no taxonomy selection); only rendered when state ≠ default. |

**Park finder** — type-ahead search overlay (top-right of map), separate from the filter bar. Selecting a park opens the panel and flies to it; not part of Reset.

**Pin color semantics:**

- **Blue pin** — park has at least one bookable available site matching current filters in the date range (`parksInDateRange` set contains the park's `facilityPageIds`).
- **Grey pin** — park is within the distance radius but has no bookable availability matching filters.
- Pins hard-removed by distance filter do not appear at all.
- Walk-up sites (`is_walk_up = true`) are always excluded from pin-lighting (enforced server-side by `getParkAvailabilityCounts()` filtering on the typed column).
- Day-use sites (`is_day_use = true`) are excluded from every query.

**Detail panel** (`DetailPanel` component in `MapClient.tsx`):

- Opens when a pin is clicked; overlays the right side of the viewport (`.map-detail-panel`).
- Shows park name, `ProviderBadge`, campground/site counts, and "Cache as of X ago".
- Fetches availability via `useParkAvailability()` hook, which calls `GET /api/map/availability` with `facilityPageIds`, `parkPageId`, `from`, `to`, `provider`, `access`, `kinds`, `hide`. Taxonomy filtering is fully server-side (no client-side `passesSiteFilters`). Result is cached per `(parkPageId|from|to|filters)` key.
- **Weekends mode** (when "Weekends only" is on) — renders `WeekendRow` for each `WeekendEntry`. Stay tiers are filtered by `minNights` (e.g. `minNights=2` hides the 1-night tiers; `minNights=3` shows only Fri–Mon):
  - Fri–Mon (3N): `sites3Night` + `BookLink(arrival=fridayDate, nights=3)`
  - Fri–Sun (2N): `sites2NightFri` + `BookLink(arrival=fridayDate, nights=2)`
  - Sat–Mon (2N): `sites2NightSat` + `BookLink(arrival=saturdayDate, nights=2)`
  - Fri (1N): `sites1NightFri` + `BookLink(arrival=fridayDate, nights=1)`
  - Sat (1N): `sites1NightSat` + `BookLink(arrival=saturdayDate, nights=1)`
  - `walkUpSites` shown with `WalkUpLine` (walk-up badge, "first-come, not reservable") — never in bookable tier arrays.
- **Dates mode** (when "Weekends only" is off) — renders `DateRow` for each `AvailableDateEntry`. Each row lists available sites per campground and a `BookLink` (arrival = date, nights = `max(minNights, 1)`). N-consecutive-night intersection is applied client-side to the server-returned site lists.
- Empty-state messages are min-stay-aware ("No weekend days in this date range" when weekendsOnly + no Fri/Sat in range; "No N-night stays available" when minNights filter eliminates all results).

**API calls made by this surface** (see [api.md](../api.md)):

| Call | When |
|---|---|
| `GET /api/map/availability?parkPageId=&facilityIds=&from=&to=&provider=&access=&kinds=&hide=` | On park pin click (taxonomy params forwarded; minNights is NOT forwarded — min-stay is applied client-side in dates view and via tier logic in weekends view) |
| `GET /api/map/availability/summary?from=&to=&weekendsOnly=&access=&kinds=&hide=&minNights=` | Debounced 400ms on date range / filter / preset / weekendsOnly / minNights change |

**Invariants:**

- Walk-up sites (`is_walk_up = true`) are excluded from all bookable counts and pin-lighting. They appear only in `WalkUpLine` display rows within the detail panel.
- Day-use sites (`is_day_use = true`) are excluded from every query and never surface in the UI.
- Distance chips render disabled (reduced opacity) until a location resolves; no error toast is shown.
- Rec.gov park availability is fetched using `facilityPageIds` (real DB IDs), not the synthetic `recgov-<parentId>` `parkPageId`, because the synthetic key has no DB row.
- The "all-green" cleared-date state is unreachable: `Anytime` always runs a real query; there is no date-clear button.

---

## Presentation

**Layout** (`.map-page` overrides `.main` defaults — no padding, full height):

```
.map-page
  .map-filters          filter bar (top, --surface bg, bottom border) — four rows
    Row 1 WHEN:   horizon presets (This weekend / Next 2 weeks / Next month / Anytime)
                  + date-from picker + date-to picker + Weekends only pill
    Row 2 STAY:   Min stay pills (Any / 1 / 2 / 3 nights)
                  + location input + "use my location" button + distance chips
    Row 3 TYPE:   Access pills + Site kind pills + Hide pills (taxonomy groups)
    Row 4 META:   summary sentence + Reset (shown when non-default)
  ParkFinder overlay    type-ahead search box (top-right, above map)
  .map-container        Leaflet map (flex:1, fills remaining height)
  .map-detail-panel     400px right overlay (z-index 1000, box-shadow) when park selected
    .map-detail-header  park name + provider badge + close button
    WeekendRow / DateRow list (layout determined by weekendsOnly state)
```

**Leaflet map** (`LeafletMap` component, loaded via `next/dynamic` with `ssr: false`): OpenStreetMap tiles; Nominatim geocoding. Pans to `focusLocation` when a location is resolved; draws a distance circle when `distanceMiles` is set.

**Component links:** `ProviderBadge`, `badge-green`/`badge-gray`/`badge-blue`, `.btn`/`.btn-sm`, `.map-page`/`.map-filters`/`.map-container`/`.map-detail-panel` — defined in [design-system.md](../design-system.md). Taxonomy pill groups are exported from `web/lib/site-taxonomy.ts`.

**Book links** in both tabs use `injectBookingDates(cg.bookingUrl, arrivalDate, nights)` from `web/lib/booking-url.ts` — injects the exact arrival date and night count for ReserveCalifornia.

---

## Reproduction checklist

1. Add `web/app/map/page.tsx` as a `force-dynamic` async server component. Load catalog via `listParksWeb()` and DB parks via `listParksFromDb()`. Merge into `MapPark[]`, grouping Rec.gov facilities by `parentId` (prefix group key with `recgov-`). Pass as `initialParks` prop to `<MapClient>`.
2. Create `web/app/map/MapClient.tsx` as a `'use client'` component. State: `parks`, `selectedPark`, `taxonomyState` (access/kinds/hide), `minNights`, `weekendsOnly`, `horizonPreset`, `locationQuery`, `resolvedLocation`, `distanceMiles`, `availFrom`, `availTo`, `parksInDateRange`.
3. Load the Leaflet map component via `next/dynamic` with `ssr: false` to prevent SSR errors (see [design-system.md](../design-system.md) for the `.map-page` layout class).
4. Implement distance hard-filter: `displayedParks` = parks within `distanceMiles` of `resolvedLocation` (haversine); removed parks do not appear as pins. Set `matchingParkIds` for pin coloring: `null` when no non-distance filter is active (all blue), otherwise the set of `parkPageId`s with availability.
5. Wire `GET /api/map/availability/summary` with a 400ms debounce on date range / taxonomy / weekendsOnly / minNights / preset change. Pass `access`, `kinds`, `hide`, `minNights`, `weekendsOnly`, `from`, `to`. Store result as `parksInDateRange: Set<string>` of `facilityPageIds` (see [api.md](../api.md)).
6. On pin click, open `DetailPanel`. Call `GET /api/map/availability` using `facilityPageIds` (not the synthetic `parkPageId` for Rec.gov groups) so the query hits real DB rows. Cache per `(parkPageId|from|to)` key.
7. Render **Weekends mode** weekend stay tiers (3N Fri–Mon, 2N Fri–Sun, 2N Sat–Mon, 1N Fri, 1N Sat). Filter tiers by `minNights` (hide tiers shorter than minNights). Each tier uses `BookLink` with the correct arrival date and nights from `injectBookingDates()`.
8. Render **Dates mode** date rows with campground site lists. Apply N-consecutive-night intersection client-side to the server-returned site lists. Book links use `max(minNights, 1)` nights. Each row has a `BookLink`.
9. Render `WalkUpLine` for walk-up sites in both modes — badge + "first-come, not reservable". Walk-up sites must never appear in bookable tier arrays or count badges.
10. Implement location geocoding via Nominatim (User-Agent header required: `CampBrain/1.0`). "Use my location" via `navigator.geolocation`. Distance pills render disabled until location resolves.
11. Add taxonomy filter groups from `web/lib/site-taxonomy.ts` (Access / Site kind / Hide pills). Wire to summary API (`access`/`kinds`/`hide` CSV params) and detail API (same params). Do NOT call `passesSiteFilters()` client-side — taxonomy filtering is fully server-side.
12. Verify: distance chip hard-removes pins; date filter greys (not removes) pins; walk-up sites excluded from bookable counts; Book links encode correct arrival + nights; Rec.gov groups show combined availability; Anytime preset always runs a real query; min-stay 2 changes pin counts; Reset restores default state.

---

## Dependencies

- [engines/cache.md](../engines/cache.md) — `getEntriesForParks()` and `getParkAvailabilityCounts()` back the two map API routes
- [api.md](../api.md) — `GET /api/map/availability` and `GET /api/map/availability/summary`
- [data-model.md](../data-model.md) — `MapPark`, `ParkAvailabilityResponse`, `WeekendEntry`, site type columns, walk-up invariants
- [design-system.md](../design-system.md) — `ProviderBadge`, map layout classes, badges, buttons
- `web/lib/site-taxonomy.ts` — taxonomy pill group definitions and param mapping
