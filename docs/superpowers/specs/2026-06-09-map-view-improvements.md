# Map View Improvements — Critique & Prioritized Backlog

**Date:** 2026-06-09
**Status:** backlog — items are tackled one at a time, top to bottom
**Source:** Live walkthrough of `/map` at desktop (1440×900) and mobile (375×812) widths, as a California-camper persona: fresh landing → 2-week date range → pin click (Point Reyes) → dropdown select (Anza-Borrego, fully booked) → mobile resize.

This document is the umbrella backlog. Each item below gets its own short design
(discussed and approved before implementation), then ships independently. Check items
off as they land.

---

## What already works — do not regress

- Muted CARTO basemap + naturalist palette; calm, outdoorsy first impression
- Grey-out (not remove) for pins that fail date/site filters
- Weekend stay tiers (Fri–Mon 3N, Fri–Sun 2N, Sat–Mon 2N, Fri 1N, Sat 1N) — answers "can I get a weekend?" directly
- "Fully booked through X. Next opening: Y" empty state
- "Cache as of Nm ago" freshness line
- "2 weeks" / "1 month" quick date buttons
- No console errors; data layer is solid

---

## Findings (condensed)

1. **Mobile unusable** — filter chips crush into a ~40px column of truncated text, map becomes a sliver, legend collides with chips, controls spill into dead-space scroll below the map.
2. **Initial view wastes the screen** — map opens on half the western US; California occupies the left third.
3. **Pin wall** — 139 anonymous overlapping teardrops on the NorCal coast; no clustering, no hover names, every marker is `alt="Marker"`.
4. **Pin color channel overloaded** — color means agency (green/blue/orange/purple) *and* availability (grey) *and* selection (yellow); seven legend entries. Availability — the camper's #1 question — doesn't own the dominant channel.
5. **No comparison affordance** — answering "where are the good weekends this month?" requires clicking 15 pins serially; no synced list, no per-pin availability density.
6. **Detail panel content is raw** — internal `discoveryStatus` "SUCCESS" badge leaks into UI; site lists are all-caps comma-runs with the Book link drowned at the end; weekend row header dates disagree with the tier label (header "Fri, Jun 12–Sun, Jun 14" vs tier "Fri–Mon (3 nights)"); no prices despite `/explore` having nightly fees.
7. **Selection disorients** — pin click zooms in hard with no way back; dropdown select hard-removes all other pins and the count reads "0 / 141 parks · 0 match", which reads as "nothing available".
8. **Overlaps & small polish** — zoom control overlaps filter bar; dark circle button covers the legend's last row; default-white Leaflet popup duplicates the panel; geocode controls ("Near city…" + → + 📍) are cryptic; native `mm/dd/yyyy` inputs clash with the theme.

---

## Prioritized backlog

### P1 — Quick-wins bundle (orientation + trust fixes)

Small, independent fixes; biggest polish-per-effort. One pass, one PR.
**Design approved 2026-06-09.** Scope: `LeafletMap.tsx`, `MapClient.tsx`, `next.config.ts`.
No API or schema changes.

- [x] Fit initial map bounds to California — replace `center`/`zoom` with `bounds={[[32.3, -124.6], [42.1, -114.0]]}`
- [x] Restore previous map view when the detail panel closes — save center/zoom on first select, fly back when `selectedPark` → null
- [x] Default date range to the upcoming weekend (next Fri→Mon; Sat → today→Mon; Sun → next Fri→Mon) + add a "Weekend" quick button beside "2 weeks" / "1 month" (`web/lib/upcoming-weekend.ts`, 6 unit tests)
- [x] Remove the "SUCCESS" `discoveryStatus` badge and the unused `statusBadge()` helper
- [x] Marker `title` + `alt` = park name (hover tooltip + a11y in one change)
- [x] **Selection ≠ filter:** dropdown park selection no longer affects `filteredParks` counts or pin grey-out — it only opens the panel, flies to the park, and golds the pin. Counts/grey always mean "matches filters (dates, distance, site types)."
- [x] Zoom control → bottom-right (`zoomControl={false}` + `<ZoomControl position="bottomright">`); disable Next.js dev-tools indicator (`devIndicators: false`) which was covering the legend (no legend nudge needed once the indicator was gone)
- [x] Weekend row header becomes **"Weekend of {Fri date}"** — neutral header, exact nights live in the tier lines; deletes the fragile conditional label block
- [x] "Book" becomes a real `btn btn-sm` pill, right-aligned per tier line (flex row), replacing the trailing "Book →" text link

**Problem solved:** first-impression emptiness, trust-damaging jargon, disorienting counts.

### P2 — Pin/marker redesign: availability-first

> **Status: shipped 2026-06-09** — see [2026-06-09-map-pin-redesign-design.md](2026-06-09-map-pin-redesign-design.md) for the full design and `docs/superpowers/plans/2026-06-09-map-pin-redesign.md` for the implementation plan.

As shipped (deltas from the proposed direction below):

- [x] Fill = availability: forest green = bookable match, hollow sand = no match, **golden amber** (`--walkup`, dedicated token) = walk-up only — sunset was tried first and read as "bad/unavailable"
- [x] Park type as glyph on every pin: CA outline = CA State Parks, star = federal/Rec.gov (2 tiers, not 4 agencies)
- [x] Selected = tone-on-tone ring (pin's own fill darkened via `color-mix`) with white casing, over the pin's own fill — selection no longer hides availability and borrows no status color (gold pin and sunset ring were both tried and rejected)
- [x] Count badge per pin (bookable count green / walk-up count sunset, capped 99+)
- [x] Marker clustering below zoom 9 (`leaflet.markercluster` behind a local wrapper); cluster bubbles are donuts — multi-pin glyph + total park count in the body, green ring arc = share of parks with availability (distinguishes cluster park-counts from pin site-badges)
- [x] Legend → collapsible "Key" pill, 5 entries (down from 7)
- [x] Pins are token-driven SVG divIcons (`web/lib/map-pins.ts`); GitHub PNG markers and the unpkg default-icon hack are deleted
- [x] Summary API extended: `getParkAvailabilityCounts` returns `{parkPageId, siteCount, walkUpCount}[]` (the old API returned only matching IDs — counts were NOT already available)
- Note: P1's marker `title`/`alt` was superseded by `aria-label` + a Leaflet `<Tooltip>` (name, park type, match count) — native `title` would double-tooltip

**Problem solved:** findings 3 + 4 — the map starts answering the camper's question at a glance.

### P2.5 — Filter bar rework + site type taxonomy

> **Status: shipped 2026-06-09** — see
> [2026-06-09-map-filter-rework-design.md](2026-06-09-map-filter-rework-design.md) for
> the full design and `docs/superpowers/plans/2026-06-09-map-filter-rework.md` for the
> implementation plan.

- [x] Disambiguate the two "weekend" controls: horizon presets (This weekend / Next 2
  weeks / Next month / Anytime) + a separate "Weekends only" pill replacing the tab
- [x] Persist site types on `sites` (access / site_kind / group / equestrian / walk-up /
  day-use) — classified from CA name patterns and Rec.gov `campsite_type`; replaces
  all query-time name regexes (`FILTER_SQL` deleted); single classifier in
  `src/catalog/site-classifier.ts`
- [x] New filter groups: Access (Drive-in / Hike-in / Boat-in), Site kind (Tent /
  Hookups / Cabin), Hide (Group / Equestrian / Walk-up) — one pill language;
  taxonomy exported from `web/lib/site-taxonomy.ts`
- [x] Min stay (Any/1/2/3, ≥N consecutive nights) reaches the pin summary query via
  gaps-and-islands helper (`siteMatchesMinStay`)
- [x] Day-use sites leave the bookable pool everywhere; "Anytime" preset removes the
  all-green cleared-date state; Reset restores defaults; one summary sentence
  replaces both counts; park dropdown becomes a find-a-park search on the map
- [x] `/explore` adopts the same grouped panel; all filter params sent server-side
- [x] `npm run db:backfill-types` one-off command classifies existing rows by name

**Problem solved:** filter-bar critique 2026-06-09 (scope inconsistencies, weekend
naming collision, include/exclude grab-bag, Rec.gov sites invisible to name filters).

### P3 — Detail panel content redesign

> **Status: shipped 2026-06-10** — plan: `docs/superpowers/plans/2026-06-09-map-detail-panel.md`.

- [x] Site names render as capped, expandable chips (`SiteChips`, first 6 + "+N more"/"less" toggle, max-width ellipsis with full name on hover); `formatSiteName()` in `web/lib/site-display.ts` title-cases all-caps words but preserves mixed case, single letters, digit tokens, and #-prefixed site codes (6 unit tests)
- [x] Nightly fee per campground: `nightlyFee: number | null` added to both campground shapes in `/api/map/availability` (threaded through `buildDateSiteMap` + `cgMeta`); panel shows "· $30/night" after the campground name, omitted when null
- [x] Tier rows restructured: single `TierLine` component (label "Fri–Mon · 3 nights" / chips / right-aligned Book) replaces five copy-pasted tier blocks; `WalkUpLine` keeps badge + "first-come" note with muted chips
- [x] Marker `<Popup>` deleted — P2's hover `<Tooltip>` + the panel are the only surfaces (the search-location popup stays)
- [x] Folded-in P2.5 cleanups: `WeekendRow` prop renamed `nightCount` → `minNights`; dead `web/lib/site-filters.ts` shim deleted; `siteListText()` removed

**Problem solved:** finding 6 — the panel becomes bookable-decision quality.

### P4 — Synced results list (split view)

A collapsible list pane synced with the map: parks with matching availability, sorted
by soonest opening / nearest / most sites. Click list row ↔ highlight pin. Turns the
map from a lookup tool into a planning tool ("15 parks have weekend openings — compare").

**Problem solved:** finding 5. Largest functional bet; design needs care (layout, sort
options, interaction with distance filter).

### P5 — Mobile layout: bottom sheets

Full-bleed map; filters and detail panel become bottom sheets; legend collapses to a
button. *Note: CampBrain runs on localhost — phone use means dev server on LAN. Ranked
below P4 for that reason; bump it up if phone-on-LAN is a real usage pattern.*

**Problem solved:** finding 1.

### P6 — Input & chrome polish

- Styled date-range picker matching the naturalist theme (replaces native `mm/dd/yyyy`)
- Clearer geocode controls (labeled "Search" button, "Use my location" text button)
- Any remaining theming passes (popup, focus states)

**Problem solved:** finding 8 leftovers.

---

## Process

Each item: short design → user approval → implementation plan → implement → verify
(`npm run typecheck`, page loads clean, no hydration warnings) → check off here.
Reference docs (`docs/reference/surfaces/map.md`, `design-system.md`) are updated by
doc-steward after each item ships.
