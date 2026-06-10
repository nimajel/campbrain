# Map Detail Panel Content Redesign (P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/map` detail panel booking-decision quality: nightly fees, title-cased site chips with cap+expand, consistent tier rows, no duplicate map popup — plus two deferred P2.5 cleanups.

**Architecture:** One pure formatting helper in `web/lib/` (unit-tested), `nightlyFee` threaded through the existing `cgMeta`/`buildDateSiteMap` paths in the availability route, and presentational restructuring inside `MapClient.tsx` (new `SiteChips` + `TierLine` components replace the five copy-pasted tier lines). No DB changes.

**Tech Stack:** Next.js 15, React 18, react-leaflet 5, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-map-view-improvements.md` (P3 section).

**Commit policy (user preference override):** Do NOT auto-commit. P2.5 is staged but uncommitted — leave P3 changes unstaged; the user commits P2.5 first, then P3.

---

### Task 1: `formatSiteName` helper (TDD)

**Files:**
- Create: `web/lib/site-display.ts`
- Test: `test/site-display.test.ts`

Rule: collapse whitespace; title-case any word of ≥2 letters that is fully uppercase; leave mixed-case words, single letters, and digit-bearing tokens ("#42", "1-6") untouched.

- [ ] **Step 1: Write the failing test**

```ts
// test/site-display.test.ts
import { describe, it, expect } from 'vitest';
import { formatSiteName } from '../web/lib/site-display.js';

describe('formatSiteName', () => {
  it('title-cases all-caps words', () => {
    expect(formatSiteName('MARSHALL BEACH BOAT IN GROUP 1')).toBe('Marshall Beach Boat In Group 1');
  });

  it('leaves mixed-case names untouched', () => {
    expect(formatSiteName('Campsite #42')).toBe('Campsite #42');
  });

  it('keeps single letters and capacity ranges as-is', () => {
    expect(formatSiteName('BOAT A, 1-6 people')).toBe('Boat A, 1-6 people');
  });

  it('keeps digit-bearing tokens untouched', () => {
    expect(formatSiteName('SITE #12B')).toBe('Site #12B');
  });

  it('collapses runs of whitespace', () => {
    expect(formatSiteName('  BOAT   ONLY,  15-25 people ')).toBe('Boat Only, 15-25 people');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/site-display.test.ts`
Expected: FAIL — cannot resolve `../web/lib/site-display.js`

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/site-display.ts
/**
 * Normalize shouty provider site names for display: title-case fully-uppercase
 * words (≥2 letters), leave mixed-case words, single letters, and tokens
 * containing digits untouched, and collapse whitespace.
 */
export function formatSiteName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => {
      const letters = word.replace(/[^A-Za-z]/g, '');
      if (letters.length < 2) return word;
      if (/\d/.test(word)) return word;
      if (word !== word.toUpperCase()) return word;
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/site-display.test.ts`
Expected: PASS (5 tests)

---

### Task 2: `nightlyFee` through the availability API

**Files:**
- Modify: `web/app/api/map/availability/route.ts`

- [ ] **Step 1: Extend the response types**

Add `nightlyFee: number | null;` after `bookingUrl?: string;` in BOTH `AvailableDateEntry.campgrounds` (line ~18) and `WeekendEntry.campgrounds` (line ~32).

- [ ] **Step 2: Thread the fee through `buildDateSiteMap`**

The cgMap value type gains `nightlyFee`:

```ts
): Map<string, Map<string, { sites: string[]; bookingUrl?: string; nightlyFee: number | null }>> {
  const dateMap = new Map<string, Map<string, { sites: string[]; bookingUrl?: string; nightlyFee: number | null }>>();
```

and the seeding line becomes:

```ts
cgMap.set(cg.name, { sites: [], bookingUrl: cg.bookingUrl, nightlyFee: cg.nightlyFee ?? null });
```

Update `sitesAvailableForDates`'s `dateMap` parameter type to match.

- [ ] **Step 3: Extend `cgMeta` and both response builders**

```ts
const cgMeta = new Map<string, { bookingUrl?: string; nightlyFee: number | null }>();
for (const entry of parkEntries) {
  for (const cg of entry.campgrounds) {
    if (!cgMeta.has(cg.name)) cgMeta.set(cg.name, { bookingUrl: cg.bookingUrl, nightlyFee: cg.nightlyFee ?? null });
  }
}
```

Dates builder: `.map(([name, { sites, bookingUrl, nightlyFee }]) => ({ name, bookingUrl, nightlyFee, ... }))`.
Weekends builder: `bookingUrl: cgMeta.get(cgName)?.bookingUrl, nightlyFee: cgMeta.get(cgName)?.nightlyFee ?? null,`.

- [ ] **Step 4: Verify**

`npm run typecheck` passes; `curl 'http://localhost:3002/api/map/availability?parkPageId=<id>&from=...&to=...'` shows `nightlyFee` per campground.

---

### Task 3: `SiteChips` component + chip CSS

**Files:**
- Modify: `web/app/map/MapClient.tsx` (replace `siteListText` usage; component near top)
- Modify: `web/app/globals.css` (chip classes)

- [ ] **Step 1: Add chip CSS to globals.css**

```css
/* Detail-panel site chips */
.site-chip {
  display: inline-block;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 10.5px;
  color: var(--text);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.site-chip--more {
  cursor: pointer;
  background: transparent;
  color: var(--muted);
  font-family: var(--font);
}
.site-chip--more:hover { border-color: var(--muted); }
```

- [ ] **Step 2: Add the `SiteChips` component to MapClient**

```tsx
import { formatSiteName } from '../../lib/site-display';

/** Site names as capped, expandable chips. */
function SiteChips({ sites, max = 6, muted = false }: { sites: string[]; max?: number; muted?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (sites.length === 0) return null;
  const shown = expanded ? sites : sites.slice(0, max);
  const hidden = sites.length - shown.length;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', flex: 1, minWidth: 0 }}>
      {shown.map((s) => {
        const name = formatSiteName(s);
        return (
          <span key={s} className="site-chip" title={name} style={muted ? { opacity: 0.75 } : undefined}>
            {name}
          </span>
        );
      })}
      {hidden > 0 && (
        <button type="button" className="site-chip site-chip--more" onClick={() => setExpanded(true)}>
          +{hidden} more
        </button>
      )}
      {expanded && sites.length > max && (
        <button type="button" className="site-chip site-chip--more" onClick={() => setExpanded(false)}>
          less
        </button>
      )}
    </div>
  );
}
```

(`siteListText` is deleted once all call sites are converted in Task 4.)

---

### Task 4: Tier rows, fees, walk-up chips, `minNights` rename

**Files:**
- Modify: `web/app/map/MapClient.tsx` (`WeekendRow`, `DateRow`, `WalkUpLine`)

- [ ] **Step 1: Add a `TierLine` component**

```tsx
/** One bookable stay option: tier label + site chips + Book button. */
function TierLine({ label, sites, url, arrival, nights, highlight = false }: {
  label: string;
  sites: string[];
  url?: string;
  arrival: string;
  nights: number;
  highlight?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingLeft: 8, marginTop: 4 }}>
      <span style={{
        fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', paddingTop: 3,
        color: highlight ? 'var(--green)' : 'var(--muted)',
      }}>
        {label}
      </span>
      <SiteChips sites={sites} />
      <BookLink url={url} arrival={arrival} nights={nights} />
    </div>
  );
}
```

- [ ] **Step 2: Campground header with fee (shared snippet)**

In both `WeekendRow` and `DateRow`, the campground name line becomes:

```tsx
<div style={{ fontSize: 12, fontWeight: 600 }}>
  {cg.name}
  {cg.nightlyFee != null && (
    <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · ${cg.nightlyFee}/night</span>
  )}
</div>
```

- [ ] **Step 3: Replace the five tier lines in `WeekendRow`**

```tsx
{line3 && <TierLine label="Fri–Mon · 3 nights" sites={cg.sites3Night} url={cg.bookingUrl} arrival={fri} nights={3} highlight />}
{line2Fri && <TierLine label="Fri–Sun · 2 nights" sites={cg.sites2NightFri} url={cg.bookingUrl} arrival={fri} nights={2} />}
{line2Sat && <TierLine label="Sat–Mon · 2 nights" sites={cg.sites2NightSat} url={cg.bookingUrl} arrival={sat} nights={2} />}
{line1Fri && <TierLine label="Fri · 1 night" sites={cg.sites1NightFri} url={cg.bookingUrl} arrival={fri} nights={1} />}
{line1Sat && <TierLine label="Sat · 1 night" sites={cg.sites1NightSat} url={cg.bookingUrl} arrival={sat} nights={1} />}
```

- [ ] **Step 4: `DateRow` site line becomes chips**

```tsx
{cg.sites.length > 0 && (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 2 }}>
    <SiteChips sites={cg.sites} />
    <BookLink url={cg.bookingUrl} arrival={entry.date} nights={nights} />
  </div>
)}
```

- [ ] **Step 5: `WalkUpLine` keeps badge + note, sites become muted chips**

```tsx
function WalkUpLine({ sites }: { sites: string[] }) {
  if (sites.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, paddingLeft: 8, marginTop: 4 }}>
      <span className="badge badge-gray" style={{ fontSize: 9, flexShrink: 0, marginTop: 2 }}>walk-up</span>
      <SiteChips sites={sites} max={4} muted />
      <span style={{ fontSize: 10.5, fontStyle: 'italic', color: 'var(--muted)', whiteSpace: 'nowrap', paddingTop: 2 }}>
        first-come, not reservable
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Rename `WeekendRow`'s `nightCount` prop to `minNights`**

Prop name, destructuring, and all internal references (`show3Night`, `show2Night`, `show3NightOnly`, `show1Night` conditions); the call site already passes `minNights` as the value. Delete the now-unused `siteListText()`.

- [ ] **Step 7: Verify**

`npm run typecheck` passes; panel shows fees, chips, tier rows in preview.

---

### Task 5: Delete the marker `<Popup>`

**Files:**
- Modify: `web/app/map/LeafletMap.tsx:147-151` (and the `Popup` import if unused elsewhere — the Search-location `CircleMarker` popup at line 109 stays)

- [ ] **Step 1: Remove the `<Popup>…</Popup>` block from the park `Marker`** (the `<Tooltip>` stays)

- [ ] **Step 2: Verify** — clicking a pin opens only the panel; no white popup appears; hover tooltip still works.

---

### Task 6: Delete the dead site-filters shim

**Files:**
- Delete: `web/lib/site-filters.ts` (zero importers, verified by grep)

- [ ] **Step 1: `rm web/lib/site-filters.ts`**
- [ ] **Step 2: `npm run typecheck`** — expected: clean

---

### Task 7: Full verification + spec checkboxes

- [ ] **Step 1: `npm run typecheck`** — clean
- [ ] **Step 2: `npm test`** — 401 passing (396 + 5 new)
- [ ] **Step 3: Live walkthrough** (port 3002): McArthur-Burney (fee + chips + tier rows), a Rec.gov long-name park (chip truncation + expand/collapse), walk-up quarantine line, no popup on pin click, console clean.
- [ ] **Step 4: Update the P3 section** of `docs/superpowers/specs/2026-06-09-map-view-improvements.md` (design-approved notes + check off shipped items)
- [ ] **Step 5: Remind the user**: commit staged P2.5 first, then stage + commit P3.
