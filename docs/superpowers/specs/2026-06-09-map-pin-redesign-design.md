# Map Pin Redesign — Availability-First, Token-Driven Markers

**Date:** 2026-06-09
**Status:** approved design, ready for implementation planning
**Parent:** [2026-06-09-map-view-improvements.md](2026-06-09-map-view-improvements.md) — this is the design for backlog item **P2** (full scope: pins, legend, count badges, clustering)

## Problem

The `/map` pins are stock `leaflet-color-markers` PNGs hot-loaded from a GitHub raw URL. Their colors (`#2AAD27`, `#2A81CB`, …) predate the Naturalist redesign and cannot reference theme tokens. The color channel is overloaded: it encodes agency (4 colors), availability (grey), and selection (gold) at once — 7 legend entries — and availability, the camper's #1 question, doesn't own the dominant channel.

## Visual system (settled with visual mockups)

Each marker is built from independent channels:

| Channel | Encodes | Values |
|---|---|---|
| Fill | Availability | forest green `var(--accent)` = bookable match · hollow (surface fill, muted stroke) = no match · golden amber `var(--walkup)` = walk-up only (a dedicated token — sunset/warn read as "bad/unavailable" rather than "show up in person") |
| Glyph | Park type | **CA outline** = CA State Parks (`provider === 'california-parks'`) · **star** = federal / Recreation.gov (all other providers). White on filled pins, muted on hollow pins — type stays readable in every state |
| Ring | Selection | **tone-on-tone**: the pin's own fill darkened ~40% (`color-mix(in srgb, <fill-token> 60%, black)`; hollow pins use `var(--muted)`), over a white casing. Selection reads as "this pin, emphasized" and borrows no availability color — sunset was tried first and read as an alert, worst on amber walk-up pins. Ring color is set via `style=` because `color-mix()` needs a CSS context, not an SVG attribute |
| Badge | Match count | top-right bubble. Green with bookable site count on match pins; sunset with walk-up site count on walk-up-only pins; hidden on no-match pins; display capped at "99+" |

Render precedence: fill from availability state → glyph from type → ring if selected.

Pin states:

1. **Bookable match** — green fill, white glyph, green count badge.
2. **No match** — hollow: `var(--surface-2)` fill, `var(--muted)` stroke + glyph, marker opacity 0.8. Still clickable (detail panel shows next opening).
3. **Walk-up only** — `siteCount = 0 && walkUpCount > 0`: amber fill, white glyph, amber badge. When the `exclude_walk_up` site filter is active, the server's walk-up count query applies the same `FILTER_SQL`, so `walkUpCount` is 0 and the park renders as no-match — no special client logic.
4. **Selected** — tone-on-tone ring overlay (darkened self) on any of the above.

No date filter active → all parks render as "match" without badges (today's behavior, preserved).

### Legend

Collapsible **"Key" pill**, bottom-left of the map: a small pill that expands to the full legend card on hover/tap. Five entries: green pin "Sites available", sunset pin "Walk-up only", hollow pin "No availability" (row shown only when a date filter is active, as today), CA glyph "CA State Park", star glyph "Federal · Recreation.gov". Selection has no legend entry — the ring plus flyTo is self-evident. The collapse behavior intentionally pre-builds what the mobile pass (P5) needs.

### Tooltips / a11y

`divIcon` markers have no `alt` image attribute, so: the icon's root element carries `role="img"` and `aria-label` = park name, and each marker gets a react-leaflet `<Tooltip>` showing park name, park type in words, and match count. This folds in the corresponding P1 backlog item ("marker alt/title = park name").

## Architecture

### New module: `web/lib/map-pins.ts`

`buildPinHtml` and `PIN_LEGEND` are pure and Leaflet-free (that's what makes them unit-testable without a DOM); only `makePinIcon` imports Leaflet:

- `buildPinHtml({ parkType, availability, count, selected }): string` — returns the marker's SVG/HTML string. All colors written as CSS custom properties (`var(--accent)`, `var(--warn)`, `var(--walkup)`, `var(--muted)`, `var(--surface-2)`). Because `L.divIcon` HTML lives in the page DOM, the tokens resolve naturally — the theme is the single source of truth and a future restyle reaches the pins for free.
- `makePinIcon(opts): L.DivIcon` — thin wrapper calling `buildPinHtml`, memoized in a module-level `Map` keyed by `(type|state|count|selected)`.
- `PIN_LEGEND` — legend entries exported from the same state definitions, so legend and pins cannot drift.

### Deletions from `LeafletMap.tsx`

- `leaflet-color-markers` GitHub icon URLs and `makeIcon`
- The unpkg `L.Icon.Default` path hack (no marker uses the default icon afterward; the search-location `CircleMarker` is unaffected)
- The hardcoded `LEGEND` array (replaced by `PIN_LEGEND`)

### Clustering

The web app is on react-leaflet 5 / React 19 (no maintained cluster plugin), so use `leaflet.markercluster` directly behind a small client component `web/app/map/MarkerClusterGroup.tsx` (~40 lines, standard pattern). Behavior:

- Clustering active only below zoom 9 (`disableClusteringAtZoom: 9`); `maxClusterRadius: 45` — both are tuning defaults, adjustable after the squint test
- Cluster bubble is a **donut** divIcon styled with the same tokens: surface-white circle, sand (`var(--border)`) ring track, and a green (`var(--accent)`) arc proportional to the share of clustered parks with bookable matches (full ring = all, no arc + muted body = none; a minimum sliver keeps 1-of-many visible). Body shows a two-teardrop "stack of pins" glyph + total park count, so cluster numbers (parks) read as a different species from pin badges (sites)
- Walk-up-only parks do not count toward the green arc (consistent with pin-lighting)
- Cluster click zooms in (library default)

### API contract change

`GET /api/map/availability/summary` response changes from `{ parks: string[] }` to:

```json
{ "parks": [ { "parkPageId": "p123", "siteCount": 12, "walkUpCount": 3 } ] }
```

- `getParksWithAvailability` (`src/cache/availability-cache.ts`) changes from returning park IDs to `GROUP BY` park with `COUNT(DISTINCT s.site_id)` — identical WHERE clauses (dates, weekends, site filters), so *which* parks match is unchanged. `DISTINCT` preserves the dedupe-across-overlapping-scan-windows discipline.
- Walk-up counts come from a parallel query with the same clauses but the walk-up name pattern required instead of excluded (site filters still applied). Parks appear in the response when `siteCount > 0 OR walkUpCount > 0`; all other parks are derived as no-match client-side (same as absence from today's set).
- `MapClient.tsx` stores `Map<parkPageId, { siteCount, walkUpCount }>` instead of `Set<string>` and passes it to `LeafletMap`. The "N match" readout counts parks with `siteCount > 0` (walk-up-only parks are not "matches").

## Edge cases

- Park without coordinates → filtered out before rendering (unchanged)
- Summary fetch failure → no filter applied, pins render as match-state without badges (today's failure behavior)
- Selected park with no match → hollow fill + sunset ring
- Count > 99 → "99+"
- `exclude_walk_up` filter active → `walkUpCount` treated as 0 (no sunset pins)

## Testing

- **Vitest, `web/lib/map-pins.ts`**: pure-string tests for `buildPinHtml` — correct glyph per park type, correct fill per availability state, badge shown/hidden/capped, ring only when selected, `PIN_LEGEND` covers every visible state
- **Cache tests**: extended for the count query — set of matching parks identical to the previous ID list; counts dedupe sites across overlapping windows; walk-up counts respect site filters
- **Manual verification**: `npm run typecheck`, `npm test`, `/map` loads with no console errors or hydration warnings, squint test on the live map

## Out of scope

Detail panel content (P3), synced results list (P4), mobile bottom sheets (P5), date-picker theming (P6), and the remaining P1 quick-wins except the marker `alt`/`title` item, which falls out of rebuilding the markers.
