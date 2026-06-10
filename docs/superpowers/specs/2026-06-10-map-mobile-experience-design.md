# Map Mobile Experience (P5) — Design

**Date:** 2026-06-10
**Status:** approved (interactive mobile prototype reviewed by user — "I like this the way it is")
**Backlog:** P5 in [2026-06-09-map-view-improvements.md](2026-06-09-map-view-improvements.md)

## Goal

A first-class, map-centered mobile experience for `/map`. Today the app has **zero
responsive CSS** — every surface is desktop-only and the map page collapses badly on a
phone (crushed filter chips, sliver map, controls spilling below). This adds a mobile
layer to the map surface: full-bleed map as the hero, a draggable bottom-sheet results
list, a rising detail sheet, and filters in a full-screen sheet.

## Breakpoint

`@media (max-width: 640px)` — single breakpoint; the desktop layout is untouched above
it. Client behavior keys off a `useIsMobile()` hook (`matchMedia('(max-width: 640px)')`,
mount-safe: returns `false` during SSR/first paint, updates after mount to avoid
hydration mismatch).

## The five mobile pieces

1. **Immersive top row + hamburger nav.** On mobile the global `.topnav` is hidden on the
   map route (`.layout:has(.map-page) .topnav { display:none }`) so the map is fully
   edge-to-edge. The map's own top row becomes `[☰] [Filters] [Find a park…]` floating
   over the map, with a one-line context summary below ("Weekend Jun 12–15 · near SF ·
   8 matches"). The `☰` opens a shared slide-in `NavMenu` overlay (the 6 site links +
   brand + active state). On mobile **non-map** pages, `.topnav` itself collapses to
   `brand + ☰` (the `.navpill` links move into the same `NavMenu`). The desktop floating
   filter bar's inline-expand rows do **not** show inline on mobile.

2. **Results bottom sheet.** `ResultsList` content (count, sort pills, rows) becomes a
   bottom sheet with three detents — **peek** (grip + count + sort visible, map dominant),
   **half**, **full**. A grip handle cycles detents (tap; drag is a fast-follow). On
   mobile the desktop left-drawer toggle button is gone — the peek sheet is always
   present. Rows get larger tap targets and a chevron.

3. **Detail sheet.** On park select, `DetailPanel` rises as a bottom sheet over a dimmed
   backdrop (separate from the list sheet, so list scroll position is preserved — a
   deliberate choice over Google-Maps' same-sheet expand). Full P3 content (fees, tiers,
   chips) plus a full-width "Book on ReserveCalifornia" button per tier. Dismiss via ✕ or
   backdrop tap. Pin tap and row tap both open it; both still fly/zoom the map (P1).

4. **Filters full-screen sheet.** The `Filters` pill opens the filter groups (When / Min
   stay / Near / Access / Site kind / Hide) as a full-screen sheet with large tappable
   pills and a sticky "Show N parks" apply button (mobile-only). Reuses `filtersOpen`
   state + the existing filter JSX — restyled by the breakpoint, not duplicated.

## Architecture

- `web/app/map/useIsMobile.ts` — mount-safe `matchMedia('(max-width: 640px)')` hook.
- `web/lib/sheet-detent.ts` — `SheetDetent` (`'peek' | 'half' | 'full'`) + pure
  `cycleDetent(current)` (TDD).
- `web/app/components/nav-links.ts` — `NAV_LINKS` constant (extracted from NavBar so
  NavBar and the map's hamburger share one source of truth).
- `web/app/components/NavMenu.tsx` — shared slide-in overlay menu (`open`/`onClose`
  props; links from `NAV_LINKS`, active state via `usePathname`, backdrop dismiss).
- `web/app/components/NavBar.tsx` — desktop unchanged; on mobile renders `brand + ☰`
  and a `NavMenu` instance. Hidden by CSS on the mobile map route.
- `web/app/globals.css` — one `@media (max-width: 640px)` block: hide `.topnav` on
  `.layout:has(.map-page)`; restyle `.map-filters` (→ floating top row + full-screen
  sheet when `filtersOpen`), `.map-results-drawer` (→ bottom sheet w/ detent transform
  classes), `.map-detail-panel` (→ rising sheet + backdrop), `.map-results-toggle`
  (hidden); collapse `.navpill` → hamburger.
- `web/app/map/MapClient.tsx` — `isMobile`, `detent`, `navMenuOpen` state; mobile
  branches: `☰` in the top row + its own `NavMenu`, results sheet always rendered,
  detail backdrop, "Show N parks" apply button in the filters sheet.
- `web/app/map/ResultsList.tsx` — `mobile`/`detent`/`onCycleDetent` props add the grip
  handle and detent-driven height on mobile; left-drawer behavior unchanged on desktop.

## Confirmed decisions

- **Fully immersive + hamburger nav** (user, 2026-06-10). Global nav hidden on the
  mobile map route; map is edge-to-edge; navigation via a `☰` slide-in `NavMenu`. The
  hamburger pattern also applies to mobile non-map pages for consistency.
- **Tap-to-cycle detents, not drag** (user, 2026-06-10). v1 cycles peek→half→full on
  grip tap; swipe-drag physics is a fast-follow.

## Out of scope (fast-follows)

- Swipe-drag gesture physics on the sheets (v1 = tap-cycle)
- Fully nav-less immersive shell (app-wide change)
- Tablet-specific layout (640–1024px keeps desktop layout)
- `/explore` and other surfaces going mobile (this spec is the map only)
