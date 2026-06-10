# Map Mobile Experience (P5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First-class, map-centered mobile experience for `/map` — immersive full-bleed map, hamburger nav, bottom-sheet results list (tap-cycle detents), rising detail sheet, full-screen filters sheet. Single `@media (max-width: 640px)` breakpoint; desktop untouched.

**Architecture:** Two pure/tested units (`cycleDetent`, extracted `NAV_LINKS`), a mount-safe `useIsMobile` hook, a shared `NavMenu` overlay, one media-query CSS block, and mobile branches in `MapClient`/`ResultsList`. No API/cache/schema changes.

**Tech Stack:** Next.js 15, React 18, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-map-mobile-experience-design.md`

**Commit policy (user preference):** no auto-commit; ask at the end. Stage explicit map/nav files only — the alert-scanner session is concurrently editing `src/` and other `web/app` pages.

---

### Task 1: `cycleDetent` helper (TDD)

**Files:**
- Create: `web/lib/sheet-detent.ts`
- Test: `test/sheet-detent.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/sheet-detent.test.ts
import { describe, it, expect } from 'vitest';
import { cycleDetent } from '../web/lib/sheet-detent.js';

describe('cycleDetent', () => {
  it('peek → half → full → peek', () => {
    expect(cycleDetent('peek')).toBe('half');
    expect(cycleDetent('half')).toBe('full');
    expect(cycleDetent('full')).toBe('peek');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/sheet-detent.test.ts` → FAIL (module not found)

- [ ] **Step 3: Implement**

```ts
// web/lib/sheet-detent.ts
export type SheetDetent = 'peek' | 'half' | 'full';

const ORDER: SheetDetent[] = ['peek', 'half', 'full'];

export function cycleDetent(current: SheetDetent): SheetDetent {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run test/sheet-detent.test.ts` → PASS (1 test)

---

### Task 2: Extract `NAV_LINKS` + `useIsMobile` hook

**Files:**
- Create: `web/app/components/nav-links.ts`
- Create: `web/app/map/useIsMobile.ts`
- Modify: `web/app/components/NavBar.tsx` (import the constant)

- [ ] **Step 1: Create the shared constant**

```ts
// web/app/components/nav-links.ts
export const NAV_LINKS = [
  { href: '/explore', label: 'Campsites' },
  { href: '/map', label: 'Map' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/scan-history', label: 'Scan History' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/settings', label: 'Settings' },
] as const;
```

- [ ] **Step 2: Point NavBar at it** — replace the inline `LINKS` array in `NavBar.tsx` with `import { NAV_LINKS } from './nav-links';` and map over `NAV_LINKS`.

- [ ] **Step 3: Create the mount-safe hook**

```ts
// web/app/map/useIsMobile.ts
'use client';

import { useEffect, useState } from 'react';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}
```

- [ ] **Step 4: Verify** — `npm run typecheck` clean.

---

### Task 3: `NavMenu` overlay + NavBar mobile hamburger

**Files:**
- Create: `web/app/components/NavMenu.tsx`
- Modify: `web/app/components/NavBar.tsx`
- Modify: `web/app/globals.css` (append `@media` block — nav portion)

- [ ] **Step 1: Create `NavMenu`**

```tsx
// web/app/components/NavMenu.tsx
'use client';

import { usePathname } from 'next/navigation';
import { NAV_LINKS } from './nav-links';

export default function NavMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  return (
    <div className={`nav-menu-backdrop${open ? ' show' : ''}`} onClick={onClose} aria-hidden={!open}>
      <nav className="nav-menu" aria-label="Site" onClick={(e) => e.stopPropagation()}>
        <a href="/" className="topnav-brand" style={{ fontSize: 18, padding: '4px 0 12px' }}>Camp<span>Brain</span></a>
        {NAV_LINKS.map(({ href, label }) => {
          const active = pathname.startsWith(href);
          return (
            <a key={href} href={href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onClose}>
              {label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
```

- [ ] **Step 2: Add mobile hamburger + menu to NavBar**

Add `'use client'` already present. Add `useState` for `menuOpen`; render a hamburger button (`.topnav-burger`, hidden on desktop by CSS) and `<NavMenu open={menuOpen} onClose={() => setMenuOpen(false)} />`. Keep the existing `.navpill` (CSS hides it on mobile).

```tsx
import { useState } from 'react';
import NavMenu from './NavMenu';
// ...
const [menuOpen, setMenuOpen] = useState(false);
// inside <header className="topnav">, after the brand:
<button type="button" className="topnav-burger" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>☰</button>
<NavMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
```

- [ ] **Step 3: Append the nav portion of the `@media` block**

```css
.topnav-burger { display: none; justify-self: end; background: none; border: none; font-size: 22px; color: var(--text); cursor: pointer; line-height: 1; }
.nav-menu-backdrop { position: fixed; inset: 0; background: rgba(20,18,14,.4); z-index: 3000; opacity: 0; pointer-events: none; transition: opacity .2s; }
.nav-menu-backdrop.show { opacity: 1; pointer-events: auto; }
.nav-menu { position: absolute; top: 0; right: 0; height: 100%; width: 72%; max-width: 280px; background: var(--surface); box-shadow: var(--shadow-float); padding: 24px 20px; display: flex; flex-direction: column; gap: 4px; transform: translateX(100%); transition: transform .25s cubic-bezier(.32,.72,0,1); }
.nav-menu-backdrop.show .nav-menu { transform: translateX(0); }
.nav-menu a { font-size: 15px; color: var(--muted); padding: 11px 10px; border-radius: 8px; }
.nav-menu a.active { background: var(--accent); color: #fff; font-weight: 600; }

@media (max-width: 640px) {
  .topnav { height: 52px; padding: 0 16px; grid-template-columns: 1fr auto; }
  .navpill { display: none; }
  .topnav-avatar { display: none; }
  .topnav-burger { display: block; }
  .layout:has(.map-page) .topnav { display: none; }
}
```

- [ ] **Step 4: Verify** — typecheck; at 1280px the nav is unchanged; at 375px non-map pages show brand + ☰ and the menu slides in.

---

### Task 4: Mobile CSS for the map surface

**Files:**
- Modify: `web/app/globals.css` (extend the `@media (max-width: 640px)` block)

- [ ] **Step 1: Add map-surface mobile rules inside the existing `@media` block**

```css
  /* Immersive full-bleed map */
  .map-filters {
    top: 8px; left: 8px; right: 8px;
    padding: 8px 10px;
    border-radius: var(--radius);
  }
  .map-filters.filters-sheet-open {
    position: fixed; inset: 0; top: 0; left: 0; right: 0; bottom: 0;
    border-radius: 0; padding: 0; z-index: 2500;
    background: var(--surface-2); backdrop-filter: none;
    overflow-y: auto;
  }
  .map-results-toggle { display: none; }

  /* Results bottom sheet */
  .map-results-drawer {
    left: 0; right: 0; top: auto; bottom: 0; width: auto;
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -6px 24px rgba(0,0,0,.13);
    transition: transform .32s cubic-bezier(.32,.72,0,1);
  }
  .map-results-drawer.closed { transform: none; opacity: 1; pointer-events: auto; }
  .map-results-drawer.detent-peek  { transform: translateY(calc(100% - 116px)); }
  .map-results-drawer.detent-half  { transform: translateY(45%); }
  .map-results-drawer.detent-full  { transform: translateY(64px); }
  .map-results-grip { display: flex; justify-content: center; padding: 9px 0 4px; cursor: pointer; }
  .map-results-grip span { width: 38px; height: 5px; border-radius: 3px; background: var(--border); }
  .map-results-row { padding: 12px 15px; }

  /* Detail rising sheet */
  .map-detail-backdrop { position: fixed; inset: 0; background: rgba(20,18,14,.32); z-index: 1100; }
  .map-detail-panel {
    position: fixed; left: 0; right: 0; bottom: 0; top: auto; width: auto;
    max-height: 88%; border-radius: 18px 18px 0 0; z-index: 1200;
    animation: sheet-rise .3s cubic-bezier(.32,.72,0,1);
  }
  @keyframes sheet-rise { from { transform: translateY(100%); } to { transform: translateY(0); } }
```

(Use the real token names found in globals.css if `--radius`/`--border` differ.)

- [ ] **Step 2: Verify** — purely additive; desktop unaffected (rules are inside the media query). Visual check happens in Task 6.

---

### Task 5: Wire mobile behavior into MapClient + ResultsList

**Files:**
- Modify: `web/app/map/MapClient.tsx`
- Modify: `web/app/map/ResultsList.tsx`

- [ ] **Step 1: MapClient imports + state**

```ts
import { useIsMobile } from './useIsMobile';
import NavMenu from '../components/NavMenu';
import { cycleDetent } from '../../lib/sheet-detent';
import type { SheetDetent } from '../../lib/sheet-detent';
// ...
const isMobile = useIsMobile();
const [detent, setDetent] = useState<SheetDetent>('peek');
const [navMenuOpen, setNavMenuOpen] = useState(false);
```

- [ ] **Step 2: Hamburger in the filter header row (mobile only)**

In the header row inside `.map-filters`, before the `Filters` button:

```tsx
{isMobile && (
  <button type="button" className="btn btn-sm btn-ghost" aria-label="Menu" onClick={() => setNavMenuOpen(true)} style={{ flexShrink: 0 }}>☰</button>
)}
```

And render `{isMobile && <NavMenu open={navMenuOpen} onClose={() => setNavMenuOpen(false)} />}` near the end of the returned tree.

- [ ] **Step 3: Filters-sheet class + apply button**

On `.map-filters`, add the sheet class when open on mobile:

```tsx
<div className={`map-filters${isMobile && filtersOpen ? ' filters-sheet-open' : ''}`}>
```

Inside the `{filtersOpen && (<>…</>)}` block, append a mobile-only sticky apply button at the end:

```tsx
{isMobile && (
  <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={() => setFiltersOpen(false)}>
    Show {summarySentence.matchCount} parks
  </button>
)}
```

- [ ] **Step 4: Results sheet — always render on mobile, pass detent**

Replace the toggle-button + drawer block so that on mobile the drawer is always present with detent props (the toggle is CSS-hidden anyway, but skip rendering it on mobile):

```tsx
{!isMobile && (
  <button type="button" className="btn btn-sm map-results-toggle" onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen}>
    ☰ {listRows.length} park{listRows.length !== 1 ? 's' : ''}
  </button>
)}
<ResultsList
  rows={listRows}
  sort={listSort}
  onSortChange={setListSortChoice}
  hasLocation={resolvedLocation !== null}
  selectedParkId={selectedPark?.parkPageId ?? null}
  onSelectRow={handleSelectRow}
  open={isMobile ? true : listOpen}
  mobile={isMobile}
  detent={detent}
  onCycleDetent={() => setDetent((d) => cycleDetent(d))}
/>
```

- [ ] **Step 5: Detail backdrop on mobile**

Where `selectedPark` renders `DetailPanel`, wrap with a mobile backdrop that dismisses:

```tsx
{selectedPark && (
  <>
    {isMobile && <div className="map-detail-backdrop" onClick={() => setSelectedPark(null)} />}
    <DetailPanel park={selectedPark} onClose={() => setSelectedPark(null)} taxonomy={taxonomy} minNights={minNights} weekendsOnly={weekendsOnly} availFrom={availFrom} availTo={availTo} />
  </>
)}
```

- [ ] **Step 6: ResultsList — accept mobile/detent props + grip**

Extend the props interface with `mobile?: boolean; detent?: SheetDetent; onCycleDetent?: () => void;`. Compute the wrapper class and render a grip on mobile:

```tsx
import type { SheetDetent } from '../../lib/sheet-detent';
// ...
const mobileClass = mobile ? ` detent-${detent ?? 'peek'}` : '';
return (
  <div className={`map-results-drawer${open ? '' : ' closed'}${mobileClass}`} aria-hidden={!open}>
    {mobile && (
      <div className="map-results-grip" onClick={onCycleDetent}><span /></div>
    )}
    {/* existing header + list unchanged */}
```

- [ ] **Step 7: Verify** — `npm run typecheck` clean.

---

### Task 6: Full verification + docs

- [ ] **Step 1: `npm run typecheck`** — clean
- [ ] **Step 2: `npm test`** — prior count + 1 (`cycleDetent`)
- [ ] **Step 3: Desktop regression** (preview at 1280×800): filter bar, results drawer toggle, detail panel all behave exactly as before — confirm the media query didn't leak.
- [ ] **Step 4: Mobile walkthrough** (preview resized to 375×812): global nav hidden on map; ☰ opens the slide-in menu; map full-bleed; Filters opens full-screen sheet with "Show N parks"; results sheet grip cycles peek→half→full; tapping a row/pin flies the map and raises the detail sheet over a backdrop; backdrop/✕ dismiss; console clean, no hydration warning. Also load a non-map page at 375px → brand + ☰ + slide-in menu.
- [ ] **Step 5: Update the P5 section** of the backlog spec (status, shipped notes).
- [ ] **Step 6: Ask the user about committing** (explicit file list).
