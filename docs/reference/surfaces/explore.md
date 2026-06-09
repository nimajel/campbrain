# Surface: /explore — Find Campsites

**Status:** shipped

## Purpose

Date-range availability search across all California (and Rec.gov) campgrounds, returning parks with reservable sites and walk-up-only parks grouped by region.

---

## Behavior / Contract

**Route:** `GET /explore` — Next.js App Router page, `force-dynamic` server component that immediately renders the client shell (`FindCampsitesClient`). No server-side data fetch; all data is loaded client-side.

**API consumed:** [`GET /api/search`](../api.md#get-apisearch) — called on every change to check-in date, check-out date, region, or server-side filters. `exclude_walk_up` is applied client-side only; all other active filter IDs are forwarded as the `filters` query parameter.

**Inputs / filters:**

| Control | Implementation |
|---|---|
| Check-in / Check-out date pickers | Native `<input type="date">` — picker UI, not free text. `checkIn` must be before `checkOut`. |
| Nights (computed) | Derived as `dayjs(checkOut).diff(dayjs(checkIn), 'day')` — displayed, not user-entered. |
| Region chips | `CampRegion` slugs from `web/lib/regions.ts`; sent as `region` param; "All" sets to `null`. |
| Site filters | Six toggle chips from `SiteFilterPanel` (see [design-system.md](../design-system.md)). Filter IDs from `web/lib/site-filters.ts`. `exclude_walk_up` controls display only; all others are forwarded to `/api/search`. |

**Site filter IDs** (authoritative list in `web/lib/site-filters.ts`):
`exclude_group`, `exclude_walk_up`, `exclude_day_use`, `hike_in_only`, `exclude_equestrian`, `exclude_boat_in`.

**Output states:**

- *Pre-search* — prompt to pick dates.
- *Loading* — "Searching…" message.
- *Error* — red card showing the HTTP error or network message.
- *Results — bookable parks* — park cards sorted descending by `totalAvailable`; each shows site count badge (`badge-green`) and can be expanded to see campground rows.
- *Walk-up-only parks* — parks where `totalAvailable === 0` but walk-up sites exist; shown below bookable parks when `exclude_walk_up` is not active.
- *Fallback panel* — shown when `data.fallback` is non-null (no bookable sites in range); suggests alternate dates within 60 days.

**Invariants:**

- Walk-up sites (hike/bike, matched by `isWalkUpSite()` from `web/lib/site-filters.ts`) are **never counted** in `park.totalAvailable` or the green site-count badge. They are surfaced only in `cg.walkUpSites` with a `walk-up` badge and "first-come, not reservable" label.
- Walk-up exclusion from `totalAvailable` is enforced server-side by the materialized view `mv_available_stays` (see [data-model.md](../data-model.md)). Client-side `exclude_walk_up` only hides the display rows.
- Data shapes (`SearchApiResponse`, `SearchParkResponse`) are defined in `web/app/api/search/route.ts` and referenced in [api.md](../api.md).
- The `exclude_walk_up` filter never reaches the server — it is stripped in `FindCampsitesClient` before building the query string (`serverFilters = activeFilters.filter(f => f !== 'exclude_walk_up')`).

---

## Presentation

**Page shell** (`web/app/explore/page.tsx`):

```
.page-header
  h1 "Find Campsites"
  p.page-subtitle "Search available campsites across California"
FindCampsitesClient   (client component)
```

**Search form** (inside `.card`):

- Date row: two `<input type="date">` labels (Check-in, Check-out) + derived nights label.
- Region row: "All" + one `btn btn-sm` per `CampRegion`; active region uses `btn-primary`.
- Filter row: `SiteFilterPanel` component (see [design-system.md](../design-system.md)).

**ParkCard** (collapsed by default — the primary performance win):

- Header: arrow icon (rotates 90° on open), park name, region badge (`badge-gray`), `ProviderBadge`, site-count badge (`badge-green`) or "walk-up only" badge (`badge-gray`).
- Expanded: one row per campground with sites that have availability. Each row shows campground name, `$X/night · $Y total` pricing, a `btn btn-sm btn-success` "Book ↗" link (only when `cg.bookingUrl` exists and `hasAvail`), then green `chip chip-green` chips for bookable site names, then walk-up badge + muted chips for walk-up sites.
- Book link uses `injectBookingDates(cg.bookingUrl, checkIn, nights)` from `web/lib/booking-url.ts` — injects the exact check-in date and night count into the ReserveCalifornia URL.

**Component links:** `.card`, `.badge-green`, `.badge-gray`, `.chip`, `.chip-green`, `.btn-success`, `.page-header`, `.page-subtitle` — all defined in [design-system.md](../design-system.md). `SiteFilterPanel` and `ProviderBadge` are described there too.

**Performance note:** No pre-computed flat lookup or `React.memo` on this surface — results are API-driven; performance is gated by the `/api/search` response time, not client-side filter toggling. The `<200ms filter toggle` budget applies when filters change synchronously against already-loaded data; here each filter change triggers a new API fetch.

---

## Reproduction checklist

1. Add `web/app/explore/page.tsx` as a `force-dynamic` server component with a `.page-header` block and `<FindCampsitesClient />`.
2. Create `web/app/explore/FindCampsitesClient.tsx` as a `'use client'` component. State: `checkIn`, `checkOut`, `selectedRegion`, `activeFilters`, `data`, `loading`, `error`.
3. Render two `<input type="date">` controls (Check-in, Check-out). `checkOut` must enforce `min={dayjs(checkIn).add(1,'day').format()}`. Do not use free-text date input (see project date-picker preference).
4. Add region chip buttons using `ALL_REGIONS` + `REGION_LABELS` from `web/lib/regions.ts`. Selected region sends `region` param; "All" sends nothing.
5. Add `<SiteFilterPanel>` from `web/app/components/SiteFilterPanel.tsx` (see [design-system.md](../design-system.md) for props).
6. On every change to dates, region, or filters, call `GET /api/search?from=&to=&region=&filters=` (see [api.md](../api.md)). Strip `exclude_walk_up` from the server-bound `filters` param.
7. Render results as `ParkCard` components — collapsed by default. Show `totalAvailable` badge or "walk-up only" badge. Never count walk-up sites in the badge number.
8. In each expanded campground row: show pricing, a "Book ↗" link via `injectBookingDates()` (arrival = `checkIn`, nights = derived count), green chips for `availableSites`, walk-up badge + muted chips for `walkUpSites`.
9. Show the fallback panel when `data.fallback` is non-null (no bookable availability).
10. Verify: no walk-up sites appear in the bookable site count; Book link encodes correct arrival date + nights; filters respond correctly (server refetch on most filters; display-only for `exclude_walk_up`).

---

## Dependencies

- [engines/cache.md](../engines/cache.md) — `mv_available_stays` powers `/api/search`
- [api.md](../api.md) — `GET /api/search` contract
- [data-model.md](../data-model.md) — `SearchApiResponse`, `SearchParkResponse`, walk-up site invariants
- [design-system.md](../design-system.md) — `SiteFilterPanel`, `ProviderBadge`, badges, chips, buttons
