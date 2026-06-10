# Map Pin Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GitHub-hosted PNG map pins with theme-token-driven SVG divIcons that encode availability (fill) + park type (glyph), add count badges, a collapsible legend, and marker clustering, backed by a summary API that returns per-park match counts.

**Architecture:** A pure, Leaflet-free pin-HTML builder (`web/lib/map-pins.ts`) emits SVG strings whose colors are CSS custom properties — `L.divIcon` HTML lives in the page DOM so tokens resolve natively. The summary query gains `GROUP BY` counts (bookable + walk-up per facility); MapClient aggregates facility counts per parent park. Clustering uses `leaflet.markercluster` behind a ~30-line `createPathComponent` wrapper (react-leaflet 5 has no maintained plugin).

**Tech Stack:** TypeScript (strict), Next 15 / React 19 / react-leaflet 5 / leaflet 1.9, `leaflet.markercluster`, Postgres via `postgres` client, Vitest.

**Spec:** [docs/superpowers/specs/2026-06-09-map-pin-redesign-design.md](../specs/2026-06-09-map-pin-redesign-design.md)

**Conventions that apply to every task** (from CLAUDE.md): TypeScript strict, no `any` (prefer `unknown` + narrowing); kebab-case files; early returns; no unnecessary comments; run `npm run typecheck` after every meaningful change. Tests live in `test/` at the repo root and import source via relative paths with `.js` extensions (see `test/regions.test.ts` for the pattern). Run a single test file with `npx vitest run test/<file>.test.ts`.

---

### Task 1: Pure pin builder module (`web/lib/map-pins.ts`)

Everything here is a pure string builder — no React, no Leaflet — so it is unit-testable in node without a DOM.

**Files:**
- Create: `web/lib/map-pins.ts`
- Test: `test/map-pins.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/map-pins.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildPinHtml,
  buildClusterHtml,
  buildLegendSwatchHtml,
  formatCount,
  getParkType,
  GLYPHS,
  PIN_LEGEND,
} from '../web/lib/map-pins.js';

describe('getParkType', () => {
  it('maps california-parks to state', () => {
    expect(getParkType('california-parks')).toBe('state');
  });
  it('maps every other provider to federal', () => {
    expect(getParkType('recreation-gov')).toBe('federal');
    expect(getParkType('anything-else')).toBe('federal');
  });
});

describe('formatCount', () => {
  it('passes small counts through', () => {
    expect(formatCount(12)).toBe('12');
  });
  it('caps at 99+', () => {
    expect(formatCount(100)).toBe('99+');
    expect(formatCount(99)).toBe('99');
  });
});

describe('buildPinHtml', () => {
  it('uses the CA outline glyph for state parks', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'match' });
    expect(html).toContain(GLYPHS.state);
    expect(html).not.toContain(GLYPHS.federal);
  });

  it('uses the star glyph for federal parks', () => {
    const html = buildPinHtml({ parkType: 'federal', availability: 'match' });
    expect(html).toContain(GLYPHS.federal);
    expect(html).not.toContain(GLYPHS.state);
  });

  it('fills match pins with the accent token and a white glyph', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'match' });
    expect(html).toContain('fill="var(--accent)"');
    expect(html).toContain('fill="#ffffff"');
  });

  it('fills walk-up pins with the warn token', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'walk-up' });
    expect(html).toContain('fill="var(--warn)"');
  });

  it('renders no-match pins hollow with a muted glyph', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'none' });
    expect(html).toContain('fill="var(--surface-2)"');
    expect(html).toContain('fill="var(--muted)"');
    expect(html).toContain('opacity:0.8');
  });

  it('shows a count badge on match pins', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'match', count: 12 });
    expect(html).toContain('cb-badge');
    expect(html).toContain('>12<');
  });

  it('shows a warn-colored badge on walk-up pins', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'walk-up', count: 3 });
    expect(html).toContain('cb-badge');
    expect(html).toContain('border:1.5px solid var(--warn)');
  });

  it('hides the badge on no-match pins even when a count is passed', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'none', count: 5 });
    expect(html).not.toContain('cb-badge');
  });

  it('hides the badge when count is 0 or undefined', () => {
    expect(buildPinHtml({ parkType: 'state', availability: 'match', count: 0 })).not.toContain('cb-badge');
    expect(buildPinHtml({ parkType: 'state', availability: 'match' })).not.toContain('cb-badge');
  });

  it('caps the badge display at 99+', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'match', count: 150 });
    expect(html).toContain('>99+<');
  });

  it('draws the selection ring only when selected', () => {
    const selected = buildPinHtml({ parkType: 'state', availability: 'match', selected: true });
    const normal = buildPinHtml({ parkType: 'state', availability: 'match' });
    expect(selected).toContain('<circle');
    expect(selected).toContain('stroke="var(--warn)"');
    expect(normal).not.toContain('<circle');
  });

  it('sets role and an escaped aria-label from label', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'match', label: 'Tomales "Bay" SP' });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Tomales &quot;Bay&quot; SP"');
  });
});

describe('buildClusterHtml', () => {
  it('shows the park count', () => {
    expect(buildClusterHtml(17, false)).toContain('>17<');
  });
  it('adds the green dot only when a clustered park has matches', () => {
    expect(buildClusterHtml(5, true)).toContain('cb-cluster-dot');
    expect(buildClusterHtml(5, false)).not.toContain('cb-cluster-dot');
  });
});

describe('PIN_LEGEND', () => {
  it('has exactly the five spec entries in order', () => {
    expect(PIN_LEGEND.map((e) => e.label)).toEqual([
      'Sites available',
      'Walk-up only',
      'No availability',
      'CA State Park',
      'Federal · Recreation.gov',
    ]);
  });
  it('marks only the no-availability row as filter-conditional', () => {
    expect(PIN_LEGEND.filter((e) => e.onlyWhenFiltered).map((e) => e.label)).toEqual(['No availability']);
  });
  it('builds a swatch for every legend kind', () => {
    for (const entry of PIN_LEGEND) {
      expect(buildLegendSwatchHtml(entry.kind)).toContain('<');
    }
  });
  it('uses the real glyph paths in the type swatches', () => {
    expect(buildLegendSwatchHtml('glyph-state')).toContain(GLYPHS.state);
    expect(buildLegendSwatchHtml('glyph-federal')).toContain(GLYPHS.federal);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/map-pins.test.ts`
Expected: FAIL — `Cannot find module '../web/lib/map-pins.js'`

- [ ] **Step 3: Implement `web/lib/map-pins.ts`**

```typescript
// Pure pin/legend HTML builders for the /map markers. No React, no Leaflet —
// colors are CSS custom properties that resolve once the HTML is in the DOM.

export type ParkType = 'state' | 'federal';
export type PinAvailability = 'match' | 'none' | 'walk-up';

export interface PinOptions {
  parkType: ParkType;
  availability: PinAvailability;
  count?: number;
  selected?: boolean;
  label?: string;
}

export function getParkType(provider: string): ParkType {
  return provider === 'california-parks' ? 'state' : 'federal';
}

const TEARDROP =
  'M12.5 0C5.6 0 0 5.6 0 12.5 0 21.9 12.5 41 12.5 41s12.5-19.1 12.5-28.5C25 5.6 19.4 0 12.5 0z';

export const GLYPHS: Record<ParkType, string> = {
  state: 'M8 5 h6 v6.2 l4.8 5.6 v2.7 h-5.6 L8.2 11.5 z',
  federal:
    'M12.5 5.2 l2.1 4.3 4.7.7 -3.4 3.3 .8 4.7 -4.2-2.2 -4.2 2.2 .8-4.7 -3.4-3.3 4.7-.7 z',
};

const PIN_FILL: Record<PinAvailability, string> = {
  match: 'var(--accent)',
  'walk-up': 'var(--warn)',
  none: 'var(--surface-2)',
};

const GLYPH_FILL: Record<PinAvailability, string> = {
  match: '#ffffff',
  'walk-up': '#ffffff',
  none: 'var(--muted)',
};

// Rendered size; viewBox is the 25×41 teardrop padded by 4 on every side so the
// selection ring is not clipped. Tip of the teardrop maps to pixel (14, 42).
export const PIN_W = 28;
export const PIN_H = 46;
export const PIN_ANCHOR: [number, number] = [14, 42];
export const PIN_POPUP_ANCHOR: [number, number] = [0, -36];

export function formatCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function buildPinHtml(opts: PinOptions): string {
  const { parkType, availability, count, selected, label } = opts;

  const stroke = availability === 'none' ? 'var(--muted)' : 'rgba(47,58,46,0.25)';
  const opacity = availability === 'none' ? '0.8' : '1';
  const aria = label ? ` role="img" aria-label="${escapeAttr(label)}"` : '';

  const ring = selected
    ? `<circle cx="12.5" cy="12.5" r="11.5" fill="none" stroke="var(--warn)" stroke-width="2.5"/>`
    : '';

  const badgeColor = availability === 'walk-up' ? 'var(--warn)' : 'var(--accent)';
  const badge =
    count && availability !== 'none'
      ? `<span class="cb-badge" style="position:absolute;top:-6px;right:-9px;background:var(--surface);color:${badgeColor};border:1.5px solid ${badgeColor};border-radius:9px;font-size:10px;font-weight:700;line-height:15px;padding:0 5px;white-space:nowrap;">${formatCount(count)}</span>`
      : '';

  return (
    `<div class="cb-pin cb-pin--${availability}"${aria} style="position:relative;width:${PIN_W}px;height:${PIN_H}px;opacity:${opacity};">` +
    `<svg width="${PIN_W}" height="${PIN_H}" viewBox="-4 -4 33 49" xmlns="http://www.w3.org/2000/svg">` +
    ring +
    `<path d="${TEARDROP}" fill="${PIN_FILL[availability]}" stroke="${stroke}" stroke-width="1"/>` +
    `<path d="${GLYPHS[parkType]}" fill="${GLYPH_FILL[availability]}"/>` +
    `</svg>${badge}</div>`
  );
}

export function buildClusterHtml(count: number, hasMatch: boolean): string {
  const dot = hasMatch
    ? `<span class="cb-cluster-dot" style="position:absolute;top:-2px;right:-2px;width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid var(--surface);"></span>`
    : '';
  return (
    `<div class="cb-cluster" style="position:relative;width:36px;height:36px;border-radius:50%;background:var(--surface);border:2px solid var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:var(--text);box-shadow:var(--shadow-sm);">` +
    `<span>${count}</span>${dot}</div>`
  );
}

export type LegendKind = 'pin-match' | 'pin-walkup' | 'pin-none' | 'glyph-state' | 'glyph-federal';

export interface LegendEntry {
  kind: LegendKind;
  label: string;
  onlyWhenFiltered?: boolean;
}

export const PIN_LEGEND: LegendEntry[] = [
  { kind: 'pin-match', label: 'Sites available' },
  { kind: 'pin-walkup', label: 'Walk-up only' },
  { kind: 'pin-none', label: 'No availability', onlyWhenFiltered: true },
  { kind: 'glyph-state', label: 'CA State Park' },
  { kind: 'glyph-federal', label: 'Federal · Recreation.gov' },
];

export function buildLegendSwatchHtml(kind: LegendKind): string {
  if (kind === 'glyph-state' || kind === 'glyph-federal') {
    const type: ParkType = kind === 'glyph-state' ? 'state' : 'federal';
    return `<svg width="12" height="12" viewBox="4 3 17 17" xmlns="http://www.w3.org/2000/svg"><path d="${GLYPHS[type]}" fill="var(--accent)"/></svg>`;
  }
  const availability: PinAvailability =
    kind === 'pin-match' ? 'match' : kind === 'pin-walkup' ? 'walk-up' : 'none';
  const border = availability === 'none' ? 'var(--muted)' : 'transparent';
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${PIN_FILL[availability]};border:1px solid ${border};"></span>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/map-pins.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean

```bash
git add web/lib/map-pins.ts test/map-pins.test.ts
git commit -m "feat(map): add token-driven pin/legend HTML builders"
```

---

### Task 2: Availability counts query (`src/cache/availability-cache.ts`)

Replaces `getParksWithAvailability` (returns `string[]` of facility page IDs) with `getParkAvailabilityCounts` (returns per-facility bookable + walk-up counts). The WHERE clauses are extracted into a pure, exported `buildAvailabilityClauses` so the filter logic is unit-testable without a database. Note: `exclude_walk_up` is intentionally absent from `FILTER_SQL` (today the walk-up exclusion is a hardcoded base clause); the new builder returns it as a flag instead.

**Files:**
- Modify: `src/cache/availability-cache.ts:356-408` (the `FILTER_SQL` + `getParksWithAvailability` block)
- Modify: `web/lib/availability-cache.ts:1,13` (barrel import/export lines)
- Test: `test/availability-clauses.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/availability-clauses.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildAvailabilityClauses } from '../src/cache/availability-cache.js';

describe('buildAvailabilityClauses', () => {
  it('always includes the status and current-date clauses', () => {
    const { clauses, params } = buildAvailabilityClauses();
    expect(clauses).toContain("a.status = 'available'");
    expect(clauses).toContain('a.date >= CURRENT_DATE');
    expect(params).toEqual([]);
  });

  it('adds from/to as ordered parameters', () => {
    const { clauses, params } = buildAvailabilityClauses('2026-07-01', '2026-07-14');
    expect(clauses).toContain('a.date >= $1');
    expect(clauses).toContain('a.date <= $2');
    expect(params).toEqual(['2026-07-01', '2026-07-14']);
  });

  it('adds the weekend arrival clause when weekendsOnly', () => {
    const { clauses } = buildAvailabilityClauses(null, null, [], true);
    expect(clauses).toContain('EXTRACT(DOW FROM a.date)::int IN (5, 6)');
  });

  it('translates exclude filters into NOT regex clauses', () => {
    const { clauses } = buildAvailabilityClauses(null, null, ['exclude_group']);
    expect(clauses.some((c) => c.startsWith('NOT (') && c.includes('group'))).toBe(true);
  });

  it('applies hike_in_only as a positive match', () => {
    const { clauses } = buildAvailabilityClauses(null, null, ['hike_in_only']);
    expect(clauses.some((c) => !c.startsWith('NOT') && c.includes('hike.in'))).toBe(true);
  });

  it('ignores unknown filter ids', () => {
    const base = buildAvailabilityClauses().clauses.length;
    expect(buildAvailabilityClauses(null, null, ['bogus']).clauses.length).toBe(base);
  });

  it('flags exclude_walk_up without adding a clause', () => {
    const base = buildAvailabilityClauses().clauses.length;
    const result = buildAvailabilityClauses(null, null, ['exclude_walk_up']);
    expect(result.excludeWalkUp).toBe(true);
    expect(result.clauses.length).toBe(base);
    expect(buildAvailabilityClauses().excludeWalkUp).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/availability-clauses.test.ts`
Expected: FAIL — `buildAvailabilityClauses` is not exported

- [ ] **Step 3: Implement the clause builder and counts query**

In `src/cache/availability-cache.ts`, keep `FILTER_SQL` as-is and replace the entire `getParksWithAvailability` function (lines 368–408) with:

```typescript
const WALK_UP_SQL = "s.site_name ~* 'hike *[/&]? *bike'";

export interface AvailabilityClauseResult {
  clauses: string[];
  params: string[];
  excludeWalkUp: boolean;
}

/** Pure WHERE-clause builder for the availability summary query (exported for tests). */
export function buildAvailabilityClauses(
  from?: string | null,
  to?: string | null,
  filterIds: string[] = [],
  weekendsOnly = false,
): AvailabilityClauseResult {
  const params: string[] = [];
  const clauses: string[] = ["a.status = 'available'", 'a.date >= CURRENT_DATE'];

  if (from) { clauses.push(`a.date >= $${params.length + 1}`); params.push(from); }
  if (to)   { clauses.push(`a.date <= $${params.length + 1}`); params.push(to); }

  // Weekends mode: only count Friday (5) or Saturday (6) arrivals. Sunday-only availability
  // means you can't arrive for a Fri-Sun or Sat-Sun stay, so it shouldn't light up the pin.
  if (weekendsOnly) clauses.push('EXTRACT(DOW FROM a.date)::int IN (5, 6)');

  let excludeWalkUp = false;
  for (const id of filterIds) {
    if (id === 'exclude_walk_up') { excludeWalkUp = true; continue; }
    const f = FILTER_SQL[id];
    if (!f) continue;
    const col = `(s.site_name || ' ' || s.campground_name) ~* '${f.pattern}'`;
    clauses.push(f.exclude ? `NOT (${col})` : col);
  }

  return { clauses, params, excludeWalkUp };
}

export interface ParkAvailabilityCount {
  parkPageId: string;
  siteCount: number;
  walkUpCount: number;
}

/**
 * Per-facility availability counts in the given date range. siteCount is bookable
 * sites only (walk-up hike/bike sites never count as bookable); walkUpCount is the
 * matching walk-up sites, forced to 0 when the exclude_walk_up filter is active.
 * Facilities with neither are omitted. COUNT(DISTINCT) dedupes sites that appear
 * in multiple overlapping scan windows.
 */
export async function getParkAvailabilityCounts(
  from?: string | null,
  to?: string | null,
  filterIds: string[] = [],
  weekendsOnly = false,
): Promise<ParkAvailabilityCount[]> {
  const sql = getSql();
  const { clauses, params, excludeWalkUp } = buildAvailabilityClauses(from, to, filterIds, weekendsOnly);

  const bookable = `COUNT(DISTINCT s.site_id) FILTER (WHERE NOT (${WALK_UP_SQL}))`;
  const walkUp = excludeWalkUp ? '0' : `COUNT(DISTINCT s.site_id) FILTER (WHERE ${WALK_UP_SQL})`;

  const rows = await sql.unsafe<{ park_page_id: string; site_count: number; walk_up_count: number }[]>(`
    SELECT s.park_page_id,
           (${bookable})::int AS site_count,
           (${walkUp})::int AS walk_up_count
    FROM availability a
    JOIN sites s ON s.site_id = a.site_id
    WHERE ${clauses.join('\n      AND ')}
    GROUP BY s.park_page_id
    HAVING (${bookable}) > 0${excludeWalkUp ? '' : ` OR (${walkUp}) > 0`}
  `, params);

  return rows.map((r) => ({
    parkPageId: r.park_page_id,
    siteCount: Number(r.site_count),
    walkUpCount: Number(r.walk_up_count),
  }));
}
```

- [ ] **Step 4: Update the web barrel**

In `web/lib/availability-cache.ts`, replace `getParksWithAvailability` with `getParkAvailabilityCounts` in both the import (line 1) and the re-export (line 13), and re-export the type:

```typescript
export type { ParkAvailabilityCount } from '../../src/cache/availability-cache';
```

- [ ] **Step 5: Run tests — new file passes, and find the now-broken consumer**

Run: `npx vitest run test/availability-clauses.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: FAIL in `web/app/api/map/availability/summary/route.ts` (imports the removed `getParksWithAvailability`) — that is Task 3. Do not commit yet if the repo convention is green commits; fold Task 3's route change into this commit instead (next task's step 1 is tiny).

---

### Task 3: Summary route returns counts

**Files:**
- Modify: `web/app/api/map/availability/summary/route.ts`

- [ ] **Step 1: Update the route**

Replace the import and handler body:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getParkAvailabilityCounts } from '../../../../../lib/availability-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') ?? null;
  const to = searchParams.get('to') ?? null;
  const filtersParam = searchParams.get('filters') ?? '';
  const activeFilters = filtersParam ? filtersParam.split(',') : [];
  const weekendsOnly = searchParams.get('weekendsOnly') === 'true';

  const parks = await getParkAvailabilityCounts(from, to, activeFilters, weekendsOnly);
  return NextResponse.json({ parks });
}
```

- [ ] **Step 2: Typecheck — expect remaining failure in MapClient**

Run: `npm run typecheck`
Expected: FAIL only in `web/app/map/MapClient.tsx` (`data.parks` is no longer `string[]`). That is Task 4's job. To keep this commit green, do Task 4 Step 1 (MapClient data layer) before committing — Tasks 2–4 land as one commit because they change a single contract end-to-end:

(commit happens at the end of Task 4)

---

### Task 4: MapClient consumes counts and aggregates per park

The summary returns **facility-level** IDs. `MapPark.facilityPageIds` maps a parent-grouped Rec.gov park to its facilities (CA parks: `[parkPageId]`), so per-park counts are the sum over `facilityPageIds`. Keep the existing semantics: a park "matches" (for the `N match` readout and `filteredParks`) only when it has bookable sites.

**Files:**
- Modify: `web/app/map/MapClient.tsx` (state ~line 542, fetch effect ~553–572, `filteredParks` ~596–602, `matchingParkIds` memo ~620–628, reset handler ~689, `<LeafletMap …/>` props ~921)

- [ ] **Step 1: Replace the facility-ID set with a counts map**

Add near the top of the file (next to other type definitions):

```typescript
export interface ParkAvailabilitySummary {
  siteCount: number;
  walkUpCount: number;
}
```

Replace the state (line ~542):

```typescript
const [availByFacility, setAvailByFacility] = useState<Map<string, ParkAvailabilitySummary> | null>(null);
```

In the fetch effect, replace the guard, the `.then` chain, and nothing else (debounce and params stay):

```typescript
if (!availFrom && !availTo) {
  setAvailByFacility(null);
  return;
}
```

```typescript
fetch(`/api/map/availability/summary?${params.toString()}`)
  .then((r) => r.json() as Promise<{ parks: { parkPageId: string; siteCount: number; walkUpCount: number }[] }>)
  .then((data) => {
    setAvailByFacility(
      new Map(data.parks.map((p) => [p.parkPageId, { siteCount: p.siteCount, walkUpCount: p.walkUpCount }])),
    );
  })
  .catch(() => {})
  .finally(() => { setLoadingAvailability(false); });
```

- [ ] **Step 2: Aggregate per parent park and rewire dependents**

Replace the `filteredParks` date-range branch (~596–602):

```typescript
if (availByFacility !== null) {
  // availByFacility is keyed by facility-level IDs; a parent-grouped park matches
  // if any of its underlying facilities has bookable availability.
  result = result.filter((p) =>
    p.facilityPageIds.some((fid) => (availByFacility.get(fid)?.siteCount ?? 0) > 0)
  );
}
```

Replace the `hasOtherFilters` / `matchingParkIds` block (~620–628) with a per-park aggregate:

```typescript
// Per-park availability for pin rendering. null = no date filter active.
const availByPark = useMemo(() => {
  if (!availByFacility) return null;
  const byPark = new Map<string, ParkAvailabilitySummary>();
  for (const p of parks) {
    let siteCount = 0;
    let walkUpCount = 0;
    for (const fid of p.facilityPageIds) {
      const a = availByFacility.get(fid);
      if (!a) continue;
      siteCount += a.siteCount;
      walkUpCount += a.walkUpCount;
    }
    byPark.set(p.parkPageId, { siteCount, walkUpCount });
  }
  return byPark;
}, [parks, availByFacility]);
```

Update every other `parksInDateRange` reference: the `useEffect` dependency array stays the same; `handleResetFilters` sets `setAvailByFacility(null)`; the `hasActiveFilters` expression is unchanged.

- [ ] **Step 3: Pass the new prop to LeafletMap**

At the `<LeafletMap …/>` call (~line 921), replace `matchingParkIds={matchingParkIds}` with:

```tsx
availability={availByPark}
```

(This will not typecheck until Task 6 updates LeafletMap's props — Tasks 2–6 are sequential for that reason, but commit checkpoints keep each commit green. For THIS commit: temporarily keep `matchingParkIds` computed and passed as before **is not possible** since the set is gone — so this commit completes after Task 6's LeafletMap interface change. See Step 4.)

- [ ] **Step 4: Hold the commit**

Run: `npm run typecheck`
Expected: FAIL only on the `availability` prop not existing on LeafletMap's `Props`. Proceed to Task 5/6; the green-commit checkpoint is at the end of Task 6.

---

### Task 5: Leaflet-side icon factory, legend component, cluster wrapper

Three small client-side files, no integration yet (LeafletMap still compiles against its old imports until Task 6 — these are all new files, so nothing breaks).

**Files:**
- Create: `web/app/map/pin-icons.ts`
- Create: `web/app/map/MapLegend.tsx`
- Create: `web/app/map/MarkerClusterGroup.tsx`
- Modify: `web/package.json` (new deps)

- [ ] **Step 1: Install clustering dependencies**

```bash
cd web && npm install leaflet.markercluster && npm install -D @types/leaflet.markercluster && cd ..
```

Expected: both packages added to `web/package.json`.

- [ ] **Step 2: Create `web/app/map/pin-icons.ts`**

```typescript
import L from 'leaflet';
import {
  buildPinHtml,
  PIN_W,
  PIN_H,
  PIN_ANCHOR,
  PIN_POPUP_ANCHOR,
  type PinOptions,
} from '../../lib/map-pins';

const cache = new Map<string, L.DivIcon>();

export function makePinIcon(opts: PinOptions): L.DivIcon {
  const key = `${opts.parkType}|${opts.availability}|${opts.count ?? 0}|${opts.selected ? 1 : 0}|${opts.label ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const icon = L.divIcon({
    html: buildPinHtml(opts),
    className: '', // suppress Leaflet's default .leaflet-div-icon white box
    iconSize: [PIN_W, PIN_H],
    iconAnchor: PIN_ANCHOR,
    popupAnchor: PIN_POPUP_ANCHOR,
  });
  cache.set(key, icon);
  return icon;
}
```

- [ ] **Step 3: Create `web/app/map/MapLegend.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { PIN_LEGEND, buildLegendSwatchHtml } from '../../lib/map-pins';

export default function MapLegend({ dateFilterActive }: { dateFilterActive: boolean }) {
  const [open, setOpen] = useState(false);
  const entries = PIN_LEGEND.filter((e) => !e.onlyWhenFiltered || dateFilterActive);

  return (
    <div
      style={{ position: 'absolute', bottom: 24, left: 16, zIndex: 1000 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {open ? (
        <div
          style={{
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '8px 11px',
            WebkitBackdropFilter: 'blur(6px)',
            backdropFilter: 'blur(6px)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {entries.map((entry) => (
            <div
              key={entry.kind}
              style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}
            >
              <span
                style={{ display: 'inline-flex', flexShrink: 0 }}
                dangerouslySetInnerHTML={{ __html: buildLegendSwatchHtml(entry.kind) }}
              />
              <span style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap' }}>{entry.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: '4px 12px',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text)',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
            fontFamily: 'var(--font)',
          }}
        >
          ☰ Key
        </button>
      )}
    </div>
  );
}
```

(Hover opens on desktop; the `onClick` covers touch. `onMouseLeave` collapses it.)

- [ ] **Step 4: Create `web/app/map/MarkerClusterGroup.tsx`**

```tsx
'use client';

import { createPathComponent, type LeafletContextInterface } from '@react-leaflet/core';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import type { ReactNode } from 'react';
import { buildClusterHtml } from '../../lib/map-pins';

interface Props {
  children: ReactNode;
}

function createCluster(_props: Props, context: LeafletContextInterface) {
  const instance = L.markerClusterGroup({
    maxClusterRadius: 45,
    disableClusteringAtZoom: 9,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
    zoomToBoundsOnClick: true,
    iconCreateFunction: (cluster) => {
      const hasMatch = cluster.getAllChildMarkers().some((m) => {
        const icon = m.options.icon;
        return icon instanceof L.DivIcon && String(icon.options.html ?? '').includes('cb-pin--match');
      });
      return L.divIcon({
        html: buildClusterHtml(cluster.getChildCount(), hasMatch),
        className: '',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
    },
  });
  return { instance, context: { ...context, layerContainer: instance } };
}

const MarkerClusterGroup = createPathComponent<L.MarkerClusterGroup, Props>(createCluster);

export default MarkerClusterGroup;
```

(`@react-leaflet/core` is a dependency of react-leaflet 5; this is the standard cluster-wrapper pattern. The `iconCreateFunction` sniffs each child marker's divIcon HTML for the `cb-pin--match` class — that's the availability signal, with no custom marker options needed.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: same single pre-existing failure from Task 4 (LeafletMap `availability` prop), nothing new. If `L.markerClusterGroup` or `instanceof L.DivIcon` fail to typecheck, confirm `@types/leaflet.markercluster` installed into `web/node_modules` and that `web/tsconfig.json` picks it up (it augments the `leaflet` module globally — no config change should be needed).

---

### Task 6: Rewrite LeafletMap

Deletes the GitHub PNG icons, the unpkg default-icon hack, and the hardcoded legend; renders divIcon markers with tooltips inside the cluster group.

**Files:**
- Modify: `web/app/map/LeafletMap.tsx` (full rewrite, content below)

- [ ] **Step 1: Replace the file contents**

```tsx
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapPark } from '../api/map/catalog/route';
import { getParkType, type PinAvailability } from '../../lib/map-pins';
import { makePinIcon } from './pin-icons';
import MapLegend from './MapLegend';
import MarkerClusterGroup from './MarkerClusterGroup';

function FlyTo({ park }: { park: MapPark | null }) {
  const map = useMap();
  useEffect(() => {
    if (park?.latitude && park?.longitude) {
      map.flyTo([park.latitude, park.longitude], 12, { duration: 0.8 });
    }
  }, [map, park]);
  return null;
}

function FocusOnLocation({
  focusLocation,
  distanceMiles,
}: {
  focusLocation: { lat: number; lon: number } | null;
  distanceMiles: number | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!focusLocation) return;
    let zoom = 9;
    if (distanceMiles !== null) {
      if (distanceMiles <= 25) zoom = 10;
      else if (distanceMiles <= 50) zoom = 9;
      else if (distanceMiles <= 100) zoom = 8;
      else zoom = 7;
    }
    map.flyTo([focusLocation.lat, focusLocation.lon], zoom, { duration: 0.8 });
  }, [map, focusLocation, distanceMiles]);
  return null;
}

export interface ParkAvailabilitySummary {
  siteCount: number;
  walkUpCount: number;
}

interface Props {
  parks: MapPark[];
  selectedPark: MapPark | null;
  onSelectPark: (park: MapPark) => void;
  focusLocation?: { lat: number; lon: number } | null;
  distanceMiles?: number | null;
  availability?: Map<string, ParkAvailabilitySummary> | null;
}

export default function LeafletMap({
  parks,
  selectedPark,
  onSelectPark,
  focusLocation,
  distanceMiles,
  availability = null,
}: Props) {
  const withCoords = parks.filter((p) => p.latitude && p.longitude);

  // leaflet.markercluster doesn't recompute cluster icons when child marker icons
  // change, so remount the group when the availability data changes.
  const clusterVersion = useRef(0);
  const clusterKey = useMemo(() => String(++clusterVersion.current), [availability]);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer center={[37.5, -119.5]} zoom={6} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
        <FlyTo park={selectedPark} />
        <FocusOnLocation focusLocation={focusLocation ?? null} distanceMiles={distanceMiles ?? null} />
        {focusLocation && (
          <CircleMarker
            center={[focusLocation.lat, focusLocation.lon]}
            radius={8}
            color="#b3402f"
            fillColor="#b3402f"
            fillOpacity={0.8}
          >
            <Popup>Search location</Popup>
          </CircleMarker>
        )}
        <MarkerClusterGroup key={clusterKey}>
          {withCoords.map((park) => {
            const isSelected = selectedPark?.parkPageId === park.parkPageId;
            const summary = availability?.get(park.parkPageId);
            const state: PinAvailability = !availability
              ? 'match'
              : (summary?.siteCount ?? 0) > 0
                ? 'match'
                : (summary?.walkUpCount ?? 0) > 0
                  ? 'walk-up'
                  : 'none';
            const count = !availability
              ? undefined
              : state === 'match'
                ? summary?.siteCount
                : state === 'walk-up'
                  ? summary?.walkUpCount
                  : undefined;
            const parkType = getParkType(park.provider);

            return (
              <Marker
                key={park.parkPageId}
                position={[park.latitude!, park.longitude!]}
                icon={makePinIcon({ parkType, availability: state, count, selected: isSelected, label: park.parkName })}
                eventHandlers={{ click: () => onSelectPark(park) }}
              >
                <Tooltip direction="top" offset={[0, -42]}>
                  <strong>{park.parkName}</strong>
                  <br />
                  {parkType === 'state' ? 'CA State Park' : 'Federal · Recreation.gov'}
                  {availability && state === 'match' ? ` · ${count} site${count === 1 ? '' : 's'} open` : ''}
                  {availability && state === 'walk-up' ? ' · walk-up only' : ''}
                  {availability && state === 'none' ? ' · no availability' : ''}
                </Tooltip>
                <Popup>
                  <strong>{park.parkName}</strong>
                  <br />
                  {park.campgroundCount} campground{park.campgroundCount !== 1 ? 's' : ''} · {park.siteCount} sites
                </Popup>
              </Marker>
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>

      <MapLegend dateFilterActive={availability != null} />
    </div>
  );
}
```

Deleted relative to the old file: the `L.Icon.Default` unpkg hack, `BASE`/`SHADOW`/`makeIcon`, the `icons` record, the `LEGEND` array, `getParkCategory`/`ParkCategory`, the `matchingParkIds` prop, and the inline legend JSX. Note `MapPark.siteCount` (total sites, used in the Popup) is unrelated to the availability `siteCount`.

- [ ] **Step 2: Typecheck and test — everything green now**

Run: `npm run typecheck`
Expected: PASS (the Task 4 prop error is resolved)

Run: `npm test`
Expected: PASS (all suites, including the two new files)

- [ ] **Step 3: Commit the end-to-end contract change (Tasks 2–6)**

```bash
git add src/cache/availability-cache.ts web/lib/availability-cache.ts test/availability-clauses.test.ts \
  web/app/api/map/availability/summary/route.ts web/app/map/MapClient.tsx web/app/map/LeafletMap.tsx \
  web/app/map/pin-icons.ts web/app/map/MapLegend.tsx web/app/map/MarkerClusterGroup.tsx \
  web/package.json web/package-lock.json
git commit -m "feat(map): availability-first token-driven pins, counts API, legend pill, clustering"
```

---

### Task 7: Manual verification and backlog bookkeeping

**Files:**
- Modify: `docs/superpowers/specs/2026-06-09-map-view-improvements.md` (P2 section + one P1 checkbox)

- [ ] **Step 1: Run the app and verify against the spec**

```bash
docker compose up -d   # if Postgres isn't already running
npm run dev            # port 3001
```

Open `http://localhost:3001/map` and verify each of these with the default weekend date range active:

1. Pins are SVG (inspect: `div.cb-pin`), no requests to `raw.githubusercontent.com` or `unpkg.com` marker PNGs in the Network tab
2. Green pins = parks with bookable sites; each shows a count badge; hollow sand pins for no-match; any walk-up-only park shows a sunset pin
3. State parks show the CA-outline glyph; Rec.gov parks show the star
4. Clicking a pin adds the sunset ring and opens the detail panel; selecting a sold-out park keeps its hollow fill under the ring
5. Zoomed out, the NorCal coast clusters into count bubbles; bubbles with a green dot contain ≥1 matching park; clicking a cluster zooms in; at zoom ≥9 clustering is off
6. The "Key" pill sits bottom-left; hover/tap expands the 5-row legend; "No availability" row hidden when dates are cleared
7. Hovering a pin shows the tooltip: name, park type in words, count
8. Toggling "Exclude walk-up sites" makes sunset pins go hollow
9. Clearing both dates → all pins green without badges
10. No console errors, no hydration warnings; `EXPLAIN`-level sanity: summary response time comparable to before

11. Squint test: lean back — can you tell green from sand from sunset at arm's length?

- [ ] **Step 2: Confirm parity with the old matching behavior**

With dates set, the filter-bar readout ("N / M parks · K match") must show the same K as before the change for the same date range (the counts query keeps identical WHERE semantics). Spot-check one park's badge count against its detail panel site list for the same range.

- [ ] **Step 3: Check off the backlog items**

In `docs/superpowers/specs/2026-06-09-map-view-improvements.md`: under P1, check `- [x] Marker alt/title = park name` (shipped via aria-label + Tooltip); mark the P2 section header with `**Status: shipped — see 2026-06-09-map-pin-redesign-design.md**`.

- [ ] **Step 4: Final verification and commit**

Run: `npm run typecheck && npm test`
Expected: PASS

```bash
git add docs/superpowers/specs/2026-06-09-map-view-improvements.md
git commit -m "docs: mark map pin redesign (P2) shipped in map-view backlog"
```

After landing, hand reference-doc updates (`docs/reference/surfaces/map.md`, `design-system.md`, CLAUDE.md map section) to the **doc-steward** agent per project convention. Note for the steward: `docs/reference/design-system.md` still documents the pre-Naturalist dark theme tokens — it is stale beyond this feature's scope.

---

## Self-review notes

- **Spec coverage:** visual states (Task 1), legend pill (Task 5/6), tooltips + aria (Tasks 1, 6), counts API + walk-up + facility aggregation (Tasks 2–4), clustering (Task 5/6), deletions (Task 6), tests (Tasks 1–2), manual checks (Task 7). The spec's "no date filter → match pins without badges" is LeafletMap's `!availability` branch.
- **Known judgment calls:** Tasks 2–6 form one commit because they change a single API contract end-to-end; intermediate typecheck failures are called out at each checkpoint. Cluster icons don't auto-refresh on child icon change — handled by remounting the group via `clusterKey` (cheap at 141 markers, only on availability changes).
- **Type consistency check:** `ParkAvailabilitySummary` is declared in both `MapClient.tsx` and `LeafletMap.tsx` (LeafletMap is dynamically imported with `ssr: false`, so importing a type from it into MapClient is fine — but keeping both local copies identical avoids a fragile import through `next/dynamic`; they are structurally identical `{ siteCount, walkUpCount }`).
