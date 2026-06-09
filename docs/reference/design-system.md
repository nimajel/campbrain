# CampBrain — Design System

**Status:** shipped

Single file to edit for visual restyle. The tokens, components, and layout patterns below are the complete shared aesthetic layer. Surface Presentation sections reference this doc rather than duplicating style definitions.

Source files: `web/app/globals.css` (tokens + global classes), `web/app/layout.tsx` (nav/layout shell), `web/app/components/SiteFilterPanel.tsx`, `web/app/components/ParkMapPopover.tsx`, `web/components/ProviderBadge.tsx`, `web/lib/providers.ts`, `web/lib/site-filters.ts`.

> Future: This is the designated entry point for the planned aesthetic polish pass. A restyle touches this file plus the Presentation sections of affected surface docs. Behavior/Contract sections and Reproduction checklists remain untouched, so a re-skin cannot introduce functional regressions in the docs.

---

## Tokens (CSS custom properties)

Defined in `:root` in `web/app/globals.css`:

| Token | Value | Purpose |
|---|---|---|
| `--bg` | `#0f1117` | Page background |
| `--surface` | `#1a1d27` | Card / sidebar background |
| `--border` | `#2a2d3a` | Dividers, input borders |
| `--text` | `#e8eaf0` | Primary text |
| `--muted` | `#8b90a0` | Secondary / label text |
| `--accent` | `#4f8ef7` | Links, active states, focus ring |
| `--green` | `#3ecf8e` | Available / success |
| `--red` | `#ff6b6b` | Unavailable / error |
| `--yellow` | `#f5c842` | Warning / pending |
| `--radius` | `8px` | Default border radius |
| `--font` | `'Inter', system-ui, -apple-system, sans-serif` | Body font stack |

**Tailwind usage:** The project uses Tailwind CSS in the web app but relies primarily on the custom properties above for theming rather than Tailwind's color scale. Layout and spacing classes from Tailwind are used on a case-by-case basis per page.

---

## Layout shell

Defined in `web/app/layout.tsx` + `globals.css`:

```
.layout            flex row, min-height: 100vh
  .sidebar         200px fixed-width, sticky top, --surface background
    .sidebar-brand  "Camp<span>Brain</span>" — span colored with --accent
    nav             7 links: /, /explore, /map, /alerts, /scan-history, /calendar, /settings
  .main            flex:1, padding 32px 40px, max-width 960px
```

The nav links (as of `web/app/layout.tsx`):

| Label | Route |
|---|---|
| Dashboard | `/` |
| Find Campsites | `/explore` |
| Map | `/map` |
| Alerts | `/alerts` |
| Scan History | `/scan-history` |
| Calendar | `/calendar` |
| Settings | `/settings` |

Active link styling: `.sidebar nav a.active` — `color: --text`, `background: rgba(79,142,247,.1)`.

**Map page exception:** `.main:has(.map-page)` removes padding and max-width so the map fills the viewport. The `.map-page`, `.map-filters`, `.map-container`, and `.map-detail-panel` classes handle the full-height layout.

---

## Shared components

### `SiteFilterPanel`

**File:** `web/app/components/SiteFilterPanel.tsx`

**Props:**
```typescript
{
  activeFilters: string[];
  onChange: (activeFilters: string[]) => void;
  include?: string[];  // subset of filter IDs to display; defaults to all
}
```

Renders a row of toggle-button chips from `AVAILABLE_FILTERS` (see `web/lib/site-filters.ts`). Includes a "Clear all" link when any filter is active. Used on `/explore` and `/map`.

**Filter IDs** (from `web/lib/site-filters.ts`):

| ID | Label | Behavior |
|---|---|---|
| `exclude_group` | Exclude group sites | Hides names matching `\bgroup\b` |
| `exclude_walk_up` | Exclude walk-up sites | Hides hike/bike (non-reservable) sites |
| `exclude_day_use` | Exclude day-use & picnic areas | Hides day-use / picnic / dailyuse names |
| `hike_in_only` | Hike-in sites only | Shows only hike-in / walk-in names |
| `exclude_equestrian` | Exclude equestrian sites | Hides equestrian / horse names |
| `exclude_boat_in` | Exclude boat-in sites | Hides boat-in / boat-access names |

Note: `exclude_boat_in` was added in a recent commit. CLAUDE.md's Site Filters table does not yet list it — this doc is authoritative.

---

### `ProviderBadge`

**File:** `web/components/ProviderBadge.tsx`

**Props:** `{ providerId: string; style?: React.CSSProperties }`

Renders a small `.badge` span with the provider label and color class. Provider config is in `web/lib/providers.ts` (`PROVIDER_BADGES`). Used on `/explore` park cards and `/map` detail panel to distinguish CA Parks from Rec.gov parks.

---

### `ParkMapPopover`

**File:** `web/app/components/ParkMapPopover.tsx`

**Props:** `{ parkName: string; lat: number; lon: number; children?: React.ReactNode }`

Renders a geocoded OpenStreetMap iframe embed for a park name, with optional children overlaid. Uses Nominatim to look up coordinates (with in-session cache) when lat/lon are not provided. This component is used by legacy alert/scan-history views; the `/map` page uses its own inline detail panel in `MapClient.tsx`.

---

## Global utility classes

### Badges

```css
.badge           base — inline-block, 11px, uppercase, 600 weight
.badge-green     rgba(62,207,142,.15) bg + --green text
.badge-red       rgba(255,107,107,.15) bg + --red text
.badge-blue      rgba(79,142,247,.15) bg + --accent text
.badge-gray      rgba(139,144,160,.15) bg + --muted text
.badge-match     rgba(62,207,142,.2) bg + --green text, 12px, slightly larger padding
```

### Status dots

```css
.dot             8×8px circle, inline-block, margin-right: 6px
.dot-green       --green fill
.dot-red         --red fill
.dot-gray        --muted fill
.dot-yellow      --yellow fill
```

### Cards and layout

```css
.card            --surface bg, 1px --border border, --radius corners, 20px padding, 16px bottom margin
.page-header     32px bottom margin (wraps H1 + .page-subtitle)
.page-subtitle   --muted colored paragraph
.grid-2          2-column CSS grid, 16px gap
.grid-3          3-column CSS grid, 16px gap
.stat-label      11px, uppercase, --muted — metric label above a large number
.stat-value      24px, 700 weight — the large number
.section-title   11px, uppercase, --muted — section divider with bottom border
```

### Buttons

```css
.btn             inline-flex, 8px 16px padding, 13px 600-weight
.btn-primary     --accent bg, white text
.btn-ghost       --border bg, --text text
.btn-sm          5px 10px, 12px font
.btn-danger      red-tinted bg + --red text
.btn-success     green-tinted bg + --green text
.btn:disabled    opacity .5, not-allowed cursor
```

### Availability states

```css
.avail-available   --green text, 600 weight
.avail-unavailable --red text
.avail-unknown     --muted text
```

### Status chips

```css
.chip        inline-flex, 3px 10px, 12px, 500 weight
.chip-green  green-tinted
.chip-red    red-tinted
.chip-gray   --muted-tinted
.chip-yellow yellow-tinted
```

### Map-specific classes

```css
.map-page          full-height flex column (overrides .main defaults)
.map-filters       filter bar above map — --surface bg, bottom border
.map-container     flex:1, fills remaining height
.map-detail-panel  400px right panel, absolute, z-index 1000, box-shadow
```

---

## Dependencies

No upstream dependencies. The following surfaces depend on this doc:
- [surfaces/explore.md](surfaces/explore.md)
- [surfaces/map.md](surfaces/map.md)
- [surfaces/dashboard.md](surfaces/dashboard.md)
