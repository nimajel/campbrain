# CampBrain Aesthetic Redesign — Design Spec

**Date:** 2026-06-09
**Status:** Approved (design phase)
**Topic:** Site-wide visual refresh ("Naturalist" direction), validated first on the map page.

---

## Goal

Move CampBrain from its current generic dark developer-dashboard look to a polished,
ship-ready aesthetic with a coherent identity. The new look is validated on the `/map`
page first, then propagated across every page via the shared design system.

This is a **visual/CSS redesign only**. No data, scanner, cache, or API behavior changes.
Information density, filter response time (<200ms), and all existing functionality must be
preserved.

---

## The Direction: "Naturalist" (light)

Decided through visual brainstorming. The complete, locked direction:

- **Palette** — light & earthy. Forest green primary, warm sand/cream surfaces, sunset
  accent for warnings/walk-up.
- **Typography** — **Fraunces** (serif) for headings/brand; **Inter** (sans) for body,
  data, and UI controls. Headings carry character; tables/data stay neutral and legible.
- **Theme** — **light-only**. No dark variant, no theme toggle. (Removes the existing
  dark theme entirely.)
- **Shell** — **top navigation**, full-width content (no left sidebar). A **centered,
  detached, floating pill nav**: white rounded pill track centered in the bar, active
  item = filled green pill; brand pinned left, account avatar pinned right; the page
  behind the nav is the tinted sand color.
- **Map page** — **immersive**: the map is full-bleed below the nav; filters float over
  it as a frosted-glass card (top-left); the park detail panel floats inset on the right
  with rounded corners. Map tiles switch from dark to a light terrain basemap. Pins
  recolored to the palette.

### Design Tokens

These replace the current `:root` variables in `web/app/globals.css`. Names are kept
where possible so existing `var(--*)` references cascade automatically.

| Token | Old | New | Role |
|---|---|---|---|
| `--bg` | `#0f1117` | `#ece5d6` | Tinted page background (sand) |
| `--surface` | `#1a1d27` | `#ffffff` | Cards, panels, fields |
| `--surface-2` | _(new)_ | `#fbfaf6` | Subtle off-white sections / page body |
| `--surface-sunken` | _(new)_ | `#f6f3ec` | Inset rows, segmented-control tracks |
| `--border` | `#2a2d3a` | `#e7e1d4` | Hairline borders |
| `--text` | `#e8eaf0` | `#2f3a2e` | Primary text (deep forest) |
| `--muted` | `#8b90a0` | `#5c6657` | Secondary text |
| `--accent` | `#4f8ef7` | `#3a6b4f` | Forest green — primary actions, active state |
| `--accent-soft` | _(new)_ | `#e3efe6` | Tinted green chip backgrounds |
| `--green` | `#3ecf8e` | `#3a6b4f` | Available / match (unified with accent) |
| `--red` | `#ff6b6b` | `#b3402f` | Unavailable / danger (muted brick) |
| `--yellow`/`--warn` | `#f5c842` | `#c4582a` | Sunset accent — walk-up badge, warnings |
| `--warn-soft` | _(new)_ | `#f6e7d6` | Walk-up badge background |
| `--radius` | `8px` | `10px` | Standard radius |
| `--radius-lg` | _(new)_ | `16px` | Floating panels / cards |
| `--shadow-sm` | _(new)_ | `0 1px 3px rgba(60,70,50,.10)` | Card lift |
| `--shadow-float` | _(new)_ | `0 8px 26px rgba(40,40,30,.18)` | Floating nav/filter/panel |
| `--font` | Inter | `'Inter', system-ui, sans-serif` | Body/UI |
| `--font-display` | _(new)_ | `'Fraunces', Georgia, serif` | Headings/brand |

Fonts loaded via Google Fonts (`next/font` preferred, or a `<link>`/`@import` in the
root layout) for `Fraunces` and `Inter`.

---

## Architecture & Propagation Strategy

**Why this is low-risk:** CampBrain's web UI already centralizes styling. Almost all
visual rules live in `web/app/globals.css` as component classes (`.card`, `.btn`,
`.badge`, `.chip`, `.toggle`, tables, forms, etc.), and the ~149 inline `style={...}`
usages across components reference CSS variables (e.g. `color: 'var(--muted)'`) rather
than hardcoded values. Retokenizing `:root` + restyling the shared classes cascades to
every page automatically.

The only hardcoded colors found outside `globals.css` are the **Leaflet pin colors** in
`web/app/map/LeafletMap.tsx`. Those are handled explicitly in the map work.

**Rollout order:**

1. **Tokens + shared components** (`globals.css`) — retokenize `:root`, load fonts,
   restyle every shared class to the Naturalist look. Apply `--font-display` to
   `h1/h2/h3` and the brand. This is the bulk of the propagation.
2. **Shell** (`web/app/layout.tsx` + `globals.css`) — replace the left `.sidebar` with
   the centered floating pill top-nav. Rework `.layout`/`.main` from a horizontal flex
   (sidebar + main) to a vertical stack (nav + full-width content on the tinted page).
3. **Map page** (test surface) — `web/app/map/MapClient.tsx`, `LeafletMap.tsx`, and the
   `.map-*` rules in `globals.css`: go immersive (full-bleed map, floating glass filters,
   floating inset detail panel), light basemap, recolored pins.
4. **Sweep remaining pages** — load each page (`/`, `/explore`, `/alerts`,
   `/scan-history`, `/calendar`, `/settings`, `/catalog`, `/targets`, `/scan`,
   `/windows`) and fix anything that reads wrong under the new tokens (contrast,
   light-on-dark assumptions, any stray hardcoded color).

---

## Component-Level Changes (`globals.css`)

- **Active-nav / links** — green accent; hover backgrounds shift from
  `rgba(79,142,247,.1)` to soft green.
- **`.btn-primary`** — solid forest green, white text. `.btn-ghost`/default — sand
  `--surface-sunken` with text color, hairline border.
- **`.badge` / `.chip`** — pill radius (`999px`); green family uses `--accent-soft` /
  `--accent`; walk-up uses `--warn-soft` / `--warn` (sunset). Reduce SHOUTING:
  badges may stay uppercase but smaller.
- **`.card`** — white surface, `--shadow-sm`, `--border`, `--radius`.
- **Forms/inputs** — white fields on sand, green focus ring (`--accent`), remove
  `color-scheme: dark` (date pickers go light).
- **Tables** — light header row, hairline borders, `--accent` for available status.
- **`.toggle`** — checked state uses `--accent` (green) instead of the old green.
- **Modal** — white surface, lighter backdrop (`rgba(40,40,30,.35)`), `--radius-lg`.
- **Segmented control** — new shared pattern: `--surface-sunken` track, active segment
  = white pill with `--shadow-sm` (used by nav and map filters).

## Shell Changes (`layout.tsx` + `globals.css`)

- Remove `.sidebar` markup and styles. Add a top `<header>` with three zones: brand
  (left, Fraunces), centered floating pill `<nav>`, avatar (right).
- Pill nav: white track (`border-radius:999px`), `--shadow-float`; links are pills;
  active link = filled green pill, white text. Use Next's active-route detection (e.g.
  `usePathname`) so the active pill is correct per page — this requires the nav to be a
  small client component.
- `.main`: full-width, centered max-width content column on `--surface-2`/`--bg`, top
  padding below the nav. Drop the `display:flex` sidebar layout.

## Map Page Changes

- **Layout** (`globals.css` `.map-*`): the map fills all space below the nav. Replace the
  current `flex-column` (filter bar pushes map down) with a **positioned** model:
  `.map-page` is `position:relative; height: calc(viewport below nav)`; `.map-container`
  is absolutely full-bleed; `.map-filters` becomes a floating frosted-glass card
  (`position:absolute; top/left`, `backdrop-filter:blur`, `--shadow-float`,
  `--radius-lg`); `.map-detail-panel` becomes a floating **inset** rounded panel
  (`position:absolute; top/right/bottom` with margin, `--radius-lg`, `--shadow-float`)
  instead of edge-to-edge full-height.
- **Basemap** (`LeafletMap.tsx`): switch the `TileLayer` from
  `tile.openstreetmap.org` to a light terrain/positron basemap (e.g. CARTO Voyager:
  `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png`) with
  correct attribution. Cleaner light cartography that matches the palette.
- **Pins** (`LeafletMap.tsx`): recolor the `CircleMarker`/marker fills — **green
  (`#3a6b4f`) = bookable match**, **grey (`#b9b3a3`) = in-range, no availability**.
  Replaces the current blue/grey. Keep existing pin-lighting *logic* untouched; only
  colors change.
- **Filter controls**: distance chips, the Weekends/All-dates toggle, and night-count
  controls adopt the shared segmented-control + chip patterns. Keep all filter behavior
  and the <200ms response budget.
- Walk-up sites keep their badge, now in the sunset `--warn` style; still excluded from
  bookable counts and pin-lighting (unchanged logic).

---

## Out of Scope (YAGNI)

- No dark mode / theme toggle.
- No new features, filters, pages, or data changes.
- No component-library migration (stay with the hand-rolled CSS system; CLAUDE.md
  mentions Tailwind but the codebase uses custom CSS — keep it).
- No map interaction/logic changes (clustering, geocoding, distance math untouched).
- No copy/content rewrites beyond what styling requires.

---

## Verification

Per CLAUDE.md conventions, after the redesign:

- `npm run typecheck` passes.
- Every page loads with no console errors and no hydration warnings (the active-nav
  client component is the main hydration-risk surface — verify).
- `/map`: map is full-bleed, filters float, detail panel floats; pins show green/grey;
  light basemap renders; filter toggles still respond <200ms.
- `/explore`: park cards, filters, pagination, Book buttons render correctly under new
  tokens; filter response still <200ms.
- Spot-check remaining pages for contrast/legibility and stray dark-theme remnants.
- Use the browser preview tools to capture before/after of `/map` and `/explore`.

---

## Risks & Mitigations

- **Shell layout rewrite** — moving from sidebar (horizontal flex) to top-nav (vertical
  stack) changes the height math the map page depends on (`.main:has(.map-page)`,
  full-height flex). Mitigation: define a single source of truth for "viewport height
  minus nav height" and build the map layout against it; verify the map fills correctly.
- **Active-nav hydration** — server/client mismatch if active state is computed wrong.
  Mitigation: compute active route with `usePathname` in a client nav component.
- **`backdrop-filter` support / readability** — frosted glass can hurt contrast over
  busy map areas. Mitigation: sufficient white opacity (~0.78) + border + shadow;
  provide a solid fallback background.
- **date input theming** — removing `color-scheme: dark` flips date pickers to light;
  verify the date-picker UX (user preference: always use date-picker UI).
- **Font loading flash** — mitigate with `next/font` (self-hosted, no layout shift) or
  `font-display: swap`.
