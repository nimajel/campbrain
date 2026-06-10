# Map Results Drawer (P4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapsible left results drawer on `/map` — sortable park list synced two-way with pins, per the approved design.

**Architecture:** Pure sort helper in `web/lib/park-list.ts` (TDD); presentational `ResultsList.tsx`; state + derivation wiring in `MapClient.tsx`. Zero API/cache changes.

**Tech Stack:** Next.js 15, React 18, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-map-results-drawer-design.md`

**Commit policy (user preference):** no auto-commit; ask at the end. Stage explicit files only — the alert-scanner session is concurrently editing `src/notifications/`, `src/scanner/`, `src/state/`.

---

### Task 1: `sortParkRows` helper (TDD)

**Files:**
- Create: `web/lib/park-list.ts`
- Test: `test/park-list.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/park-list.test.ts
import { describe, it, expect } from 'vitest';
import { sortParkRows } from '../web/lib/park-list.js';
import type { ParkListRow } from '../web/lib/park-list.js';

function row(partial: Partial<ParkListRow> & { parkName: string }): ParkListRow {
  return {
    parkPageId: partial.parkName,
    isFederal: false,
    siteCount: 0,
    walkUpCount: 0,
    distanceMi: null,
    ...partial,
  };
}

describe('sortParkRows', () => {
  it('sites: descending, name tiebreak', () => {
    const rows = [row({ parkName: 'B', siteCount: 5 }), row({ parkName: 'A', siteCount: 5 }), row({ parkName: 'C', siteCount: 9 })];
    expect(sortParkRows(rows, 'sites').map((r) => r.parkName)).toEqual(['C', 'A', 'B']);
  });

  it('sites: walk-up-only parks (0 bookable) sort last', () => {
    const rows = [row({ parkName: 'Walk', walkUpCount: 3 }), row({ parkName: 'Book', siteCount: 1 })];
    expect(sortParkRows(rows, 'sites').map((r) => r.parkName)).toEqual(['Book', 'Walk']);
  });

  it('distance: ascending, null distances last', () => {
    const rows = [row({ parkName: 'Far', distanceMi: 90 }), row({ parkName: 'NoCoords' }), row({ parkName: 'Near', distanceMi: 12 })];
    expect(sortParkRows(rows, 'distance').map((r) => r.parkName)).toEqual(['Near', 'Far', 'NoCoords']);
  });

  it('name: alphabetical', () => {
    const rows = [row({ parkName: 'Salt Point SP' }), row({ parkName: 'Angel Island SP' })];
    expect(sortParkRows(rows, 'name').map((r) => r.parkName)).toEqual(['Angel Island SP', 'Salt Point SP']);
  });

  it('does not mutate the input array', () => {
    const rows = [row({ parkName: 'B' }), row({ parkName: 'A' })];
    sortParkRows(rows, 'name');
    expect(rows.map((r) => r.parkName)).toEqual(['B', 'A']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/park-list.test.ts` — Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

```ts
// web/lib/park-list.ts
export type ParkListSort = 'sites' | 'distance' | 'name';

export interface ParkListRow {
  parkPageId: string;
  parkName: string;
  isFederal: boolean;
  siteCount: number;
  walkUpCount: number;
  distanceMi: number | null;
}

export function sortParkRows(rows: ParkListRow[], sort: ParkListSort): ParkListRow[] {
  const byName = (a: ParkListRow, b: ParkListRow) => a.parkName.localeCompare(b.parkName);
  const out = [...rows];
  if (sort === 'name') return out.sort(byName);
  if (sort === 'sites') return out.sort((a, b) => b.siteCount - a.siteCount || byName(a, b));
  return out.sort(
    (a, b) => (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity) || byName(a, b),
  );
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run test/park-list.test.ts` — Expected: PASS (5 tests)

---

### Task 2: `ResultsList` component + CSS

**Files:**
- Create: `web/app/map/ResultsList.tsx`
- Modify: `web/app/globals.css` (append)

- [ ] **Step 1: Append drawer CSS**

```css
/* Map results drawer (P4) */
.map-results-drawer {
  position: absolute;
  left: 10px;
  top: 54px;
  bottom: 10px;
  width: 290px;
  z-index: 950;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  transition: transform .25s ease, opacity .25s ease;
}
.map-results-drawer.closed { transform: translateX(-115%); opacity: 0; pointer-events: none; }
.map-results-toggle {
  position: absolute;
  left: 10px;
  top: 10px;
  z-index: 960;
}
.map-results-list { flex: 1; overflow-y: auto; }
.map-results-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  border: none;
  border-top: 1px solid var(--surface-sunken);
  background: none;
  cursor: pointer;
  font-family: var(--font);
}
.map-results-row:hover { background: var(--surface-sunken); }
.map-results-row.selected { background: var(--accent-soft); }
.map-results-glyph {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.map-results-glyph.walkup { background: var(--walkup); }
```

(If `--radius` / `--shadow-float` / `--accent-soft` names differ in globals.css, use the existing token names found there.)

- [ ] **Step 2: Create the component**

```tsx
// web/app/map/ResultsList.tsx
'use client';

import { useEffect, useRef } from 'react';
import { GLYPHS } from '../../lib/map-pins';
import { sortParkRows } from '../../lib/park-list';
import type { ParkListRow, ParkListSort } from '../../lib/park-list';

const SORTS: { key: ParkListSort; label: string }[] = [
  { key: 'sites', label: 'Most sites' },
  { key: 'distance', label: 'Nearest' },
  { key: 'name', label: 'A–Z' },
];

function RowGlyph({ isFederal, walkUpOnly }: { isFederal: boolean; walkUpOnly: boolean }) {
  return (
    <span className={`map-results-glyph${walkUpOnly ? ' walkup' : ''}`}>
      <svg width="14" height="14" viewBox="3 3 19 17" aria-hidden="true">
        <path d={GLYPHS[isFederal ? 'federal' : 'state']} fill="#fff" />
      </svg>
    </span>
  );
}

export default function ResultsList({
  rows,
  sort,
  onSortChange,
  hasLocation,
  selectedParkId,
  onSelectRow,
  open,
}: {
  rows: ParkListRow[];
  sort: ParkListSort;
  onSortChange: (s: ParkListSort) => void;
  hasLocation: boolean;
  selectedParkId: string | null;
  onSelectRow: (parkPageId: string) => void;
  open: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll the externally-selected row (pin click) into view.
  useEffect(() => {
    if (!open || !selectedParkId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-park-id="${CSS.escape(selectedParkId)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, selectedParkId]);

  const sorted = sortParkRows(rows, sort);

  return (
    <div className={`map-results-drawer${open ? '' : ' closed'}`} aria-hidden={!open}>
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 7 }}>
          {rows.length} park{rows.length !== 1 ? 's' : ''} with stays
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {SORTS.map(({ key, label }) => {
            const disabled = key === 'distance' && !hasLocation;
            return (
              <button
                key={key}
                type="button"
                className={`btn btn-sm ${sort === key ? 'btn-primary' : 'btn-ghost'}`}
                disabled={disabled}
                title={disabled ? 'Set a location to sort by distance' : undefined}
                onClick={() => onSortChange(key)}
              >
                {label}
              </button>
            );
          })}
          <span
            className="btn btn-sm btn-ghost"
            style={{ opacity: 0.45, cursor: 'default' }}
            title="Soonest-opening sort is coming — needs scanner-side data"
          >
            Soonest
          </span>
        </div>
      </div>
      <div className="map-results-list" ref={listRef}>
        {sorted.map((r) => {
          const walkUpOnly = r.siteCount === 0 && r.walkUpCount > 0;
          return (
            <button
              key={r.parkPageId}
              type="button"
              data-park-id={r.parkPageId}
              className={`map-results-row${selectedParkId === r.parkPageId ? ' selected' : ''}`}
              onClick={() => onSelectRow(r.parkPageId)}
            >
              <RowGlyph isFederal={r.isFederal} walkUpOnly={walkUpOnly} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.parkName}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {walkUpOnly ? (
                    <span style={{ color: 'var(--walkup)', fontWeight: 600 }}>walk-up only</span>
                  ) : (
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                      {r.siteCount} site{r.siteCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {r.distanceMi !== null && <> · {Math.round(r.distanceMi)} mi</>}
                </span>
              </span>
            </button>
          );
        })}
        {sorted.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>
            No parks match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify** — `npm run typecheck` passes.

---

### Task 3: Wire into MapClient

**Files:**
- Modify: `web/app/map/MapClient.tsx`

- [ ] **Step 1: Imports + state**

```ts
import ResultsList from './ResultsList';
import { getParkType } from '../../lib/map-pins';
import type { ParkListRow, ParkListSort } from '../../lib/park-list';
```

Near the other state declarations:

```ts
// Results drawer
const [listOpen, setListOpen] = useState(false);
const [listSortChoice, setListSortChoice] = useState<ParkListSort | null>(null);
const listSort: ParkListSort = listSortChoice ?? (resolvedLocation ? 'distance' : 'sites');
```

- [ ] **Step 2: Derive rows** (after `availByPark` memo)

```ts
// Drawer rows: distance-filtered parks with any availability (bookable OR walk-up —
// unlike filteredParks, which counts only bookable parks).
const listRows = useMemo<ParkListRow[]>(() => {
  if (!availByPark) return [];
  return displayedParks.flatMap((p) => {
    const a = availByPark.get(p.parkPageId);
    if (!a || (a.siteCount === 0 && a.walkUpCount === 0)) return [];
    return [{
      parkPageId: p.parkPageId,
      parkName: p.parkName,
      isFederal: getParkType(p.provider) === 'federal',
      siteCount: a.siteCount,
      walkUpCount: a.walkUpCount,
      distanceMi: resolvedLocation && p.latitude && p.longitude
        ? haversine(resolvedLocation.lat, resolvedLocation.lon, p.latitude, p.longitude)
        : null,
    }];
  });
}, [displayedParks, availByPark, resolvedLocation]);
```

- [ ] **Step 3: Row select handler**

```ts
const handleSelectRow = useCallback((parkPageId: string) => {
  const park = parks.find((p) => p.parkPageId === parkPageId);
  if (park) setSelectedPark(park);
}, [parks]);
```

(`setSelectedPark` flows into `FlyTo` → the map zooms to the park, same as a pin click.)

- [ ] **Step 4: Render toggle + drawer inside the map container**

Inside the `.map-container` div, alongside the existing `<LeafletMap>`:

```tsx
<button
  type="button"
  className="btn btn-sm map-results-toggle"
  onClick={() => setListOpen((o) => !o)}
  aria-expanded={listOpen}
>
  ☰ {listRows.length} park{listRows.length !== 1 ? 's' : ''}
</button>
<ResultsList
  rows={listRows}
  sort={listSort}
  onSortChange={setListSortChoice}
  hasLocation={resolvedLocation !== null}
  selectedParkId={selectedPark?.parkPageId ?? null}
  onSelectRow={handleSelectRow}
  open={listOpen}
/>
```

(`.map-container` must be `position: relative` — verify in globals.css; add if missing.)

- [ ] **Step 5: Verify** — typecheck; manual walkthrough below.

---

### Task 4: Full verification + docs

- [ ] **Step 1: `npm run typecheck`** — clean
- [ ] **Step 2: `npm test`** — 407 passing (402 + 5 new)
- [ ] **Step 3: Live walkthrough** (port 3002): toggle opens/closes drawer; default sort Most sites; set a location → Nearest auto-applies and distances appear; row click flies to the park + opens detail; pin click highlights + scrolls its row; walk-up-only park shows amber; Soonest pill disabled; no console errors.
- [ ] **Step 4: Update the P4 section** of the backlog spec (status, shipped notes)
- [ ] **Step 5: Ask the user about committing** (explicit file list — alert session is active in `src/`)
