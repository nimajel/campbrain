# CampBrain Hosted Launch — Phase 1d-2 (Vite Leaflet map page) Design

**Status:** Approved design (2026-06-22). Drives the Phase 1d-2 implementation plan.
**Depends on:** Phase 1d-1 (the `map` tRPC router + `@campbrain/core` map-transforms), shipped on `hosted-launch`.
**Master spec:** `docs/superpowers/specs/2026-06-17-hosted-launch-design.md` (Map IA + web rewrite).

## Goal

Port the legacy Next.js interactive map (`web/app/map/*`, ~1,900 lines of UI + ~400 lines of pure helpers) to the Vite + TanStack-Router + Tailwind/shadcn app at `apps/web`, consuming the Phase-1d-1 `api.map.*` tRPC procedures. This is the **visible live-map milestone** — the home/front-door of the hosted app and a portfolio showcase. After 1d-2, Phase 1 is complete and `hosted-launch` can merge to `main`.

## Decisions (locked with the user, 2026-06-22)

1. **UI fidelity: faithful full port.** Reproduce the legacy behavior 1:1 — all four filter rows (WHEN horizon presets + dates + weekends-only, MIN STAY, NEAR location/distance, ACCESS/KIND/HIDE taxonomy), the weekend-tier detail panel, geocode + haversine distance, marker clustering, results drawer, and the mobile sheet.
2. **Styling: Tailwind v4 + shadcn for all React UI; scoped raw CSS only for Leaflet pins.** One styling system. The `.cb-pin` divIcons are built as imperative HTML strings by Leaflet, so they keep a small scoped CSS block alongside the `leaflet.css` import.
3. **Structure: decompose during the port.** The 1,205-line `MapClient` is split into focused hooks + presentational components (below). Behavior is identical; the monolith is not carried forward.

## Scope

**In 1d-2:**
- Full map page at `/` (replaces `apps/web/src/routes/index.tsx`), full-bleed (override the `__root` `p-4` padding for the index route).
- The decomposed feature module under `apps/web/src/features/map/` (hooks + components + ported pure lib helpers + scoped CSS).
- Leaflet stack: `leaflet`, `react-leaflet`, `leaflet.markercluster` deps + the marker-icon Vite fix + `leaflet.css` imported first.
- Data via the vanilla tRPC client + TanStack Query (`useQuery` wrapping `api.map.catalog/availability/summary`).
- Unit tests for the pure helpers + the extracted client-filter logic; visual verification of the rendered page via the `preview_*` tools.

**Deferred (consistent with phasing):**
- Save-this-search + alert toggles on the map (Phase 2 — the save/alert tRPC mutations + `allowlistedProcedure` don't exist yet).
- URL-search-param hydration from `/saved` (`?savedSearch=<id>`, `weekendsOnly=true` deep-link) — Phase 2.
- Recreation.gov provider + multi-facility (`facilityIds`) grouping — CA-only single `parkPageId`.
- Storybook stories for the new components (Storybook is not set up in `apps/web`).

## Architecture & file layout

```
apps/web/src/
  routes/index.tsx                 MODIFY: render <MapPage/> (full-bleed; override __root p-4 for "/")
  features/map/
    MapPage.tsx                    composition root; runs api.map.catalog; owns selectedPark + layout
    hooks/
      use-map-filters.ts           all filter state (WHEN/preset/dates/weekendsOnly, minNights, taxonomy,
                                    location/distance) + geocode + geolocation handlers + reset + derived
                                    summary-sentence/activeFilterCount/isDefaultState
      use-map-summary.ts           api.map.summary via useQuery, keyed on a debounced filter snapshot;
                                    returns availByPark: Map<parkPageId, {siteCount,walkUpCount,soonestDate}>
      use-park-availability.ts     api.map.availability via useQuery (queryKey = parkPageId + filters);
                                    returns ParkAvailabilityResponse + loading/error
      use-filtered-parks.ts        haversine distance filter + availability merge →
                                    {displayedParks, listRows}
    components/
      FilterBar.tsx                header (menu/toggle/summary-sentence/reset/ParkFinder) + Rows 1–3
      DateRangePicker.tsx          shadcn Calendar (react-day-picker); 2 months desktop / 1 mobile
      SiteFilterPanel.tsx          access / site-kind / hide pill groups
      ParkFinder.tsx               park typeahead (input + dropdown)
      MapView.tsx                  react-leaflet MapContainer (Carto Voyager tiles, CA bounds) +
                                   FlyTo + FocusOnLocation + focus CircleMarker + clusters + MapLegend
      MarkerClusterGroup.tsx       ported ~as-is (createPathComponent + leaflet.markercluster)
      MapLegend.tsx                bottom-left legend (pins + glyphs)
      ParkDetail.tsx               detail panel: weekend-tier rows / dates rows + walk-up + Book links
      ResultsDrawer.tsx            results list + mobile sheet (peek/half/full detent)
    lib/
      map-pins.ts                  pin/cluster/legend HTML builders (teardrop SVG, glyphs, donut)
      site-taxonomy.ts             ACCESS/KIND/HIDE groups + TaxonomyState + taxonomyToParams/isTaxonomyDefault
      booking-url.ts               injectBookingDates(url, arrivalDate, nights)
      site-display.ts              formatSiteName (title-case, de-shout)
      upcoming-weekend.ts          upcomingWeekendRange(today) → {from,to}
      park-list.ts                 sortParkRows + ParkListRow type
      sheet-detent.ts              cycleDetent
      stay-tiers.ts                NEW pure module: weekend-tier selection (by minNights) +
                                   consecutive-night intersection for the dates view (extracted from
                                   the legacy DetailPanel so it is unit-testable)
      map-utils.ts                 haversine, todayIso/addDaysIso, formatDate, relativeTime, isoDow,
                                   rangeHasWeekendDay (the inline MapClient math/format helpers)
    map.css                        scoped: @import leaflet.css (first) + .cb-pin divIcon styles
```

> Before porting each `lib/` helper, the plan must check `@campbrain/core` for an existing pure
> equivalent (e.g. date/weekend helpers, `classifySite`) and reuse it rather than duplicate. UI-only
> helpers (pin HTML, taxonomy UI groups, booking-url injection, display formatting, sheet detent,
> park-list sort) live in `apps/web/src/lib` because they are presentation concerns.

## Data flow

The established `apps/web` pattern is the **vanilla tRPC client** (`createTRPCClient`) + `@tanstack/react-query` (NOT `createTRPCReact`), so each data hook wraps `api.map.<proc>.query()` in `useQuery`.

- **catalog** — `api.map.catalog.query()` once on mount in `MapPage`; feeds the pins. Returns `{ parks: MapPark[] }`.
- **summary** — `api.map.summary.query({ from?, to?, weekendsOnly, access, kinds, hide, minNights? })`, re-run when the (debounced) filter snapshot changes. Drives **pin-lighting** and the results list. Response `{ parks: ParkAvailabilityCount[] }` where `ParkAvailabilityCount = { parkPageId, siteCount, walkUpCount, soonestDate }` — stored as `availByPark` keyed by `parkPageId`.
- **availability** — `api.map.availability.query({ parkPageId, provider?, from?, to?, access, kinds, hide })` on park select (+ active filters). Response `ParkAvailabilityResponse` (`nextAvailableDates[]`, `nextAvailableWeekends[]`, `asOf`, `earliestAvailableDate`). `ParkDetail` renders it.

**Replacements made during the port (the legacy hand-rolled these; TanStack Query subsumes them):**
- The legacy 400ms summary debounce → a debounced filter snapshot feeding the summary query key.
- The legacy in-memory per-park availability cache (keyed by query string) → TanStack Query's cache, keyed by `parkPageId` + filters.

**Pin-lighting (preserved from the legacy):** before summary loads → optimistic "match"; bookable sites > 0 → blue "match"; else walk-up > 0 → orange "walk-up"; else grey "none". Distance hard-filters which pins render; availability greys out non-matching pins.

**minNights stays client-side** (matches the 1d-1 contract: `api.map.availability` does NOT apply `minNights`):
- Weekends view: select which tiers (3N / 2N-Fri / 2N-Sat / 1N-Fri / 1N-Sat) to show per `minNights`.
- Dates view: when `minNights ≥ 2`, intersect available sites across N consecutive dates per campground and keep only dates with a full N-night chain.
- This logic moves into the tested pure `lib/stay-tiers.ts` module rather than living inside the panel component.

## CA-only adaptations (from 1d-1's reduced shapes)

- The legacy `page.tsx` grouped **rec.gov facilities** by `parentId` and computed average lat/lon; the legacy detail fetch passed a `facilityIds` CSV. Both are **dropped** — CA-only means one `MapPark` per park and a single `parkPageId`.
- `availByFacility` (keyed by `facilityPageId`) becomes **`availByPark`** (keyed by `parkPageId`); the summary already returns per-park counts.
- The port consumes the reduced `MapPark` (`provider`, `parkName`, `parkPageId`, `latitude`, `longitude`, `campgroundCount`, `siteCount`, `campgrounds:[{name,siteCount}]`) — no `facilityPageIds` / `sites[]` / `siteTypes`. The provider badge collapses to a simple "CA State Park" label.

## Styling

- All React UI (filter bar, panels, drawer, legend, typeahead) in **Tailwind v4 + shadcn** (Radix primitives), consistent with the rest of `apps/web`.
- **Date picker via shadcn `Calendar`** (react-day-picker under the hood) rather than porting the legacy custom `DateRangePicker`.
- **Scoped CSS** only in `features/map/map.css`: `leaflet.css` imported first, then the `.cb-pin` teardrop/glyph/badge/selected-ring divIcon styles and any cluster-donut styles that Leaflet renders as raw HTML.
- **Tiles:** Carto Voyager (as in the legacy), CA bounds.
- **No SSR boundary** — Vite is a SPA, so Leaflet imports directly (drop `next/dynamic`). `MapView` may optionally be `React.lazy`'d for bundle splitting.

## Testing & verification

- **Unit tests (Vitest)** for the pure helpers and the extracted client-filter logic: `map-pins` HTML builders, `site-taxonomy` param mapping + default detection, `park-list` sort (sites/distance/name/soonest), `sheet-detent` cycle, `upcoming-weekend` range, `booking-url` injection, `site-display` formatting, and — most important — `stay-tiers` (weekend-tier selection by `minNights` + the consecutive-night intersection).
- **Visual verification** via the `preview_*` tools against local `apps/web` + `apps/api` dev servers. The local DB holds real availability (~3.2M rows from prior local scans), so detail panels render real data. Verify: catalog pins load; filter changes re-light pins; park panel shows weekend tiers + Book links with correct injected dates; distance filter + "use my location"; results drawer sort; mobile sheet detents.
- Components themselves are verified visually (not unit-tested) — the testable logic is pushed into the pure `lib/` modules.

## Risks / notes

- **Availability data dependency:** the production map shows catalog pins regardless, but availability panels/pin-lighting need the Phase-1c scanner's manual GitHub-secret setup to populate Neon. Locally this is already populated. Note this in the plan's verification section.
- **`MapClient` size:** the decomposition is the main risk surface — the plan must preserve the exact filter→fetch→light→panel behavior while splitting files. Port behavior 1:1; lean on the inventory of state/effects/render structure produced during brainstorming.
- **Helper reuse vs duplication:** verify each `lib/` helper against `@campbrain/core` before copying, to avoid a second source of truth for shared domain logic.
- **leaflet.markercluster types:** ensure `@types/leaflet.markercluster` (or a local shim) is present for strict TS.
```
