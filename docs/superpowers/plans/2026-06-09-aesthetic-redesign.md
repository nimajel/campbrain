# Naturalist Aesthetic Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CampBrain's dark developer-dashboard look with a polished light "Naturalist" aesthetic (forest green + sand/cream, Fraunces + Inter), validated on the immersive `/map` page and propagated site-wide.

**Architecture:** Retokenize the CSS custom properties in `web/app/globals.css` and restyle the shared component classes there — this cascades to every page because nearly all inline styles reference `var(--*)`. Replace the left sidebar in `layout.tsx` with a centered floating pill top-nav (a small client component using `usePathname` for active state). Make `/map` immersive (full-bleed map, floating glass filters, floating inset detail panel) almost entirely via the `.map-*` CSS rules, plus a light basemap and restyled legend in `LeafletMap.tsx`.

**Tech Stack:** Next.js 14, React 18, hand-rolled CSS (no Tailwind config present), `next/font/google` for Fraunces + Inter, Leaflet/react-leaflet.

**Note on verification:** This is a presentational change. There are no new unit tests — visual work is verified with the `preview_*` browser tools (snapshots, screenshots, console-log checks) plus `npm run typecheck`, and by keeping the existing `npm test` suite green. Each task ends with a concrete verification gate and a commit.

---

## File Structure

- `web/app/globals.css` — **modify**: `:root` tokens, all shared component classes, `.map-*` layout. The bulk of the work.
- `web/app/layout.tsx` — **modify**: load fonts; replace sidebar markup with `<NavBar/>` + top-nav shell.
- `web/app/components/NavBar.tsx` — **create**: client component, centered floating pill nav, active route via `usePathname`.
- `web/app/map/LeafletMap.tsx` — **modify**: light CARTO basemap tile URL; restyle the legend chrome to light glass.
- `web/app/map/MapClient.tsx` — **modify (minimal)**: only if the immersive layout needs a wrapper class hook; most change is CSS.

---

## Task 1: Load fonts and retokenize the design system

**Files:**
- Modify: `web/app/layout.tsx`
- Modify: `web/app/globals.css:3-15` (`:root`) and `:54-56` (`h1/h2/h3`)

- [ ] **Step 1: Load Fraunces + Inter via next/font in `layout.tsx`**

Add at the top of `web/app/layout.tsx`, after the existing imports:

```tsx
import { Inter, Fraunces } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });
```

Then put the font variables on `<html>`:

```tsx
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
```

- [ ] **Step 2: Replace the `:root` block in `globals.css`**

Replace lines 3-15 (the current `:root { ... }`) with:

```css
:root {
  --bg: #ece5d6;            /* tinted sand page background */
  --surface: #ffffff;       /* cards, panels, fields */
  --surface-2: #fbfaf6;     /* off-white page body */
  --surface-sunken: #f6f3ec;/* inset rows, segmented tracks */
  --border: #e7e1d4;
  --text: #2f3a2e;          /* deep forest */
  --muted: #5c6657;
  --accent: #3a6b4f;        /* forest green */
  --accent-soft: #e3efe6;
  --green: #3a6b4f;         /* available/match unified with accent */
  --red: #b3402f;           /* muted brick */
  --yellow: #c4582a;        /* sunset accent (kept name for back-compat) */
  --warn: #c4582a;
  --warn-soft: #f6e7d6;
  --radius: 10px;
  --radius-lg: 16px;
  --shadow-sm: 0 1px 3px rgba(60,70,50,.10);
  --shadow-float: 0 8px 26px rgba(40,40,30,.18);
  --font: var(--font-inter), 'Inter', system-ui, -apple-system, sans-serif;
  --font-display: var(--font-fraunces), 'Fraunces', Georgia, serif;
}
```

- [ ] **Step 3: Apply the display font to headings**

Replace lines 54-56 in `globals.css`:

```css
h1 { font-family: var(--font-display); font-size: 24px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 4px; }
h2 { font-family: var(--font-display); font-size: 18px; font-weight: 600; margin: 0 0 12px; }
h3 { font-size: 14px; font-weight: 600; margin: 0 0 8px; }
```

Also update the brand to use the display font (line 32-36 `.sidebar-brand` — it will be replaced in Task 3, leave for now).

- [ ] **Step 4: Verify typecheck + page render**

Run: `cd web && npm run build 2>&1 | tail -5` is overkill here; instead:
Run: `npm run typecheck`
Expected: passes (no type errors).

Start the dev server with the preview tools (`preview_start`), open `/explore`, and run `preview_console_logs`.
Expected: page loads on the sand background with green accents and serif headings; no console errors.
Capture `preview_screenshot` for the record.

- [ ] **Step 5: Commit**

```bash
git add web/app/layout.tsx web/app/globals.css
git commit -m "feat(ui): load Fraunces+Inter and retokenize to Naturalist palette"
```

---

## Task 2: Restyle the shared component classes

**Files:**
- Modify: `web/app/globals.css` (buttons, badges, chips, cards, forms, tables, toggle, modal, dots; add segmented-control helper)

- [ ] **Step 1: Buttons** — replace `.btn-*` rules (around lines 91-99, 136-137, 164-167)

```css
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: var(--radius); font-size: 13px; font-weight: 600; border: 1px solid transparent; cursor: pointer; transition: background .15s, opacity .15s; }
.btn-primary { background: var(--accent); color: #fff; box-shadow: 0 2px 6px rgba(58,107,79,.25); }
.btn-primary:hover { background: #335f46; }
.btn-ghost { background: var(--surface-sunken); color: var(--text); border-color: var(--border); }
.btn-ghost:hover { background: #efe9dc; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn-sm { padding: 5px 10px; font-size: 12px; }
.btn-danger { background: var(--warn-soft); color: var(--warn); }
.btn-danger:hover { background: #f0d8c2; }
.btn-success { background: var(--accent-soft); color: var(--accent); }
.btn-success:hover { background: #d4e7d9; }
```

(Remove the stray `.btn { background: var(--border); ... }` override at old line 137.)

- [ ] **Step 2: Badges + chips** — replace `.badge*` (lines 72-80) and `.chip*` (lines 182-189)

```css
.badge { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.badge-green { background: var(--accent-soft); color: var(--accent); }
.badge-red   { background: var(--warn-soft);   color: var(--warn); }
.badge-blue  { background: var(--accent-soft);  color: var(--accent); }
.badge-gray  { background: var(--surface-sunken); color: var(--muted); }
.badge-match { background: var(--accent-soft); color: var(--accent); font-size: 12px; padding: 3px 11px; }

.chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 11px; border-radius: 999px; font-size: 12px; font-weight: 500; }
.chip-green { background: var(--accent-soft); color: var(--accent); }
.chip-red   { background: var(--warn-soft);   color: var(--warn); }
.chip-gray  { background: var(--surface-sunken); color: var(--muted); }
.chip-yellow{ background: var(--warn-soft);   color: var(--warn); }
```

- [ ] **Step 3: Cards** — replace `.card` (lines 61-64)

```css
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; box-shadow: var(--shadow-sm); }
```

- [ ] **Step 4: Forms** — replace the form block (lines 113-135) and `.form-input` (277-278)

```css
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
input[type="text"], input[type="number"], input[type="date"], input:not([type]), select, textarea {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); padding: 8px 10px; font-size: 13px; font-family: var(--font); width: 100%;
}
input[type="text"]:focus, input[type="number"]:focus, input[type="date"]:focus,
input:not([type]):focus, select:focus, textarea:focus {
  outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft);
}
input[type="checkbox"] { width: auto; accent-color: var(--accent); }
textarea { resize: vertical; }
select option { background: var(--surface); }
fieldset { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 16px; }
legend { font-size: 12px; color: var(--muted); padding: 0 4px; }
.form-input { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); padding: 7px 10px; font-size: 13px; font-family: var(--font); }
.form-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
```

Note: this deletes the old `input[type="date"] { color-scheme: dark; }` and the dark calendar-indicator filter so date pickers render light.

- [ ] **Step 5: Toggle + modal** — replace `.toggle input:checked + .toggle-slider` (line 153) and `.modal-backdrop` (lines 192-196)

```css
.toggle input:checked + .toggle-slider { background: var(--accent); }
```

```css
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(40,40,30,.35);
  z-index: 100; display: flex; align-items: flex-start;
  justify-content: center; padding: 40px 20px; overflow-y: auto;
}
.modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px; width: 100%; max-width: 640px; position: relative; box-shadow: var(--shadow-float); }
```

- [ ] **Step 6: Add a shared segmented-control helper** (append near the form section)

```css
/* Segmented control (used by nav + map filters) */
.segmented { display: inline-flex; gap: 2px; background: var(--surface-sunken); border-radius: var(--radius); padding: 3px; }
.segmented button, .segmented a { font-size: 12px; color: var(--muted); padding: 6px 12px; border-radius: 7px; border: none; background: none; cursor: pointer; }
.segmented .active, .segmented button.active, .segmented a.active { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--shadow-sm); }
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck` → passes.
With preview running, open `/alerts` and `/explore`; run `preview_console_logs` (no errors) and `preview_screenshot`.
Expected: buttons are forest green, badges/chips are pill-shaped in green/sunset, cards are white with soft shadow on sand, inputs/date pickers are light with a green focus ring.

- [ ] **Step 8: Commit**

```bash
git add web/app/globals.css
git commit -m "feat(ui): restyle shared components to Naturalist palette"
```

---

## Task 3: Replace sidebar with centered floating pill top-nav

**Files:**
- Create: `web/app/components/NavBar.tsx`
- Modify: `web/app/layout.tsx:9-33`
- Modify: `web/app/globals.css` `.layout`/`.sidebar*`/`.main` (lines 22-52) and `.main:has(.map-page)` (260-264)

- [ ] **Step 1: Create the NavBar client component**

Create `web/app/components/NavBar.tsx`:

```tsx
'use client';

import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/explore', label: 'Campsites' },
  { href: '/map', label: 'Map' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/scan-history', label: 'Scan History' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/settings', label: 'Settings' },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <header className="topnav">
      <a href="/" className="topnav-brand">Camp<span>Brain</span></a>
      <nav className="navpill">
        {LINKS.map(({ href, label }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <a key={href} href={href} className={active ? 'active' : ''}>{label}</a>
          );
        })}
      </nav>
      <div className="topnav-avatar" aria-hidden="true" />
    </header>
  );
}
```

- [ ] **Step 2: Rewrite `layout.tsx` body**

Replace the `<body>...</body>` contents (lines 12-31) with:

```tsx
      <body>
        <div className="layout">
          <NavBar />
          <main className="main">{children}</main>
        </div>
      </body>
```

Add the import near the top: `import NavBar from './components/NavBar';`

- [ ] **Step 3: Replace shell CSS in `globals.css`**

Replace lines 22-52 (`.layout` through `.main`) with:

```css
.layout { display: flex; flex-direction: column; min-height: 100vh; }

.topnav {
  position: relative; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  height: 64px; padding: 0 20px; background: var(--bg);
}
.topnav-brand {
  position: absolute; left: 20px; top: 50%; transform: translateY(-50%);
  font-family: var(--font-display); font-size: 17px; font-weight: 600; color: var(--text);
}
.topnav-brand span { color: var(--accent); }
.topnav-brand:hover { text-decoration: none; }
.topnav-avatar {
  position: absolute; right: 20px; top: 50%; transform: translateY(-50%);
  width: 30px; height: 30px; border-radius: 50%; background: var(--accent);
}
.navpill {
  display: flex; gap: 2px; background: var(--surface);
  border-radius: 999px; padding: 5px; box-shadow: var(--shadow-float);
}
.navpill a { font-size: 12px; color: var(--muted); padding: 7px 16px; border-radius: 999px; }
.navpill a:hover { color: var(--text); text-decoration: none; }
.navpill a.active { background: var(--accent); color: #fff; font-weight: 600; }
.navpill a.active:hover { color: #fff; }

.main { flex: 1; width: 100%; max-width: 1100px; margin: 0 auto; padding: 28px 40px; background: var(--surface-2); min-height: 0; display: flex; flex-direction: column; align-self: stretch; }
```

(Delete the old `.sidebar`, `.sidebar-brand`, `.sidebar nav` rules at lines 24-50.)

- [ ] **Step 4: Verify nav + active state + hydration**

Run: `npm run typecheck` → passes.
With preview running, open `/explore` then `/map`.
- `preview_console_logs`: no hydration warnings/errors (the client `usePathname` is the main risk).
- `preview_snapshot`: confirm the active pill matches the current route.
- `preview_screenshot`: centered green-active pill, brand left, avatar right, on sand.

- [ ] **Step 5: Commit**

```bash
git add web/app/components/NavBar.tsx web/app/layout.tsx web/app/globals.css
git commit -m "feat(ui): replace sidebar with centered floating pill top-nav"
```

---

## Task 4: Make the map page immersive (CSS-only layout)

**Files:**
- Modify: `web/app/globals.css` `.map-page`/`.map-filters`/`.map-container`/`.main:has(.map-page)`/`.map-detail-panel` (lines 246-276)

- [ ] **Step 1: Replace the `.map-*` layout block**

Replace lines 246-276 in `globals.css` with:

```css
/* Map page — full-bleed immersive map with floating controls */
.main:has(.map-page) { padding: 0; max-width: 100%; margin: 0; }

.map-page {
  position: relative; flex: 1; min-height: 0; width: 100%;
  /* fill everything below the 64px top-nav */
  height: calc(100vh - 64px);
}

.map-container { position: absolute; inset: 0; }

.map-filters {
  position: absolute; top: 16px; left: 16px; right: 332px; z-index: 1000;
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px 12px;
  background: rgba(255,255,255,.80); backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,.9); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-float);
}

.map-detail-panel {
  position: absolute; right: 16px; top: 16px; bottom: 16px; width: 300px; z-index: 1000;
  background: var(--surface); border: 1px solid var(--border);
  overflow-y: auto; padding: 18px; border-radius: var(--radius-lg);
  box-shadow: var(--shadow-float);
}
```

(The `.map-page` markup in `MapClient.tsx` already nests `.map-filters`, `.map-container`, and `.map-detail-panel`; no JSX change is required for the layout.)

- [ ] **Step 2: Remove the leftover map-border radius in `LeafletMap.tsx`**

In `web/app/map/LeafletMap.tsx:111`, change the `MapContainer` style so the full-bleed map has no inner rounded corner:

```tsx
        style={{ height: '100%', width: '100%' }}
```

- [ ] **Step 3: Verify immersive layout + filter performance**

Run: `npm run typecheck` → passes.
With preview running, open `/map`:
- `preview_screenshot`: map fills below the nav; the filter card floats top-left as frosted glass; selecting a park floats the detail panel inset on the right.
- `preview_click` a Weekends/All-dates toggle, then `preview_snapshot` to confirm it still responds (target <200ms, behavior unchanged).
- `preview_console_logs`: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/app/globals.css web/app/map/LeafletMap.tsx
git commit -m "feat(ui): immersive full-bleed map with floating glass controls"
```

---

## Task 5: Light basemap + restyled legend

**Files:**
- Modify: `web/app/map/LeafletMap.tsx:113-116` (tile) and `:157-186` (legend)

- [ ] **Step 1: Switch the basemap to CARTO Voyager (light terrain)**

Replace the `TileLayer` (lines 113-116):

```tsx
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
```

- [ ] **Step 2: Restyle the legend to light glass**

In the legend container style (lines 157-168), replace the dark glass with light:

```tsx
      <div style={{
        position: 'absolute',
        bottom: 24,
        left: 16,
        zIndex: 1000,
        background: 'rgba(255,255,255,0.85)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '8px 11px',
        pointerEvents: 'none',
        backdropFilter: 'blur(6px)',
        boxShadow: 'var(--shadow-sm)',
      }}>
```

And the legend label text color (line 182), from `rgba(255,255,255,0.85)` to a dark token:

```tsx
              <span style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap' }}>{label}</span>
```

Note: the category pin colors (state-parks green, NPS blue, USFS orange, selected gold, unavailable grey) are kept as-is — they encode provider and already harmonize (state-parks green = the brand color). Only the legend chrome changes.

- [ ] **Step 3: Verify**

With preview running, open `/map`:
- `preview_screenshot`: tiles are light/clean cartography; pins remain legible on the lighter map; legend is a light glass card with dark text.
- `preview_console_logs`: no tile 4xx errors.

- [ ] **Step 4: Commit**

```bash
git add web/app/map/LeafletMap.tsx
git commit -m "feat(ui): light CARTO basemap and light legend on map"
```

---

## Task 6: Sweep remaining pages

**Files:**
- Modify: `web/app/globals.css` and/or page files as needed for any page that reads wrong under the new tokens.

- [ ] **Step 1: Walk every page with the preview tools**

With preview running, open each in turn and run `preview_screenshot` + `preview_console_logs`:
`/`, `/explore`, `/map`, `/alerts`, `/scan-history`, `/calendar`, `/settings`, `/catalog`, `/targets`, `/scan`, `/windows`.

- [ ] **Step 2: Fix issues inline**

For each page, look specifically for:
- Light-on-dark text now unreadable (any element still assuming the dark bg).
- Stray hardcoded hex colors (grep helper below).
- Tables/availability cells: confirm `.avail-available` (green) reads well on white.
- Contrast of `--muted` text on `--surface-2`.

Run this to find any remaining hardcoded colors outside `globals.css`:

```bash
grep -rn "#[0-9a-fA-F]\{3,6\}\|rgba(0,0,0\|rgba(255,255,255\|rgba(15," web/app web/lib | grep -v globals.css
```

Expected after fixes: only intentional values remain (e.g. Leaflet pin category hexes in `LeafletMap.tsx`, the search-location marker `#e74c3c`, and the now-light legend). Convert any incidental dark-theme leftovers to `var(--*)` tokens.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → passes.
All pages screenshot cleanly, no console errors, no unreadable text.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(ui): sweep remaining pages for Naturalist contrast and stray colors"
```

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + test suite**

Run: `npm run typecheck` → passes.
Run: `npm test` → all existing tests pass (no regressions; this change is presentational).

- [ ] **Step 2: Web build**

Run: `cd web && npm run build 2>&1 | tail -15`
Expected: build succeeds with no errors (catches font/import and `usePathname` issues).

- [ ] **Step 3: Capture before/after proof**

With preview running, `preview_screenshot` of `/map` and `/explore` for the PR description.

- [ ] **Step 4: Commit any final touch-ups**

```bash
git add -A
git commit -m "chore(ui): final Naturalist redesign polish"
```

---

## Self-Review Notes

- **Spec coverage:** tokens (T1), shared components (T2), shell/top-nav (T3), immersive map layout (T4), light basemap + pins/legend (T5), page sweep (T6), verification (T7). All spec sections mapped.
- **Pin colors:** spec simplified pins to "green match / grey none"; the real code colors pins by provider category. The plan keeps the category scheme (state-parks green already matches the brand) and only restyles the legend chrome — documented in T5 Step 2.
- **`--yellow` token:** kept the name (aliased to the sunset value) so existing `var(--yellow)`/`.dot-yellow`/`.chip-yellow` references don't break; added `--warn` as the semantic name.
- **Map height:** `.map-page` uses `calc(100vh - 64px)` tied to the fixed 64px top-nav height — single source of truth; if nav height changes, update both.
