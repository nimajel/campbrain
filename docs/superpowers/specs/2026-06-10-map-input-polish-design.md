# Map Input Polish + Soonest Sort (P6) — Design

**Date:** 2026-06-10
**Status:** approved
**Backlog:** P6 in [2026-06-09-map-view-improvements.md](2026-06-09-map-view-improvements.md) + the P4 "Soonest opening" fast-follow (unblocked once the alert scanner landed and released `availability-cache.ts`).

## 1. Themed date-range picker

- New dependency: **react-day-picker v9** (range mode, headless styling).
- New `web/app/map/DateRangePicker.tsx`: trigger pill showing the active range
  ("Jun 12 – Jun 15"); opens a popover `<DayPicker mode="range">` — 2 months on
  desktop, 1 month inline (full-width) in the mobile filters sheet (`mobile` prop).
- Selecting a range sets `availFrom`/`availTo` and derives the preset highlight exactly
  as the native inputs did (`derivePreset`). Clear/blank end keeps "Anytime" semantics.
- Native `<input type="date">` pair removed from the WHEN row.
- Themed in `globals.css` via rdp CSS variables: `--rdp-accent-color: var(--accent)`,
  range-middle in `--accent-soft`, sand hovers, naturalist borders/radius.
- Past dates disabled (`disabled={{ before: today }}`), matching the old `min` attrs.

## 2. Clearer geocode controls

- Input placeholder → "City or place…"; `→` button → labeled **Search**; `📍` button →
  **"Use my location"** text button. Resolved (✓ name) and error states unchanged.

## 3. Soonest sort (end to end)

- `availability-cache.ts`: refactor `siteMatchesMinStay` to delegate to a new exported
  `firstMatchingArrival(dates, opts): string | null` (TDD; boolean wrapper kept).
  `ParkAvailabilityCount` gains `soonestDate: string | null` —
  SQL path: `MIN(a.date) FILTER (WHERE NOT s.is_walk_up)::text` (DOW clauses apply, so
  weekends-only yields the soonest weekend date); min-stay path: min
  `firstMatchingArrival` across bookable sites per park. Walk-up-only parks → null.
- Summary route passes `soonestDate` through; `ParkAvailabilitySummary` and
  `availByPark` aggregation take the min across facilities.
- `park-list.ts`: `ParkListRow.soonestDate: string | null`; `sortParkRows('soonest')` —
  ascending, nulls last, name tiebreak (TDD).
- `ResultsList`: "Soonest" pill becomes a real sort option; when active, rows show
  "opens Fri, Jun 19" in the sub-line (before the distance).

## 4. Focus-visible pass

- `globals.css`: visible `:focus-visible` ring (2px `var(--accent)` outline + offset) on
  `.btn`, `.map-results-row`, sort pills, and the date-picker trigger.

## Out of scope

- Date picker on `/explore` (its native inputs are a separate surface — follow-up)
- Geocode autocomplete/suggestions (Nominatim rate limits; v1 stays submit-based)
