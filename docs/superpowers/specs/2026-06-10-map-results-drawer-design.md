# Map Results Drawer (P4) — Design

**Date:** 2026-06-10
**Status:** approved (interactive prototype reviewed by user)
**Backlog:** P4 in [2026-06-09-map-view-improvements.md](2026-06-09-map-view-improvements.md)

## Goal

Turn `/map` from a lookup tool into a planning tool: a collapsible left drawer listing
every park that matches the current filters, sortable, with rows synced to pins both
ways. A camper can compare "which parks have weekend stays near me" without clicking
pins serially.

## Decisions (validated via interactive prototype)

1. **Collapsible left drawer**, ~290px, closed by default. Toggle button top-left of
   the map area, labeled with the live count ("≡ 8 parks") so the feature is
   discoverable while closed. Map stays full-bleed when closed; detail panel keeps the
   right side (open layout: list → map → detail).
2. **Rows = parks matching current filters**, including walk-up-only parks (amber
   "walk-up only" label) — note `filteredParks` excludes those (it requires bookable
   sites), so the list derives its own row set from `displayedParks` ∩
   `availByPark` counts > 0 (bookable or walk-up).
3. **Row content:** park-type glyph (reuses `GLYPHS`/`getParkType` from
   `web/lib/map-pins.ts`), park name, green "N sites" (or amber "walk-up only"), and
   "· N mi" when a location is resolved.
4. **Sort:** segmented control — Most sites / Nearest / A–Z. Nearest disabled without
   a resolved location. Default: Nearest when location set, else Most sites (auto
   until the user explicitly picks; explicit choice sticks). A disabled "Soonest" pill
   marks the fast-follow.
5. **Sync:** row click = pin click — both call `handleSelectPark` (which flies/zooms
   to the park via `FlyTo` and opens the detail panel; zoom-on-click confirmed as a
   requirement and already implemented). Selected row highlighted; pin click scrolls
   its row into view when the drawer is open.
6. **MVP needs zero API or cache changes** — counts come from the existing summary
   data (`availByPark`), distance from client-side haversine, names from the catalog.
   "Soonest opening" sort is a fast-follow requiring a new summary field + cache
   query (deferred while the alert-scanner session owns `src/cache/availability-cache.ts`).

## Components

- `web/lib/park-list.ts` — `ParkListRow`, `ParkListSort`, pure `sortParkRows()`
  (unit-tested; nulls-last for distance, name tiebreak everywhere).
- `web/app/map/ResultsList.tsx` — drawer UI: header count, sort pills, rows,
  scroll-into-view on external selection. Props in, callbacks out; no fetching.
- `MapClient.tsx` — `listOpen` / `listSort` state, `listRows` memo, toggle button,
  renders `<ResultsList>`.
- `globals.css` — `.map-results-*` classes, naturalist tokens.

## Out of scope (fast-follows)

- "Soonest opening" sort (needs cache query — wait for alert session to land)
- Hover row → highlight pin (forces divIcon regeneration; add if missed)
- Mobile drawer behavior (P5 owns mobile)
- List virtualization (141 parks max; plain rows are fine)
