# Map Quick-Wins Bundle (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the nine approved P1 quick-wins for `/map`: CA-fit initial bounds, view restore on panel close, upcoming-weekend default dates + Weekend quick button, SUCCESS-badge removal, marker name tooltips, selection ≠ filter counts, zoom/legend overlap fixes, "Weekend of" headers, and real Book buttons.

**Architecture:** All changes are client-side presentation/state in `web/app/map/` plus one pure date helper in `web/lib/` (unit-tested) and a one-line Next config change. No API or schema changes.

**Tech Stack:** Next.js 15, React 18, react-leaflet 5, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-map-view-improvements.md` (P1 section).

**Commit policy (user preference override):** Do NOT auto-commit. Complete all tasks, run verification, then ask the user before any `git commit`. Per-task commit steps are intentionally omitted.

---

### Task 1: Upcoming-weekend date helper (TDD)

**Files:**
- Create: `web/lib/upcoming-weekend.ts`
- Test: `test/upcoming-weekend.test.ts`

Rule: default range covers the next Fri→Mon weekend span. Saturday keeps the in-progress weekend (today→Mon). Sunday rolls to next weekend (Fri→Mon).

- [ ] **Step 1: Write the failing test**

```ts
// test/upcoming-weekend.test.ts
import { describe, it, expect } from 'vitest';
import { upcomingWeekendRange } from '../web/lib/upcoming-weekend.js';

// 2026-06-09 is a Tuesday.
describe('upcomingWeekendRange', () => {
  it('mid-week (Tue) → next Fri through Mon', () => {
    expect(upcomingWeekendRange(new Date(2026, 5, 9))).toEqual({
      from: '2026-06-12', to: '2026-06-15',
    });
  });

  it('Friday → today through Mon', () => {
    expect(upcomingWeekendRange(new Date(2026, 5, 12))).toEqual({
      from: '2026-06-12', to: '2026-06-15',
    });
  });

  it('Saturday → today through Mon (weekend in progress)', () => {
    expect(upcomingWeekendRange(new Date(2026, 5, 13))).toEqual({
      from: '2026-06-13', to: '2026-06-15',
    });
  });

  it('Sunday → next Fri through Mon', () => {
    expect(upcomingWeekendRange(new Date(2026, 5, 14))).toEqual({
      from: '2026-06-19', to: '2026-06-22',
    });
  });

  it('Monday → upcoming Fri through Mon', () => {
    expect(upcomingWeekendRange(new Date(2026, 5, 15))).toEqual({
      from: '2026-06-19', to: '2026-06-22',
    });
  });

  it('formats single-digit months/days with leading zeros', () => {
    // 2027-01-05 is a Tuesday → Fri 2027-01-08
    expect(upcomingWeekendRange(new Date(2027, 0, 5))).toEqual({
      from: '2027-01-08', to: '2027-01-11',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/upcoming-weekend.test.ts`
Expected: FAIL — cannot resolve `../web/lib/upcoming-weekend.js`

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/upcoming-weekend.ts
function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * Default /map date range: the upcoming Fri→Mon weekend span.
 * Saturday keeps the in-progress weekend (today→Mon); Sunday rolls to next weekend.
 */
export function upcomingWeekendRange(today: Date): { from: string; to: string } {
  const dow = today.getDay(); // 0=Sun … 5=Fri, 6=Sat
  if (dow === 6) {
    return { from: toIsoLocal(today), to: toIsoLocal(addDays(today, 2)) };
  }
  const daysToFriday = dow === 0 ? 5 : (5 - dow + 7) % 7;
  const friday = addDays(today, daysToFriday);
  return { from: toIsoLocal(friday), to: toIsoLocal(addDays(friday, 3)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/upcoming-weekend.test.ts`
Expected: PASS (6 tests)

---

### Task 2: Default date range + "Weekend" quick button

**Files:**
- Modify: `web/app/map/MapClient.tsx` (imports; `availFrom`/`availTo` init around line 562; quick buttons around line 882)

- [ ] **Step 1: Import the helper**

```ts
import { upcomingWeekendRange } from '../../lib/upcoming-weekend';
```

- [ ] **Step 2: Set the default on mount (hydration-safe)**

`availFrom`/`availTo` stay `useState('')`. Add directly below their declarations:

```ts
// Default to the upcoming weekend so pins show weekend availability on first load.
// Set on mount (not in the initializer) so SSR and client markup match.
useEffect(() => {
  const { from, to } = upcomingWeekendRange(new Date());
  setAvailFrom(from);
  setAvailTo(to);
}, []);
```

- [ ] **Step 3: Add the "Weekend" quick button**

In the date-range block, before the "2 weeks" button, following the existing active-check idiom:

```tsx
{(() => {
  const wk = upcomingWeekendRange(new Date());
  const active = availFrom === wk.from && availTo === wk.to;
  return (
    <button
      type="button"
      className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
      style={active ? { fontWeight: 700 } : {}}
      onClick={() => { setAvailFrom(wk.from); setAvailTo(wk.to); }}
    >
      {active ? '✓ Weekend' : 'Weekend'}
    </button>
  );
})()}
```

- [ ] **Step 4: Verify in preview**

Reload `/map`: date inputs show the upcoming Fri/Mon, "✓ Weekend" is highlighted, pins grey/match accordingly, no hydration warning in console.

---

### Task 3: Selection ≠ filter

**Files:**
- Modify: `web/app/map/MapClient.tsx:599-643`

- [ ] **Step 1: Remove `selectedParkId` from `filteredParks`**

```ts
// Parks matching ALL filters — used for count display. Dropdown selection is
// not a filter: it only opens the panel and flies to the park.
const filteredParks = useMemo(() => {
  let result = parks;

  if (resolvedLocation && distanceMiles !== null) {
    result = result.filter((p) => {
      if (!p.latitude || !p.longitude) return false;
      return haversine(resolvedLocation.lat, resolvedLocation.lon, p.latitude, p.longitude) <= distanceMiles;
    });
  }

  if (parksInDateRange !== null) {
    result = result.filter((p) =>
      p.facilityPageIds.some((fid) => parksInDateRange.has(fid))
    );
  }

  return result;
}, [parks, resolvedLocation, distanceMiles, parksInDateRange]);
```

- [ ] **Step 2: Remove `selectedParkId` from pin-greying**

```ts
const hasOtherFilters = parksInDateRange !== null;
```

(`hasActiveFilters` keeps `!!selectedParkId` so Reset still appears and clears the selection.)

- [ ] **Step 3: Verify in preview**

Select "Anza-Borrego Desert SP" from the dropdown: panel opens, map flies there, pin golds — but the header count and "N match" stay unchanged, and other pins keep their colors.

---

### Task 4: Remove SUCCESS badge

**Files:**
- Modify: `web/app/map/MapClient.tsx` (badge at ~line 425; `statusBadge()` helper at ~line 72)

- [ ] **Step 1: Delete the badge span from `DetailPanel`**

Remove:

```tsx
<span className={`badge ${statusBadge(park.discoveryStatus)}`}>
  {park.discoveryStatus ?? 'unknown'}
</span>
```

`ProviderBadge` and the campground/site counts remain.

- [ ] **Step 2: Delete the now-unused `statusBadge()` helper**

- [ ] **Step 3: Verify**

`npm run typecheck` passes (catches any remaining reference); panel header shows provider badge + counts only.

---

### Task 5: "Weekend of" header

**Files:**
- Modify: `web/app/map/MapClient.tsx:213-232` (`WeekendRow`)

- [ ] **Step 1: Replace the conditional label block**

Delete the `hasMultiNight`/`label` computation (lines ~223–232) and the now-unused `has1NightFri`/`has1NightSat` consts. Keep `hasFull3Night`/`has2NightFri`/`has2NightSat` (they drive the badges). The label becomes:

```ts
const label = `Weekend of ${formatDate(entry.fridayDate)}`;
```

- [ ] **Step 2: Verify**

`npm run typecheck` passes; a weekend row reads "Weekend of Fri, Jun 12" with tier badges, and tier lines carry the exact nights.

---

### Task 6: Real Book buttons

**Files:**
- Modify: `web/app/map/MapClient.tsx` (`BookLink` ~line 20; tier lines in `WeekendRow` ~lines 279–308; campground line in `DateRow` ~lines 192–204)

- [ ] **Step 1: Restyle `BookLink` as a button pill**

```tsx
/** "Book" button that injects the actual arrival date + nights into the ReserveCalifornia URL. */
function BookLink({ url, arrival, nights }: { url?: string; arrival: string; nights: number }) {
  if (!url) return null;
  return (
    <a
      href={injectBookingDates(url, arrival, nights)}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-sm"
      style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11, padding: '2px 10px', textDecoration: 'none' }}
    >
      Book
    </a>
  );
}
```

- [ ] **Step 2: Make each tier line a flex row**

Apply to all five tier lines in `WeekendRow` (3N, 2N Fri, 2N Sat, 1N Fri, 1N Sat) — text in a span, button right-aligned. Pattern (3N shown; repeat for the other four with their existing colors/site arrays/nights):

```tsx
{line3 && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--green)', paddingLeft: 8 }}>
    <span>Fri–Mon (3 nights): {siteListText(cg.sites3Night)}</span>
    <BookLink url={cg.bookingUrl} arrival={fri} nights={3} />
  </div>
)}
```

- [ ] **Step 3: Same treatment for `DateRow`'s campground line**

```tsx
{cg.sites.length > 0 && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span>— {siteListText(cg.sites, 6)}</span>
    <BookLink url={cg.bookingUrl} arrival={entry.date} nights={nights} />
  </div>
)}
```

(Adjust surrounding markup so the campground name stays on its own line above; `WalkUpLine` unchanged.)

- [ ] **Step 4: Verify in preview**

Open Point Reyes panel: each tier shows a right-aligned "Book" pill; click-through lands on the booking URL with correct arrival/nights query params.

---

### Task 7: LeafletMap — bounds, tooltips, zoom position, view restore

**Files:**
- Modify: `web/app/map/LeafletMap.tsx`

- [ ] **Step 1: Imports**

```ts
import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, ZoomControl, useMap } from 'react-leaflet';
```

- [ ] **Step 2: CA-fit initial bounds + zoom bottom-right**

```tsx
const CA_BOUNDS: L.LatLngBoundsExpression = [[32.3, -124.6], [42.1, -114.0]];

<MapContainer
  bounds={CA_BOUNDS}
  zoomControl={false}
  style={{ height: '100%', width: '100%' }}
>
  <ZoomControl position="bottomright" />
  ...
```

(`center`/`zoom` props removed — `bounds` replaces them.)

- [ ] **Step 3: View restore in `FlyTo`**

```tsx
function FlyTo({ park }: { park: MapPark | null }) {
  const map = useMap();
  const savedView = useRef<{ center: L.LatLng; zoom: number } | null>(null);
  useEffect(() => {
    if (park?.latitude && park?.longitude) {
      // Remember the view from before the first selection so closing the panel returns to it.
      if (!savedView.current) {
        savedView.current = { center: map.getCenter(), zoom: map.getZoom() };
      }
      map.flyTo([park.latitude, park.longitude], 12, { duration: 0.8 });
    } else if (savedView.current) {
      map.flyTo(savedView.current.center, savedView.current.zoom, { duration: 0.8 });
      savedView.current = null;
    }
  }, [map, park]);
  return null;
}
```

- [ ] **Step 4: Marker name tooltips**

```tsx
<Marker
  key={park.parkPageId}
  position={[park.latitude!, park.longitude!]}
  icon={icon}
  title={park.parkName}
  alt={park.parkName}
  eventHandlers={{ click: () => onSelectPark(park) }}
>
```

- [ ] **Step 5: Verify in preview**

Fresh load frames California; zoom control bottom-right above attribution; hovering a pin shows the park name; click pin → fly in; close panel → fly back to prior view.

---

### Task 8: Disable Next.js dev indicator

**Files:**
- Modify: `web/next.config.ts:17`

- [ ] **Step 1: Add the option**

```ts
const nextConfig: NextConfig = {
  devIndicators: false,
  // Allow webpack to resolve .js imports as .ts files
  ...
```

- [ ] **Step 2: Verify**

Restart the dev server; the dark "N" circle no longer covers the legend's last row.

---

### Task 9: Full verification + spec checkboxes

- [ ] **Step 1: `npm run typecheck`** — expected: clean
- [ ] **Step 2: `npm test`** — expected: 346 passing (340 + 6 new)
- [ ] **Step 3: Live walkthrough** at 1440×900: load (CA framed, Weekend default active, count sane) → hover pin (name tooltip) → click pin (panel: no SUCCESS badge, "Weekend of" headers, Book pills) → close panel (view restores) → dropdown select (counts/pins unaffected) → Reset. Console: no errors, no hydration warnings.
- [ ] **Step 4: Check off the P1 items** in `docs/superpowers/specs/2026-06-09-map-view-improvements.md`
- [ ] **Step 5: Ask the user about committing** (user preference: never auto-commit)
