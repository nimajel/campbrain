# CampBrain — Design System

**Status:** shipped

Single file to edit for visual restyle. The tokens, components, and layout patterns below are the complete shared aesthetic layer. Surface Presentation sections reference this doc rather than duplicating style definitions.

Source files: `web/app/globals.css` (tokens + global classes), `web/app/layout.tsx` (nav/layout shell), `web/app/components/SiteFilterPanel.tsx`, `web/app/components/ParkMapPopover.tsx`, `web/components/ProviderBadge.tsx`, `web/components/ui/` (component library — 14 primitives), `web/lib/providers.ts`, `web/lib/site-filters.ts`.

> Future: This is the designated entry point for the planned aesthetic polish pass. A restyle touches this file plus the Presentation sections of affected surface docs. Behavior/Contract sections and Reproduction checklists remain untouched, so a re-skin cannot introduce functional regressions in the docs.

---

## Tokens (CSS custom properties)

Defined in `:root` in `web/app/globals.css`. The theme is an earthy light palette:

| Token | Value | Purpose |
|---|---|---|
| `--bg` | `#ece5d6` | Tinted sand page background |
| `--surface` | `#ffffff` | Cards, panels, fields |
| `--surface-2` | `#fbfaf6` | Off-white page body |
| `--surface-sunken` | `#f6f3ec` | Inset rows, segmented tracks |
| `--border` | `#e7e1d4` | Dividers, input borders |
| `--text` | `#2f3a2e` | Deep forest — primary text |
| `--muted` | `#5c6657` | Secondary / label text |
| `--accent` | `#3a6b4f` | Forest green — links, active states, focus ring |
| `--accent-soft` | `#e3efe6` | Tinted green background for badges/chips |
| `--green` | `#3a6b4f` | Available / match (unified with `--accent`) |
| `--red` | `#b3402f` | Muted brick — unavailable / error |
| `--yellow` | `#a8481f` | Sunset accent (kept name for back-compat) |
| `--warn` | `#a8481f` | Warning text color |
| `--warn-soft` | `#f6e7d6` | Warning tinted background |
| `--walkup` | `#b8860b` | Golden amber — walk-up / first-come badge |
| `--radius` | `10px` | Default border radius |
| `--radius-lg` | `16px` | Large radius (modals) |
| `--shadow-sm` | `0 1px 3px rgba(60,70,50,.10)` | Card shadow |
| `--shadow-float` | `0 8px 26px rgba(40,40,30,.18)` | Floating element shadow |
| `--font` | `var(--font-inter), 'Inter', system-ui, -apple-system, sans-serif` | Body font |
| `--font-display` | `var(--font-fraunces), 'Fraunces', Georgia, serif` | Display / heading font |

**Styling approach:** No Tailwind. The project uses custom CSS classes and the token system above, all defined in `globals.css`. Component styles are applied via these shared classes rather than utility-class composition.

**Known token note:** `.badge-blue` and `.badge-green` resolve to identical computed styles in this theme — both use `--accent-soft` background and `--accent` text. They are kept as separate class names for semantic intent but are visually indistinguishable until a future token split.

---

## Layout shell

Defined in `web/app/layout.tsx` + `globals.css`. The layout is a top-nav column, not a sidebar:

```
.layout            flex column, min-height: 100vh
  .topnav          64px header, grid 1fr auto 1fr, --bg background
    .topnav-brand  "Camp<span>Brain</span>" — span colored with --accent (Fraunces font)
    .navpill       center pill nav: floating --surface rounded pill with nav links
    .topnav-avatar right — 30px avatar circle
    .topnav-burger mobile hamburger (shows on narrow viewports)
  .main            flex:1, max-width 1100px, centered, padding 28px 40px, --surface-2 background
```

The nav links (from `web/app/components/nav-links.ts`):

| Label | Route |
|---|---|
| Campsites | `/explore` |
| Map | `/map` |
| Alerts | `/alerts` |
| Scan History | `/scan-history` |
| Calendar | `/calendar` |
| Settings | `/settings` |

Active link styling: `.navpill a.active` — `background: --accent`, `color: #fff`.

**Map page exception:** `.main:has(.map-page)` removes padding and max-width so the map fills the viewport. The `.map-page`, `.map-filters`, `.map-container`, and `.map-detail-panel` classes handle the full-height layout.

---

## Component Library

`web/components/ui/` — 14 typed primitive components, thin React wrappers over the `globals.css` class system. No new CSS was introduced for the library (one `focus-visible` rule for Toggle was added to `globals.css`). Import from the barrel:

```typescript
import { Badge, Button, Chip, StatusDot, SiteChip, EmptyState,
         Card, StatCard, PageHeader, SectionTitle, KVList, KVRow,
         Input, Toggle, Modal } from '@/components/ui';
```

| Component | Wraps classes | Exported types |
|---|---|---|
| `Badge` | `.badge .badge-{tone}` | `BadgeTone` |
| `Button` | `.btn .btn-{variant}` | `ButtonProps`, `ButtonVariant` |
| `Chip` | `.chip .chip-{tone}` | `ChipTone` |
| `StatusDot` | `.dot .dot-{tone}` | `DotTone` |
| `SiteChip` | `.chip` + site icon logic | `SiteChipProps` |
| `EmptyState` | `.empty` | — |
| `Card` | `.card` | — |
| `StatCard` | composes `Card` + `.stat-label`/`.stat-value` | — |
| `PageHeader` | `.page-header`/`.page-subtitle` | — |
| `SectionTitle` | `.section-title` | — |
| `KVList` / `KVRow` | `.kv-row`/`.kv-key`/`.kv-val` | — |
| `Input` | `<input>` global form styles | — |
| `Toggle` | `.toggle`/`.toggle-slider` | — |
| `Modal` | `.modal-backdrop`/`.modal` | — |

**Migration policy:** New UI must use the library. Existing pages migrate opportunistically when touched. The dashboard (`web/app/page.tsx`) was the first page migrated; rendered markup is class-identical to the pre-migration version.

### Storybook

`@storybook/nextjs-vite` 9.1 with `@storybook/addon-docs`. Config in `web/.storybook/` (`main.ts`, `preview.tsx`).

- `preview.tsx` imports `globals.css` and loads Inter + Fraunces fonts, matching the app's font setup. Autodocs enabled. Backgrounds preset to app token values (`--surface-2` / `--bg`).
- Stories for all 14 library components are co-located as `*.stories.tsx` in `web/components/ui/`.
- Stories for existing shared components also exist: `ProviderBadge`, `SiteFilterPanel`, `DateRangePicker`, `MapLegend` (components themselves unmodified).

```
npm run storybook            # component catalog on :6006
npm --prefix web run build-storybook   # static build
```

---

## Shared components

### `SiteFilterPanel`

**File:** `web/app/components/SiteFilterPanel.tsx`

**Props:**
```typescript
{
  state: TaxonomyState;
  onChange: (next: TaxonomyState) => void;
  groups?: Array<'access' | 'kinds' | 'hide'>;  // defaults to all three
  dense?: boolean;                               // tighter spacing for map filter bar
}
```

`TaxonomyState` is `{ access: SiteAccess[]; kinds: SiteKind[]; hide: HideTarget[] }` from `web/lib/site-taxonomy.ts`. Renders three labeled pill groups (Access / Site kind / Hide). Used on `/explore` and `/map`.

See CLAUDE.md "Site Filters" for the full taxonomy table.

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
.badge-green     --accent-soft bg + --accent text
.badge-red       --warn-soft bg + --warn text
.badge-blue      --accent-soft bg + --accent text  (same as .badge-green in current theme)
.badge-gray      --surface-sunken bg + --muted text
.badge-match     --accent-soft bg + --accent text, 12px, slightly larger padding
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
.btn-ghost       --surface-sunken bg, --text color, --border border
.btn-slate       --surface-2 bg, --muted color, --border border
.btn-sm          5px 10px, 12px font
.btn-danger      --warn-soft bg + --warn text
.btn-success     --accent-soft bg + --accent text
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
.chip        inline-flex, 3px 11px, 12px, 500 weight
.chip-green  --accent-soft bg + --accent text
.chip-red    --warn-soft bg + --warn text
.chip-gray   --surface-sunken bg + --muted text
.chip-yellow --warn-soft bg + --warn text
```

### Toggle switch

```css
.toggle          relative 36×20px label wrapper
.toggle-slider   pill track: --border when off, --accent when checked
                 focus-visible: 2px --accent outline (added with component library)
```

### Modal

```css
.modal-backdrop  fixed overlay, rgba(40,40,30,.35) bg, z-index 100
.modal           --surface bg, --radius-lg corners, 28px padding, max-width 640px
.modal-header    flex row, space-between — title + close button
.modal-close     ghost X button (type="button" — does not submit forms)
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
