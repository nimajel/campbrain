# Map Input Polish + Soonest Sort (P6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Themed react-day-picker range picker, labeled geocode controls, end-to-end "Soonest opening" sort, focus-visible pass — per the approved P6 design.

**Architecture:** `firstMatchingArrival` extraction + `soonestDate` aggregate in the cache layer (TDD), threaded through summary route → MapClient → `ParkListRow` → sort (TDD). `DateRangePicker.tsx` wraps react-day-picker v9; CSS theming + focus ring in `globals.css`.

**Tech Stack:** Next.js 15, React 18, react-day-picker 9, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-map-input-polish-design.md`

**Commit policy (user preference):** no auto-commit; explicit file staging; ask at the end.

---

### Task 1: `firstMatchingArrival` + `soonestDate` in the cache layer (TDD)

**Files:**
- Modify: `src/cache/availability-cache.ts`
- Test: `test/min-nights.test.ts` (extend), `test/availability-clauses.test.ts` (untouched)

- [ ] **Step 1: Add failing tests** to `test/min-nights.test.ts`:

```ts
import { firstMatchingArrival } from '../src/cache/availability-cache.js';

describe('firstMatchingArrival', () => {
  it('returns the first valid arrival date', () => {
    expect(firstMatchingArrival(['2026-06-12', '2026-06-13', '2026-06-14'], { minNights: 2 }))
      .toBe('2026-06-12');
  });
  it('skips arrivals whose stay would exceed `to`', () => {
    expect(firstMatchingArrival(['2026-06-14', '2026-06-15'], { minNights: 2, to: '2026-06-14' }))
      .toBeNull();
  });
  it('honors weekendsOnly arrival DOW', () => {
    // 2026-06-10 is a Wednesday; 2026-06-12 a Friday
    expect(firstMatchingArrival(['2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13'], { minNights: 2, weekendsOnly: true }))
      .toBe('2026-06-12');
  });
  it('returns null when no window fits', () => {
    expect(firstMatchingArrival(['2026-06-12', '2026-06-15'], { minNights: 2 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/min-nights.test.ts` — FAIL (no export)

- [ ] **Step 3: Implement** — move the loop body of `siteMatchesMinStay` into:

```ts
export function firstMatchingArrival(availableDates: string[], opts: MinStayOptions): string | null {
  const { minNights, from, to, weekendsOnly = false } = opts;
  const set = new Set(availableDates);
  const sorted = [...set].sort();
  for (const arrival of sorted) {
    if (from && arrival < from) continue;
    const lastNight = addDaysIso(arrival, minNights - 1);
    if (to && lastNight > to) continue;
    if (weekendsOnly) {
      const dow = isoDow(arrival);
      if (dow !== 5 && dow !== 6) continue;
    }
    let ok = true;
    for (let i = 0; i < minNights; i++) {
      if (!set.has(addDaysIso(arrival, i))) { ok = false; break; }
    }
    if (ok) return arrival;
  }
  return null;
}

export function siteMatchesMinStay(availableDates: string[], opts: MinStayOptions): boolean {
  return firstMatchingArrival(availableDates, opts) !== null;
}
```

- [ ] **Step 4: `soonestDate` in `ParkAvailabilityCount` + both query paths**

```ts
export interface ParkAvailabilityCount {
  parkPageId: string;
  siteCount: number;
  walkUpCount: number;
  soonestDate: string | null; // earliest bookable date matching the filters; null if walk-up-only
}
```

SQL path — add to the SELECT (DOW clauses already in WHERE, so weekends-only yields the soonest weekend date):

```sql
MIN(a.date) FILTER (WHERE NOT s.is_walk_up)::text AS soonest_date
```

and map `soonestDate: r.soonest_date ?? null`.

Min-stay path — replace the boolean check with the arrival; track the per-park min over bookable sites:

```ts
const arrival = firstMatchingArrival(dates, stay);
if (arrival === null) continue;
...
if (isWalkUp) { if (!excludeWalkUp) p.walkUpCount++; }
else {
  p.siteCount++;
  if (p.soonestDate === null || arrival < p.soonestDate) p.soonestDate = arrival;
}
```

- [ ] **Step 5: Run** `npx vitest run test/min-nights.test.ts test/availability-clauses.test.ts` — PASS; `npm run typecheck` (the summary route's re-export consumers will surface anything missed)

---

### Task 2: Thread `soonestDate` to the drawer + `'soonest'` sort (TDD)

**Files:**
- Modify: `web/lib/park-list.ts`, `test/park-list.test.ts`
- Modify: `web/app/map/MapClient.tsx` (`ParkAvailabilitySummary`, summary fetch mapping, `availByPark`, `listRows`)
- Modify: `web/app/map/ResultsList.tsx` (pill + row sub-line)

- [ ] **Step 1: Failing tests** in `test/park-list.test.ts` (extend `row()` default with `soonestDate: null`):

```ts
it('soonest: ascending date, nulls last, name tiebreak', () => {
  const rows = [
    row({ parkName: 'B', soonestDate: '2026-06-19' }),
    row({ parkName: 'WalkUpOnly' }),
    row({ parkName: 'A', soonestDate: '2026-06-12' }),
    row({ parkName: 'C', soonestDate: '2026-06-12' }),
  ];
  expect(sortParkRows(rows, 'soonest').map((r) => r.parkName)).toEqual(['A', 'C', 'B', 'WalkUpOnly']);
});
```

- [ ] **Step 2: Implement** — `ParkListSort` adds `'soonest'`; `ParkListRow.soonestDate: string | null`;

```ts
if (sort === 'soonest') {
  return out.sort((a, b) => {
    if (a.soonestDate === b.soonestDate) return byName(a, b);
    if (a.soonestDate === null) return 1;
    if (b.soonestDate === null) return -1;
    return a.soonestDate < b.soonestDate ? -1 : 1;
  });
}
```

- [ ] **Step 3: MapClient threading** — `ParkAvailabilitySummary` gains `soonestDate: string | null`; fetch mapping copies it; `availByPark` aggregation takes the min across facilities (`if (a.soonestDate && (!acc.soonestDate || a.soonestDate < acc.soonestDate)) acc.soonestDate = a.soonestDate`); `listRows` copies it onto the row.

- [ ] **Step 4: ResultsList** — move `'soonest'` into `SORTS` (label "Soonest"), delete the disabled placeholder `<span>`; in the row sub-line, when `sort === 'soonest' && r.soonestDate`, render `opens {formatShortDate(r.soonestDate)} · ` before the count (tiny local `formatShortDate` using the same `en-US` weekday/month/day format MapClient uses).

- [ ] **Step 5: Verify** — `npx vitest run test/park-list.test.ts` PASS; typecheck clean.

---

### Task 3: `DateRangePicker` component + theming

**Files:**
- `npm install react-day-picker` (in `web/`)
- Create: `web/app/map/DateRangePicker.tsx`
- Modify: `web/app/globals.css`

- [ ] **Step 1: Install** — `cd web && npm install react-day-picker@^9`

- [ ] **Step 2: Component** — trigger pill + popover (desktop) / inline (mobile):

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import type { DateRange } from 'react-day-picker';

function parseIso(iso: string): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function toIso(d: Date | undefined): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function label(from: string, to: string): string {
  const fmt = (iso: string) => {
    const d = parseIso(iso)!;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  if (!from) return 'Pick dates…';
  return to ? `${fmt(from)} – ${fmt(to)}` : `${fmt(from)} →`;
}

export default function DateRangePicker({
  from,
  to,
  onChange,
  mobile = false,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  mobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const selected: DateRange | undefined = from ? { from: parseIso(from), to: parseIso(to) } : undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const picker = (
    <DayPicker
      mode="range"
      numberOfMonths={mobile ? 1 : 2}
      selected={selected}
      disabled={{ before: today }}
      onSelect={(range) => {
        onChange(toIso(range?.from), toIso(range?.to));
        if (range?.from && range?.to && !mobile) setOpen(false);
      }}
    />
  );

  if (mobile) {
    return <div className="date-range-picker date-range-picker--inline">{picker}</div>;
  }

  return (
    <div ref={wrapRef} className="date-range-picker" style={{ position: 'relative' }}>
      <button
        type="button"
        className={`btn btn-sm ${from ? 'btn-slate' : 'btn-ghost'}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        📅 {label(from, to)}
      </button>
      {open && <div className="date-range-popover">{picker}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Theming + popover CSS** (append to `globals.css`):

```css
/* Date-range picker (P6) */
.date-range-popover {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 1500;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow-float); padding: 10px;
}
.date-range-picker .rdp-root {
  --rdp-accent-color: var(--accent);
  --rdp-accent-background-color: var(--accent-soft);
  --rdp-today-color: var(--accent);
  --rdp-font-family: var(--font);
  --rdp-day-height: 34px; --rdp-day-width: 34px;
  font-size: 13px; color: var(--text);
}
.date-range-picker .rdp-range_middle { background: var(--accent-soft); }
.date-range-picker--inline { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px; }
.date-range-picker--inline .rdp-months { justify-content: center; }
@media (max-width: 640px) {
  .date-range-popover { position: fixed; left: 12px; right: 12px; top: auto; }
}
```

- [ ] **Step 4: Verify** — typecheck; component renders standalone.

---

### Task 4: Wire into the WHEN row (replace native inputs)

**Files:**
- Modify: `web/app/map/MapClient.tsx`

- [ ] **Step 1:** Import `DateRangePicker`; replace the two `<input type="date">` + `—` separator in the WHEN row with:

```tsx
<DateRangePicker
  from={availFrom}
  to={availTo}
  mobile={isMobile}
  onChange={(f, t) => {
    setAvailFrom(f);
    setAvailTo(t);
    const derived = derivePreset(f, t);
    if (derived) setPreset(derived);
  }}
/>
```

(`derivePreset` currently runs on each input's onChange — same logic, single callback now.)

- [ ] **Step 2: Verify in preview** — desktop popover opens, range select sets dates + preset highlight, weekend preset still drives the picker label; mobile filters sheet shows the inline calendar.

---

### Task 5: Geocode controls + focus-visible

**Files:**
- Modify: `web/app/map/MapClient.tsx` (NEAR row), `web/app/globals.css`

- [ ] **Step 1:** Placeholder → `City or place…`; the `→` button becomes `Search` (keep `disabled={geocoding}`, spinner text "…" → "Searching…"); the `📍` button becomes `📍 Use my location`.

- [ ] **Step 2: Focus ring** (append to `globals.css`):

```css
.btn:focus-visible, .map-results-row:focus-visible, .form-input:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
```

- [ ] **Step 3: Verify in preview** — tab through the filter bar and drawer; rings visible; geocode still resolves.

---

### Task 6: Full verification + docs + commit ask

- [ ] **Step 1:** `npm run typecheck` clean; `npm test` — 421+ passing (416 + new)
- [ ] **Step 2:** Live walkthrough desktop (1280px): picker popover, range select, presets, Soonest sort ordering + "opens" sub-lines, geocode relabel, focus rings. Mobile (375px): inline calendar in filters sheet, Soonest pill, no regressions in sheets. Console clean both.
- [ ] **Step 3:** Update P6 section in the backlog spec; update memory.
- [ ] **Step 4:** Ask the user about committing (explicit staging: `web/package.json`, `web/package-lock.json`, new/modified files above).
