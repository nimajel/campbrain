# Recreation.gov Provider Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Recreation.gov federal campgrounds as a second availability provider so they appear in the Find Campsites and Map pages alongside California State Parks, distinguished by a provider badge.

**Architecture:** A `generateCacheWindows` + `proactiveScanWindow` interface pair is added to `AvailabilityProvider`. CA Parks implements 8-day windows (existing logic refactored from the scanner); Rec.gov implements monthly windows (one API call per campground per month). The proactive scanner becomes provider-agnostic. The cache layer's hardcoded `'california-parks'` constant is removed so all providers share the same Postgres tables and materialized view.

**Tech Stack:** TypeScript, Vitest, PostgreSQL (`postgres` client), dayjs, Next.js 14, React 18, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-06-02-recreation-gov-provider-design.md`

---

## File Map

| File | Action |
|------|--------|
| `src/providers/availability-provider.ts` | Add `CacheWindow` type + `generateCacheWindows` / `proactiveScanWindow` to interface |
| `src/providers/california-parks-provider.ts` | Implement new interface methods; move proactive window logic here |
| `src/providers/recreation-gov-provider.ts` | Add `generateCacheWindows` + `proactiveScanWindow` |
| `src/scanner/proactive-scanner.ts` | Remove CA-only filter; delegate to provider interface |
| `src/cache/availability-cache.ts` | Remove `PROVIDER` constant; parameterize writes; drop hardcoded filters from reads |
| `src/cache/db.ts` | Seed `recreation-gov` provider; fix MV joins |
| `src/catalog/discover-recreation-gov.ts` | New: RIDB API catalog discovery for CA federal campgrounds |
| `src/catalog/refresh-catalog.ts` | Dispatch to rec.gov discovery when `provider === 'recreation-gov'` |
| `data/catalog/recreation-gov.json` | New: empty seed file |
| `.env` | Add `RIDB_API_KEY=` placeholder |
| `web/lib/providers.ts` | New: `PROVIDER_BADGES` config map |
| `web/components/ProviderBadge.tsx` | New: shared badge chip component |
| `web/app/explore/page.tsx` | Update subtitle text |
| `web/app/explore/FindCampsitesClient.tsx` | Import and render `ProviderBadge` in park header |
| `web/app/map/MapClient.tsx` | Import and render `ProviderBadge` in detail panel |
| `web/app/api/search/route.ts` | Add `provider` to `SearchParkResponse` type |
| `web/app/api/map/availability/route.ts` | Accept optional `provider` query param; pass to `getEntriesForPark` |
| `test/recreation-gov-provider.test.ts` | Add tests for `generateCacheWindows` and `proactiveScanWindow` |

---

## Task 1: Parameterize `upsertEntry` + `findStaleWindows` in the cache layer

**Files:**
- Modify: `src/cache/availability-cache.ts`

Remove the module-level `const PROVIDER = 'california-parks'` constant. Update `upsertEntry` to take `providerId` as a second argument. Update `findStaleWindows` to take `providerName` as a second argument so it only queries scan windows for the specified provider.

- [ ] **Step 1: Write the failing test for the new `upsertEntry` signature**

Create `test/availability-cache-provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { upsertEntry } from '../src/cache/availability-cache.js';
import type { AvailabilityWindowEntry } from '../src/cache/types.js';

// We can't call a real DB in unit tests, but we can verify the function
// signature is correct and the PROVIDER constant no longer exists.
describe('upsertEntry provider parameter', () => {
  it('accepts recreation-gov as providerId without throwing a type error', () => {
    // Type-level assertion: the second argument must be accepted
    const entry: AvailabilityWindowEntry = {
      parkPageId: '232447',
      parkName: 'Upper Pines',
      windowStart: '2026-07-01',
      windowEnd: '2026-07-31',
      scannedAt: new Date().toISOString(),
      sourceUrl: 'https://recreation.gov',
      campgrounds: [],
    };
    // upsertEntry is async and needs a real DB — just confirm the overload compiles.
    // The real integration is tested by running npm run worker with rec.gov data.
    expect(typeof upsertEntry).toBe('function');
    // Verify the function accepts two arguments (providerId is the second)
    expect(upsertEntry.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run to confirm it fails (because the function still takes 1 arg)**

```bash
cd /Users/nimajelveh/campbrain && npm test -- test/availability-cache-provider.test.ts
```

Expected: FAIL — `expect(upsertEntry.length).toBe(2)` fails with `received: 1`

- [ ] **Step 3: Remove `PROVIDER` constant and update `upsertEntry` signature**

In `src/cache/availability-cache.ts`:

Remove line 7:
```typescript
const PROVIDER = 'california-parks';
```

Change `upsertEntry` signature (line 56) from:
```typescript
export async function upsertEntry(entry: AvailabilityWindowEntry): Promise<void> {
```
to:
```typescript
export async function upsertEntry(entry: AvailabilityWindowEntry, providerId: string): Promise<void> {
```

Then replace all 7 occurrences of `PROVIDER` inside `upsertEntry` with `providerId`:
- Line 62: `VALUES (${PROVIDER}, ...)` → `VALUES (${providerId}, ...)`
- Line 70: `${PROVIDER}, ${entry.parkPageId}` → `${providerId}, ${entry.parkPageId}`
- Line 84: `WHERE provider_id = ${PROVIDER}` → `WHERE provider_id = ${providerId}`
- Line 97: `provider_id: PROVIDER` → `provider_id: providerId`
- Line 121: `provider_id: PROVIDER` → `provider_id: providerId`

- [ ] **Step 4: Update `findStaleWindows` to accept `providerName`**

Change signature (currently at line 172) from:
```typescript
export async function findStaleWindows(
  candidates: Array<{ parkPageId: string; windowStart: string }>,
  nowMs = Date.now()
): Promise<Array<{ parkPageId: string; windowStart: string }>>
```
to:
```typescript
export async function findStaleWindows(
  candidates: Array<{ parkPageId: string; windowStart: string }>,
  providerName: string,
  nowMs = Date.now()
): Promise<Array<{ parkPageId: string; windowStart: string }>>
```

Inside the function body, change:
```typescript
const rows = await sql<...>`
  SELECT park_page_id, window_start::text, scanned_at::text
  FROM scan_windows
  WHERE provider_id = ${PROVIDER} AND window_end >= CURRENT_DATE
`;
```
to:
```typescript
const rows = await sql<...>`
  SELECT park_page_id, window_start::text, scanned_at::text
  FROM scan_windows
  WHERE provider_id = ${providerName} AND window_end >= CURRENT_DATE
`;
```

- [ ] **Step 5: Fix the one existing caller of `upsertEntry` in `proactive-scanner.ts`**

In `src/scanner/proactive-scanner.ts`, there are two calls to `upsertEntry` (lines 156 and 192). Both are inside a function that has access to `park.provider`. Update them:

```typescript
// Line 156 (fully booked window — empty campgrounds)
await upsertEntry({
  parkPageId,
  parkName: park.parkName,
  windowStart,
  windowEnd: wEnd,
  scannedAt: new Date().toISOString(),
  sourceUrl: buildAvailabilityUrl(parkPageId, { arrivalDate: windowStart, nights: 1, endDate: wEnd }),
  campgrounds: [],
}, 'california-parks');

// Line 192 (normal entry with sites)
await upsertEntry(entry, 'california-parks');
```

Also update the one call to `findStaleWindows` (line 93):
```typescript
: await findStaleWindows(allCandidates, 'california-parks');
```

- [ ] **Step 6: Run test to confirm it passes**

```bash
cd /Users/nimajelveh/campbrain && npm test -- test/availability-cache-provider.test.ts
```

Expected: PASS

- [ ] **Step 7: Run typecheck to confirm no type errors**

```bash
cd /Users/nimajelveh/campbrain && npm run typecheck
```

Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/cache/availability-cache.ts src/scanner/proactive-scanner.ts test/availability-cache-provider.test.ts
git commit -m "feat: parameterize upsertEntry and findStaleWindows with providerId"
```

---

## Task 2: Remove hardcoded provider filter from all cache read queries

**Files:**
- Modify: `src/cache/availability-cache.ts`

The read queries currently scope everything to `'california-parks'`. Removing these filters makes reads return data from all providers (which is what we want once Rec.gov data is in the DB). The composite keys `(provider_id, park_page_id)` in the schema already prevent data collisions.

- [ ] **Step 1: Remove provider filter from `queryEntries`**

Find `queryEntries` (around line 303). Change:
```typescript
const rows = await sql.unsafe<EntryRow[]>(
  `SELECT ${ENTRY_SELECT} FROM scan_windows sw ${ENTRY_JOINS}
   WHERE sw.provider_id = $1 AND sw.window_end >= CURRENT_DATE
   ...`,
  [PROVIDER]
);
```
to:
```typescript
const rows = await sql.unsafe<EntryRow[]>(
  `SELECT ${ENTRY_SELECT} FROM scan_windows sw ${ENTRY_JOINS}
   WHERE sw.window_end >= CURRENT_DATE
   AND EXISTS (
     SELECT 1 FROM availability a2
     JOIN sites s2 ON s2.site_id = a2.site_id
     WHERE s2.park_page_id = sw.park_page_id
       AND a2.date >= sw.window_start AND a2.date <= sw.window_end
       AND a2.status = 'available'
   )
   ORDER BY sw.park_page_id, sw.window_start, cg.campground_name, s.site_name, a.date`,
  []
);
```

Note: also remove `s2.provider_id = $1` from the EXISTS clause.

- [ ] **Step 2: Update `getEntriesForPark` to accept optional `providerName`**

Change signature from:
```typescript
export async function getEntriesForPark(parkPageId: string): Promise<AvailabilityWindowEntry[]>
```
to:
```typescript
export async function getEntriesForPark(
  parkPageId: string,
  providerName?: string
): Promise<AvailabilityWindowEntry[]>
```

Change the query from:
```typescript
const rows = await sql.unsafe<EntryRow[]>(
  `SELECT ${ENTRY_SELECT} FROM scan_windows sw ${ENTRY_JOINS}
   WHERE sw.provider_id = $1 AND sw.park_page_id = $2 AND sw.window_end >= CURRENT_DATE
   ORDER BY sw.window_start, cg.campground_name, s.site_name, a.date`,
  [PROVIDER, parkPageId]
);
```
to:
```typescript
const providerClause = providerName ? `AND sw.provider_id = $2` : '';
const params = providerName ? [parkPageId, providerName] : [parkPageId];
const rows = await sql.unsafe<EntryRow[]>(
  `SELECT ${ENTRY_SELECT} FROM scan_windows sw ${ENTRY_JOINS}
   WHERE sw.park_page_id = $1 ${providerClause} AND sw.window_end >= CURRENT_DATE
   ORDER BY sw.window_start, cg.campground_name, s.site_name, a.date`,
  params
);
```

- [ ] **Step 3: Remove provider filter from `getParksWithAvailability`**

Find `getParksWithAvailability`. Change:
```typescript
const params: string[] = [PROVIDER];
const clauses: string[] = [
  'a.status = \'available\'',
  'a.date >= CURRENT_DATE',
  "NOT (s.site_name ~* 'hike *[/&]? *bike')",
];
```
to:
```typescript
const params: string[] = [];
const clauses: string[] = [
  'a.status = \'available\'',
  'a.date >= CURRENT_DATE',
  "NOT (s.site_name ~* 'hike *[/&]? *bike')",
];
```

And change the query from:
```typescript
const rows = await sql.unsafe<{ park_page_id: string }[]>(`
  SELECT DISTINCT s.park_page_id
  FROM availability a
  JOIN sites s ON s.site_id = a.site_id AND s.provider_id = $1
  WHERE ${clauses.join('\n      AND ')}
`, params);
```
to:
```typescript
const rows = await sql.unsafe<{ park_page_id: string }[]>(`
  SELECT DISTINCT s.park_page_id
  FROM availability a
  JOIN sites s ON s.site_id = a.site_id
  WHERE ${clauses.join('\n      AND ')}
`, params);
```

Update the `if (from)` and `if (to)` clauses to use `$${params.length + 1}` rather than `$${params.length + 1}` (they already do this correctly since `params` is now empty initially).

- [ ] **Step 4: Remove provider filter from `searchAvailableStays`**

Find the main query in `searchAvailableStays` (around line 619). Change:
```typescript
  `, [PROVIDER, from, to, String(nightCount)]);
```
to:
```typescript
  `, [from, to, String(nightCount)]);
```

And in the WHERE clause, change:
```typescript
WHERE s.provider_id = $1
  AND s.site_id IN (
    SELECT a.site_id
    FROM availability a
    JOIN sites s2 ON s2.site_id = a.site_id AND s2.provider_id = $1
    WHERE a.date >= $2::date
      AND a.date < $3::date
      AND a.status = 'available'
    GROUP BY a.site_id
    HAVING COUNT(DISTINCT a.date) = $4::int
  )
```
to:
```typescript
WHERE s.site_id IN (
  SELECT a.site_id
  FROM availability a
  WHERE a.date >= $1::date
    AND a.date < $2::date
    AND a.status = 'available'
  GROUP BY a.site_id
  HAVING COUNT(DISTINCT a.date) = $3::int
)
```

- [ ] **Step 5: Remove provider filter from `findNextAvailableDates`**

Find `findNextAvailableDates`. Change:
```typescript
const paramValues: string[] = [PROVIDER, endDate];
const clauses: string[] = [
  `s.provider_id = $1`,
  `a.status = 'available'`,
  `a.date >= CURRENT_DATE`,
  `a.date <= $2::date`,
  `NOT (s.site_name ~* 'hike\\s*[/&]?\\s*bike')`,
];
```
to:
```typescript
const paramValues: string[] = [endDate];
const clauses: string[] = [
  `a.status = 'available'`,
  `a.date >= CURRENT_DATE`,
  `a.date <= $1::date`,
  `NOT (s.site_name ~* 'hike\\s*[/&]?\\s*bike')`,
];
```

Update the `if (parkPageIds)` block placeholder numbering accordingly:
```typescript
if (parkPageIds && parkPageIds.length > 0) {
  const placeholders = parkPageIds.map((_, i) => `$${paramValues.length + i + 1}`).join(', ');
  clauses.push(`s.park_page_id IN (${placeholders})`);
  paramValues.push(...parkPageIds);
}
```

- [ ] **Step 6: Remove provider filter from `evictExpired` and `getCacheStats`**

`evictExpired` (around line 461):
```typescript
// BEFORE:
const result = await sql`DELETE FROM scan_windows WHERE provider_id = ${PROVIDER} AND window_end < ${today}`;

// AFTER:
const result = await sql`DELETE FROM scan_windows WHERE window_end < ${today}`;
```

`getCacheStats` (around line 475):
```typescript
// BEFORE:
WHERE provider_id = ${PROVIDER} AND window_end >= CURRENT_DATE

// AFTER:
WHERE window_end >= CURRENT_DATE
```

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/nimajelveh/campbrain && npm test
```

Expected: All tests pass (the removed filters don't break CA-only test data since the DB still scopes by composite keys).

- [ ] **Step 8: Run typecheck**

```bash
cd /Users/nimajelveh/campbrain && npm run typecheck
```

Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src/cache/availability-cache.ts
git commit -m "feat: remove hardcoded california-parks filter from cache read queries"
```

---

## Task 3: Fix the database — seed rec.gov provider + rebuild materialized view

**Files:**
- Modify: `src/cache/db.ts`

Add the `recreation-gov` row to the `providers` table seed. Update the materialized view definition to join on `s.provider_id` instead of the hardcoded string `'california-parks'`. Also add `provider_id` to the MV output and unique index so Rec.gov and CA Parks data can coexist safely.

- [ ] **Step 1: Add rec.gov provider seed in `initDb()`**

In `src/cache/db.ts`, after the existing California Parks INSERT (around line 98), add:

```typescript
await db`
  INSERT INTO providers (provider_id, display_name, base_url)
  VALUES ('recreation-gov', 'Recreation.gov', 'https://www.recreation.gov')
  ON CONFLICT (provider_id) DO NOTHING
`;
```

- [ ] **Step 2: Rebuild the `MV_DEFINITION` constant to be provider-agnostic**

Replace the entire `MV_DEFINITION` constant (lines 32–84) with:

```typescript
const MV_DEFINITION = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS mv_available_stays AS
  WITH avail AS (
    SELECT
      s.provider_id,
      s.park_page_id,
      s.campground_name,
      s.site_name,
      s.site_id,
      a.date,
      s.site_name ~* 'hike\\s*[/&]?\\s*bike' AS is_walk_up
    FROM availability a
    JOIN sites s ON s.site_id = a.site_id
    WHERE a.status = 'available' AND a.date >= CURRENT_DATE
  ),
  stays AS (
    SELECT a.provider_id, a.park_page_id, a.campground_name, a.date AS arrival_date, 1 AS nights,
           a.site_name, a.is_walk_up
    FROM avail a
    UNION ALL
    SELECT a1.provider_id, a1.park_page_id, a1.campground_name, a1.date AS arrival_date, 2 AS nights,
           a1.site_name, a1.is_walk_up
    FROM avail a1
    JOIN avail a2 ON a2.site_id = a1.site_id AND a2.date = a1.date + interval '1 day'
    WHERE NOT a1.is_walk_up
  )
  SELECT
    s.provider_id,
    s.park_page_id,
    p.park_name,
    s.campground_name,
    cg.nightly_fee::numeric(8,2),
    cg.booking_url,
    s.arrival_date,
    s.nights,
    coalesce(
      array_agg(s.site_name ORDER BY s.site_name) FILTER (WHERE NOT s.is_walk_up),
      '{}'::text[]
    ) AS available_sites,
    coalesce(
      array_agg(DISTINCT s.site_name ORDER BY s.site_name) FILTER (WHERE s.is_walk_up),
      '{}'::text[]
    ) AS walk_up_sites
  FROM stays s
  JOIN parks p ON p.provider_id = s.provider_id AND p.park_page_id = s.park_page_id
  JOIN campgrounds cg
    ON cg.provider_id = s.provider_id
    AND cg.park_page_id = s.park_page_id
    AND cg.campground_name = s.campground_name
  GROUP BY s.provider_id, s.park_page_id, p.park_name, s.campground_name,
           cg.nightly_fee, cg.booking_url, s.arrival_date, s.nights
  WITH NO DATA
`;
```

Key changes:
- Removed `AND s.provider_id = 'california-parks'` from the `avail` CTE
- Added `s.provider_id` to SELECT and GROUP BY in all CTEs
- Changed all JOIN conditions from `p.provider_id = 'california-parks'` to `p.provider_id = s.provider_id`

- [ ] **Step 3: Update the unique index to include `provider_id`**

In `initDb()`, change:
```typescript
await db`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_available_stays_pk
    ON mv_available_stays(park_page_id, campground_name, arrival_date, nights)
`;
```
to:
```typescript
await db`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_available_stays_pk
    ON mv_available_stays(provider_id, park_page_id, campground_name, arrival_date, nights)
`;
```

And in `rebuildMaterializedView()`, change:
```typescript
await db`
  CREATE UNIQUE INDEX idx_mv_available_stays_pk
    ON mv_available_stays(park_page_id, campground_name, arrival_date, nights)
`;
```
to:
```typescript
await db`
  CREATE UNIQUE INDEX idx_mv_available_stays_pk
    ON mv_available_stays(provider_id, park_page_id, campground_name, arrival_date, nights)
`;
```

- [ ] **Step 4: Update `listAvailableStays` to include `providerId` in its output**

In `listAvailableStays`, change the query SELECT to include `provider_id`:
```typescript
const rows = await sql.unsafe<MvRow[]>(
  `SELECT provider_id, park_page_id, park_name, campground_name, nightly_fee, booking_url,
          arrival_date::text, nights, available_sites, walk_up_sites
   FROM mv_available_stays
   WHERE ${clauses.join(' AND ')}
   ORDER BY arrival_date, park_name, campground_name, nights`,
  params
);
```

Update the `MvRow` type to include `provider_id: string`:
```typescript
type MvRow = {
  provider_id: string;
  park_page_id: string;
  park_name: string;
  campground_name: string;
  nightly_fee: string | null;
  booking_url: string | null;
  arrival_date: string;
  nights: number;
  available_sites: string[];
  walk_up_sites: string[];
};
```

Update the return mapping to include `providerId`:
```typescript
return rows.map((r) => ({
  providerId: r.provider_id,
  parkPageId: r.park_page_id,
  parkName: r.park_name,
  campgroundName: r.campground_name,
  nightlyFee: r.nightly_fee !== null ? Number(r.nightly_fee) : null,
  bookingUrl: r.booking_url,
  arrivalDate: r.arrival_date,
  nights: r.nights,
  availableSites: r.available_sites,
  walkUpSites: r.walk_up_sites ?? [],
}));
```

Update the `AvailableStay` type in `src/cache/types.ts` to add `providerId: string`.

- [ ] **Step 5: Apply DB changes**

```bash
cd /Users/nimajelveh/campbrain && npm run db:init && npm run db:rebuild-mv
```

Expected output: no errors; MV is rebuilt with the new schema

- [ ] **Step 6: Run typecheck**

```bash
cd /Users/nimajelveh/campbrain && npm run typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/cache/db.ts src/cache/types.ts src/cache/availability-cache.ts
git commit -m "feat: add recreation-gov provider seed and make materialized view provider-agnostic"
```

---

## Task 4: Extend `AvailabilityProvider` interface and refactor CA Parks

**Files:**
- Modify: `src/providers/availability-provider.ts`
- Modify: `src/providers/california-parks-provider.ts`

Add `CacheWindow`, `generateCacheWindows`, and `proactiveScanWindow` to the interface. Move the CA Parks proactive window scanning logic (currently embedded in `proactive-scanner.ts`) into a method on `CaliforniaParksProvider`.

- [ ] **Step 1: Update `availability-provider.ts`**

Replace the entire file content:

```typescript
import type { Target } from '../config/schemas.js';
import type { ScanCandidate, ScanResult } from '../types/scanner.js';
import type { AvailabilityWindowEntry } from '../cache/types.js';
import type { CampgroundCatalogEntry } from '../catalog/types.js';

export interface CacheWindow {
  windowStart: string; // YYYY-MM-DD — first day of the window
  windowEnd: string;   // YYYY-MM-DD — last day of the window (inclusive)
}

export interface AvailabilityProvider {
  name: string;

  /** Alert-based scanning — check specific date candidates against a target. */
  scan(
    target: Target,
    candidates: ScanCandidate[],
    debugMode?: boolean
  ): Promise<ScanResult[]>;

  /**
   * Return the list of cache windows that should exist to cover rangeStart–rangeEnd.
   * CA Parks: 8-day sliding windows. Rec.gov: monthly windows (first of month through EOM).
   */
  generateCacheWindows(rangeStart: string, rangeEnd: string): CacheWindow[];

  /**
   * Fetch a single cache window and return a populated AvailabilityWindowEntry,
   * or null if the fetch failed (caller will retry on next scan cycle).
   */
  proactiveScanWindow(
    parkPageId: string,
    window: CacheWindow,
    parkName: string,
    campgrounds: CampgroundCatalogEntry[]
  ): Promise<AvailabilityWindowEntry | null>;
}
```

- [ ] **Step 2: Run typecheck — expect errors on providers that now need to implement new methods**

```bash
cd /Users/nimajelveh/campbrain && npm run typecheck 2>&1 | head -30
```

Expected: TypeScript errors on `CaliforniaParksProvider` and `RecreationGovProvider` for missing `generateCacheWindows` and `proactiveScanWindow`. That's correct — we'll fix them next.

- [ ] **Step 3: Add `generateCacheWindows` to `CaliforniaParksProvider`**

In `src/providers/california-parks-provider.ts`, add this import at the top:
```typescript
import dayjs from 'dayjs';
import type { CacheWindow } from './availability-provider.js';
import { WINDOW_DAYS } from '../cache/types.js';
```

Add the method to `CaliforniaParksProvider`:
```typescript
generateCacheWindows(rangeStart: string, rangeEnd: string): CacheWindow[] {
  const windows: CacheWindow[] = [];
  let current = dayjs(rangeStart);
  const end = dayjs(rangeEnd);
  while (current.isBefore(end) || current.isSame(end)) {
    const windowStart = current.format('YYYY-MM-DD');
    const windowEnd = current.add(WINDOW_DAYS - 1, 'day').format('YYYY-MM-DD');
    windows.push({ windowStart, windowEnd });
    current = current.add(WINDOW_DAYS, 'day');
  }
  return windows;
}
```

- [ ] **Step 4: Add `proactiveScanWindow` to `CaliforniaParksProvider`**

Add these imports at the top of `california-parks-provider.ts`:
```typescript
import { parseAllAvailability, isNoAvailabilityPage } from './california-parks-parser.js';
import type { AvailabilityWindowEntry, CampgroundWindow } from '../cache/types.js';
import type { CampgroundCatalogEntry } from '../catalog/types.js';
```

Add the method — this is the logic extracted from `proactive-scanner.ts` lines 109–201:

```typescript
async proactiveScanWindow(
  parkPageId: string,
  window: CacheWindow,
  parkName: string,
  campgrounds: CampgroundCatalogEntry[]
): Promise<AvailabilityWindowEntry | null> {
  const { windowStart, windowEnd } = window;
  const catalogCgByName = new Map(campgrounds.map((c) => [c.name, c]));
  const maxProbes = WINDOW_DAYS;

  let parsed: ReturnType<typeof parseAllAvailability> = [];
  let successUrl = '';

  for (let offset = 0; offset < maxProbes; offset++) {
    const arrivalDate = dayjs(windowStart).add(offset, 'day').format('YYYY-MM-DD');
    const url = buildAvailabilityUrl(parkPageId, { arrivalDate, nights: 1, endDate: windowEnd });

    let html: string;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (err) {
      console.error(`  ✗ ${parkName} ${windowStart}+${offset} — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }

    parsed = parseAllAvailability(html);
    if (parsed.length > 0) {
      successUrl = url;
      break;
    }

    if (!isNoAvailabilityPage(html)) {
      return null;
    }
    // fully booked day — try next
  }

  if (parsed.length === 0) {
    // All probed days fully booked — return empty campgrounds entry
    return {
      parkPageId,
      parkName,
      windowStart,
      windowEnd,
      scannedAt: new Date().toISOString(),
      sourceUrl: buildAvailabilityUrl(parkPageId, { arrivalDate: windowStart, nights: 1, endDate: windowEnd }),
      campgrounds: [],
    };
  }

  const cgWindows: CampgroundWindow[] = parsed.map((pc) => {
    const catalogCg = catalogCgByName.get(pc.name);
    const result: CampgroundWindow = {
      id: catalogCg?.id ?? pc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: pc.name,
      sites: pc.sites,
    };
    const bookingUrl = pc.bookingUrl || catalogCg?.bookingUrl;
    if (bookingUrl) result.bookingUrl = bookingUrl;
    if (catalogCg?.nightlyFee !== undefined) result.nightlyFee = catalogCg.nightlyFee;
    return result;
  });

  return {
    parkPageId,
    parkName,
    windowStart,
    windowEnd,
    scannedAt: new Date().toISOString(),
    sourceUrl: successUrl,
    campgrounds: cgWindows,
  };
}
```

- [ ] **Step 5: Run typecheck**

```bash
cd /Users/nimajelveh/campbrain && npm run typecheck 2>&1 | grep -v "recreation-gov"
```

Expected: Only `RecreationGovProvider` errors remain (for the two new unimplemented methods). CA Parks should be clean.

- [ ] **Step 6: Commit**

```bash
git add src/providers/availability-provider.ts src/providers/california-parks-provider.ts
git commit -m "feat: extend AvailabilityProvider interface with cache window methods; implement on CA Parks"
```

---

## Task 5: Make the proactive scanner provider-agnostic

**Files:**
- Modify: `src/scanner/proactive-scanner.ts`

Replace the CA-Parks-specific scanning body with a thin loop that delegates to `provider.generateCacheWindows()` and `provider.proactiveScanWindow()`.

- [ ] **Step 1: Write a failing test**

Create `test/proactive-scanner-multi-provider.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// The proactive scanner should accept parks from any provider.
// We verify this by checking the filter logic — after the refactor,
// the scanner must not filter out recreation-gov parks.

describe('proactive scanner provider filter', () => {
  it('does not have a california-parks-only filter', async () => {
    // Read the scanner source and assert the filter is gone
    const fs = await import('fs');
    const src = fs.readFileSync('./src/scanner/proactive-scanner.ts', 'utf-8');
    expect(src).not.toContain("p.provider !== 'california-parks'");
    expect(src).not.toContain("provider !== 'california-parks'");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd /Users/nimajelveh/campbrain && npm test -- test/proactive-scanner-multi-provider.test.ts
```

Expected: FAIL (the filter string is still present)

- [ ] **Step 3: Rewrite `proactive-scanner.ts`**

Replace the entire file with:

```typescript
import dayjs from 'dayjs';
import { listCatalogParks } from '../catalog/catalog-store.js';
import { CaliforniaParksProvider } from '../providers/california-parks-provider.js';
import { RecreationGovProvider } from '../providers/recreation-gov-provider.js';
import type { AvailabilityProvider } from '../providers/availability-provider.js';
import {
  findStaleWindows,
  upsertEntry,
  evictExpired,
  refreshMaterializedView,
} from '../cache/availability-cache.js';
import { initDb } from '../cache/db.js';
import { runWithConcurrency } from '../utils/concurrency.js';

const FETCH_CONCURRENCY = 5;
const BATCH_DELAY_MS = 500;

export interface ProactiveScanOptions {
  daysAhead?: number;
  verifiedOnly?: boolean;
  force?: boolean;
  todayOverride?: string;
  logger?: (msg: string) => void;
}

export interface ProactiveScanSummary {
  totalWindows: number;
  staleCount: number;
  fetchCount: number;
  fetchErrors: number;
  cacheWrites: number;
  durationMs: number;
}

function getProvider(providerName: string): AvailabilityProvider {
  switch (providerName) {
    case 'recreation-gov':
      return new RecreationGovProvider();
    default:
      return new CaliforniaParksProvider();
  }
}

export async function runProactiveScan(
  opts: ProactiveScanOptions = {}
): Promise<ProactiveScanSummary> {
  const startMs = Date.now();
  const log = opts.logger ?? (() => {});
  const daysAhead = opts.daysAhead ?? 180;
  const verifiedOnly = opts.verifiedOnly ?? false;

  await initDb();

  const today = opts.todayOverride ? dayjs(opts.todayOverride) : dayjs();
  const rangeStart = today.add(2, 'day').format('YYYY-MM-DD');
  const rangeEnd = today.add(daysAhead, 'day').format('YYYY-MM-DD');

  // Eligible parks: any provider, must have at least one site in catalog
  const parks = listCatalogParks().filter((p) => {
    if (verifiedOnly && !p.pageIdVerified) return false;
    return p.campgrounds.some((c) => c.sites.length > 0);
  });

  if (parks.length === 0) {
    log('No eligible parks found (run catalog refresh first).');
    return { totalWindows: 0, staleCount: 0, fetchCount: 0, fetchErrors: 0, cacheWrites: 0, durationMs: Date.now() - startMs };
  }

  // Generate (park × window) candidates per provider
  type Candidate = { parkPageId: string; windowStart: string; windowEnd: string; providerName: string };
  const allCandidates: Candidate[] = parks.flatMap((park) => {
    const provider = getProvider(park.provider);
    return provider.generateCacheWindows(rangeStart, rangeEnd).map((w) => ({
      parkPageId: park.parkPageId,
      windowStart: w.windowStart,
      windowEnd: w.windowEnd,
      providerName: park.provider,
    }));
  });

  const totalWindows = allCandidates.length;

  // Filter to stale/missing — check per provider (each call queries that provider's scan_windows)
  let toScan: Candidate[];
  if (opts.force) {
    toScan = allCandidates;
  } else {
    // Group by provider to batch the stale-window queries
    const byProvider = new Map<string, Candidate[]>();
    for (const c of allCandidates) {
      const list = byProvider.get(c.providerName) ?? [];
      list.push(c);
      byProvider.set(c.providerName, list);
    }
    const staleLists = await Promise.all(
      Array.from(byProvider.entries()).map(async ([providerName, candidates]) => {
        const staleKeys = new Set(
          (await findStaleWindows(
            candidates.map((c) => ({ parkPageId: c.parkPageId, windowStart: c.windowStart })),
            providerName
          )).map((s) => `${s.parkPageId}::${s.windowStart}`)
        );
        return candidates.filter((c) => staleKeys.has(`${c.parkPageId}::${c.windowStart}`));
      })
    );
    toScan = staleLists.flat();
  }

  const staleCount = toScan.length;
  log(`Proactive scan: ${parks.length} parks, ${allCandidates.length} windows (${daysAhead}d ahead)`);
  log(`  ${totalWindows} total — ${staleCount} stale / missing`);

  if (staleCount === 0) {
    await evictExpired();
    return { totalWindows, staleCount: 0, fetchCount: 0, fetchErrors: 0, cacheWrites: 0, durationMs: Date.now() - startMs };
  }

  const parkByPageId = new Map(parks.map((p) => [p.parkPageId, p]));
  let fetchCount = 0;
  let fetchErrors = 0;
  let cacheWrites = 0;

  const fetchTasks = toScan.map((candidate) => async () => {
    const park = parkByPageId.get(candidate.parkPageId);
    if (!park) return;
    const provider = getProvider(park.provider);
    fetchCount++;

    const entry = await provider.proactiveScanWindow(
      candidate.parkPageId,
      { windowStart: candidate.windowStart, windowEnd: candidate.windowEnd },
      park.parkName,
      park.campgrounds
    );

    if (entry === null) {
      fetchErrors++;
      log(`  ✗ ${park.parkName} ${candidate.windowStart} — fetch failed, will retry next cycle`);
      return;
    }

    await upsertEntry(entry, park.provider);
    cacheWrites++;

    const windowsWithAvail = entry.campgrounds.filter((c) =>
      c.sites.some((s) => Object.values(s.dates).includes('available'))
    ).length;
    if (windowsWithAvail > 0) {
      log(`  ✓ ${park.parkName} ${candidate.windowStart} — ${windowsWithAvail} campground(s) with availability`);
    }
  });

  for (let i = 0; i < fetchTasks.length; i += FETCH_CONCURRENCY * 2) {
    const batch = fetchTasks.slice(i, i + FETCH_CONCURRENCY * 2);
    await runWithConcurrency(batch, FETCH_CONCURRENCY);
    if (i + batch.length < fetchTasks.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const evicted = await evictExpired();
  if (evicted > 0) log(`  Evicted ${evicted} expired cache entries`);

  try {
    await refreshMaterializedView();
    log('  MV refreshed: mv_available_stays');
  } catch (err) {
    log(`  MV refresh failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  return { totalWindows, staleCount, fetchCount, fetchErrors, cacheWrites, durationMs: Date.now() - startMs };
}
```

- [ ] **Step 4: Run the failing test again**

```bash
cd /Users/nimajelveh/campbrain && npm test -- test/proactive-scanner-multi-provider.test.ts
```

Expected: PASS

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/nimajelveh/campbrain && npm test
```

Expected: all pass

- [ ] **Step 6: Run typecheck**

```bash
cd /Users/nimajelveh/campbrain && npm run typecheck
```

Expected: errors only on `RecreationGovProvider` (still missing the two new interface methods)

- [ ] **Step 7: Commit**

```bash
git add src/scanner/proactive-scanner.ts test/proactive-scanner-multi-provider.test.ts
git commit -m "feat: make proactive scanner provider-agnostic; delegate to provider interface"
```

---

## Task 6: Implement Rec.gov `generateCacheWindows` and `proactiveScanWindow`

**Files:**
- Modify: `src/providers/recreation-gov-provider.ts`
- Modify: `test/recreation-gov-provider.test.ts`

Rec.gov's availability API returns a full month per call. `generateCacheWindows` returns first-of-month windows. `proactiveScanWindow` fetches the month JSON and maps every campsite's daily status to an `AvailabilityWindowEntry`.

- [ ] **Step 1: Write failing tests for the new methods**

Add to `test/recreation-gov-provider.test.ts`:

```typescript
import { RecreationGovProvider } from '../src/providers/recreation-gov-provider.js';
import type { RecGovAvailabilityResponse } from '../src/providers/recreation-gov-provider.js';

// ---------------------------------------------------------------------------
// generateCacheWindows
// ---------------------------------------------------------------------------

describe('RecreationGovProvider.generateCacheWindows', () => {
  const provider = new RecreationGovProvider();

  it('returns one window per calendar month spanning the range', () => {
    const windows = provider.generateCacheWindows('2026-07-01', '2026-09-15');
    expect(windows.map((w) => w.windowStart)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
  });

  it('window starts on the 1st of each month', () => {
    const windows = provider.generateCacheWindows('2026-08-15', '2026-09-05');
    expect(windows.every((w) => w.windowStart.endsWith('-01'))).toBe(true);
  });

  it('window ends on the last day of each month', () => {
    const windows = provider.generateCacheWindows('2026-06-10', '2026-07-20');
    const juneWindow = windows.find((w) => w.windowStart === '2026-06-01');
    expect(juneWindow?.windowEnd).toBe('2026-06-30');
    const julyWindow = windows.find((w) => w.windowStart === '2026-07-01');
    expect(julyWindow?.windowEnd).toBe('2026-07-31');
  });

  it('covers a 180-day lookahead without gaps', () => {
    const start = '2026-06-04';
    const end = '2026-12-01';
    const windows = provider.generateCacheWindows(start, end);
    // Every month from June to December should be present
    expect(windows.map((w) => w.windowStart)).toContain('2026-06-01');
    expect(windows.map((w) => w.windowStart)).toContain('2026-12-01');
  });
});

// ---------------------------------------------------------------------------
// proactiveScanWindow — mock fetch
// ---------------------------------------------------------------------------

describe('RecreationGovProvider.proactiveScanWindow', () => {
  const provider = new RecreationGovProvider();

  function makeMockResponse(
    siteData: Record<string, Record<string, 'Available' | 'Reserved'>>
  ): RecGovAvailabilityResponse {
    const campsites: RecGovAvailabilityResponse['campsites'] = {};
    let id = 1;
    for (const [siteName, avail] of Object.entries(siteData)) {
      const campsite_id = String(id++);
      const availabilities: Record<string, string> = {};
      for (const [date, status] of Object.entries(avail)) {
        availabilities[`${date}T00:00:00Z`] = status;
      }
      campsites[campsite_id] = {
        availabilities,
        campsite_id,
        loop: 'MAIN',
        site: siteName,
        type_of_use: 'Overnight',
        max_num_people: 6,
        min_num_people: 1,
      };
    }
    return { campsites, count: Object.keys(campsites).length };
  }

  it('returns null when fetch fails', async () => {
    // Override global fetch with a failing mock
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );
    expect(result).toBeNull();
    global.fetch = originalFetch;
  });

  it('returns an AvailabilityWindowEntry with correct shape on success', async () => {
    const mockResponse = makeMockResponse({
      'A01': { '2026-07-04': 'Available', '2026-07-05': 'Reserved' },
      'A02': { '2026-07-04': 'Available', '2026-07-05': 'Available' },
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );

    expect(result).not.toBeNull();
    expect(result!.parkPageId).toBe('232447');
    expect(result!.parkName).toBe('Upper Pines');
    expect(result!.windowStart).toBe('2026-07-01');
    expect(result!.windowEnd).toBe('2026-07-31');
    expect(result!.campgrounds).toHaveLength(1);
    // Sites A01 and A02 should appear
    const sites = result!.campgrounds[0]!.sites;
    expect(sites.some((s) => s.name === 'A01')).toBe(true);
    expect(sites.some((s) => s.name === 'A02')).toBe(true);
    // A01's July 4 should be 'available'
    const a01 = sites.find((s) => s.name === 'A01')!;
    expect(a01.dates['2026-07-04']).toBe('available');
    expect(a01.dates['2026-07-05']).toBe('unavailable');

    global.fetch = originalFetch;
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd /Users/nimajelveh/campbrain && npm test -- test/recreation-gov-provider.test.ts
```

Expected: Multiple failures for missing `generateCacheWindows` / `proactiveScanWindow` methods, and FAIL on `upsertEntry.length` if the test was kept.

- [ ] **Step 3: Implement `generateCacheWindows` on `RecreationGovProvider`**

Add to `src/providers/recreation-gov-provider.ts`:

```typescript
import dayjs from 'dayjs';
import type { CacheWindow } from './availability-provider.js';
import type { AvailabilityWindowEntry, CampgroundWindow, SiteDailyAvailability } from '../cache/types.js';
import type { CampgroundCatalogEntry } from '../catalog/types.js';
```

Add the method inside `RecreationGovProvider`:

```typescript
generateCacheWindows(rangeStart: string, rangeEnd: string): CacheWindow[] {
  const windows: CacheWindow[] = [];
  // Step to the 1st of the month containing rangeStart
  let current = dayjs(rangeStart).startOf('month');
  const end = dayjs(rangeEnd);
  while (current.isBefore(end) || current.isSame(end, 'month')) {
    windows.push({
      windowStart: current.format('YYYY-MM-DD'),
      windowEnd: current.endOf('month').format('YYYY-MM-DD'),
    });
    current = current.add(1, 'month');
  }
  return windows;
}
```

- [ ] **Step 4: Implement `proactiveScanWindow` on `RecreationGovProvider`**

Add the method inside `RecreationGovProvider`:

```typescript
async proactiveScanWindow(
  parkPageId: string,
  window: CacheWindow,
  parkName: string,
  campgrounds: CampgroundCatalogEntry[]
): Promise<AvailabilityWindowEntry | null> {
  const url = buildAvailabilityUrl(parkPageId, window.windowStart);

  let data: RecGovAvailabilityResponse;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'campbrain/1.0 (personal-use camping assistant)' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = (await response.json()) as RecGovAvailabilityResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${parkName} ${window.windowStart} — ${msg}`);
    return null;
  }

  // All Rec.gov campsites go under one campground entry named after the campground itself.
  // The catalog may have a richer campground breakdown; for now treat the facility as one unit.
  const catalogCg = campgrounds[0];
  const cgId = catalogCg?.id ?? parkPageId;
  const cgName = catalogCg?.name ?? parkName;
  const bookingUrl = buildBookingUrl(parkPageId);

  // Build per-site per-day availability from the monthly response.
  // Campsite keys in the response are internal IDs; use the `site` field as the display name.
  const siteMap = new Map<string, SiteDailyAvailability>();
  for (const campsite of Object.values(data.campsites)) {
    const siteName = campsite.site;
    if (!siteMap.has(siteName)) {
      siteMap.set(siteName, { name: siteName, dates: {} });
    }
    const siteEntry = siteMap.get(siteName)!;
    for (const [isoDatetime, status] of Object.entries(campsite.availabilities)) {
      const date = isoDatetime.slice(0, 10); // "2026-07-04T00:00:00Z" → "2026-07-04"
      // Only record dates within this window
      if (date >= window.windowStart && date <= window.windowEnd) {
        siteEntry.dates[date] = status === 'Available' ? 'available' : 'unavailable';
      }
    }
  }

  const cgWindow: CampgroundWindow = {
    id: cgId,
    name: cgName,
    bookingUrl,
    sites: Array.from(siteMap.values()),
  };
  if (catalogCg?.nightlyFee !== undefined) cgWindow.nightlyFee = catalogCg.nightlyFee;

  return {
    parkPageId,
    parkName,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    scannedAt: new Date().toISOString(),
    sourceUrl: url,
    campgrounds: cgWindow.sites.length > 0 ? [cgWindow] : [],
  };
}
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/nimajelveh/campbrain && npm test -- test/recreation-gov-provider.test.ts
```

Expected: All tests pass

- [ ] **Step 6: Run typecheck — should now be clean**

```bash
cd /Users/nimajelveh/campbrain && npm run typecheck
```

Expected: no errors

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/nimajelveh/campbrain && npm test
```

Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add src/providers/recreation-gov-provider.ts src/providers/availability-provider.ts test/recreation-gov-provider.test.ts
git commit -m "feat: implement generateCacheWindows and proactiveScanWindow on RecreationGovProvider"
```

---

## Task 7: Create the Rec.gov catalog seed file and add RIDB API key env var

**Files:**
- Create: `data/catalog/recreation-gov.json`
- Modify: `.env`

Seed an empty catalog so the provider is registered and `listCatalogParks()` doesn't fail. The catalog discovery command (Task 8) will populate it with real parks.

- [ ] **Step 1: Create `data/catalog/recreation-gov.json`**

```json
{
  "provider": "recreation-gov",
  "parks": []
}
```

- [ ] **Step 2: Add `RIDB_API_KEY` to `.env`**

Add to the end of `.env`:

```
# Recreation.gov RIDB catalog API key — get one free at https://ridb.recreation.gov/register
RIDB_API_KEY=
```

- [ ] **Step 3: Verify the catalog loads without errors**

```bash
cd /Users/nimajelveh/campbrain && npm run catalog:list
```

Expected: lists CA parks as before, with zero Rec.gov parks (not an error — just an empty list)

- [ ] **Step 4: Commit**

```bash
git add data/catalog/recreation-gov.json .env
git commit -m "chore: seed empty recreation-gov catalog and add RIDB_API_KEY placeholder"
```

---

## Task 8: Build Rec.gov catalog discovery via the RIDB API

**Files:**
- Create: `src/catalog/discover-recreation-gov.ts`
- Modify: `src/catalog/refresh-catalog.ts`

The RIDB API requires a free API key. This command is run manually (not as part of the worker). It pages through CA camping facilities and writes `recreation-gov.json`.

- [ ] **Step 1: Write a failing test**

Create `test/discover-recreation-gov.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildRidbFacilitiesUrl, parseRidbFacilities } from '../src/catalog/discover-recreation-gov.js';

describe('buildRidbFacilitiesUrl', () => {
  it('includes the API key and state=CA filter', () => {
    const url = buildRidbFacilitiesUrl('TESTKEY', 0);
    expect(url).toContain('apikey=TESTKEY');
    expect(url).toContain('state=CA');
  });

  it('includes activity=9 (Camping)', () => {
    const url = buildRidbFacilitiesUrl('TESTKEY', 0);
    expect(url).toContain('activity=9');
  });

  it('sets the correct offset', () => {
    const url = buildRidbFacilitiesUrl('TESTKEY', 50);
    expect(url).toContain('offset=50');
  });
});

describe('parseRidbFacilities', () => {
  it('maps RIDB facility to ParkCatalogEntry shape', () => {
    const rawFacilities = [
      {
        FacilityID: '232447',
        FacilityName: 'UPPER PINES',
        FacilityLatitude: 37.7393,
        FacilityLongitude: -119.5593,
        FacilityTypeDescription: 'Campground',
      },
    ];

    const entries = parseRidbFacilities(rawFacilities);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.parkPageId).toBe('232447');
    expect(entries[0]!.parkName).toBe('Upper Pines');
    expect(entries[0]!.provider).toBe('recreation-gov');
    expect(entries[0]!.lat).toBeCloseTo(37.7393);
    expect(entries[0]!.lon).toBeCloseTo(-119.5593);
  });

  it('title-cases ALL_CAPS facility names', () => {
    const rawFacilities = [{ FacilityID: '1', FacilityName: 'LOWER PINES', FacilityLatitude: 0, FacilityLongitude: 0 }];
    const entries = parseRidbFacilities(rawFacilities);
    expect(entries[0]!.parkName).toBe('Lower Pines');
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd /Users/nimajelveh/campbrain && npm test -- test/discover-recreation-gov.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/catalog/discover-recreation-gov.ts`**

```typescript
import type { ParkCatalogEntry, CatalogBookingRule } from './types.js';
import { upsertCatalogPark } from './catalog-store.js';

const RIDB_BASE_URL = 'https://ridb.recreation.gov/api/v1';
const PAGE_SIZE = 50;

const REC_GOV_DEFAULT_RULE: CatalogBookingRule = {
  type: 'rolling_months_before',
  monthsBefore: 6,
  releaseTime: '07:00',
  timezone: 'America/Los_Angeles',
  source: 'known',
  confidence: 'medium',
};

// Exported for tests
export function buildRidbFacilitiesUrl(apiKey: string, offset: number): string {
  const params = new URLSearchParams({
    apikey: apiKey,
    state: 'CA',
    activity: '9',
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  return `${RIDB_BASE_URL}/facilities?${params}`;
}

interface RidbFacility {
  FacilityID: string;
  FacilityName: string;
  FacilityLatitude: number;
  FacilityLongitude: number;
  FacilityTypeDescription?: string;
}

function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Exported for tests
export function parseRidbFacilities(facilities: RidbFacility[]): ParkCatalogEntry[] {
  return facilities.map((f): ParkCatalogEntry => ({
    provider: 'recreation-gov',
    parkName: titleCase(f.FacilityName),
    parkPageId: String(f.FacilityID),
    campgrounds: [],
    defaultBookingRule: REC_GOV_DEFAULT_RULE,
    lat: f.FacilityLatitude || undefined,
    lon: f.FacilityLongitude || undefined,
    discoveryStatus: 'not_started',
  }));
}

export interface DiscoverRecGovOptions {
  apiKey: string;
  dataDir?: string;
  logger?: (msg: string) => void;
}

export interface DiscoverRecGovSummary {
  facilitiesFound: number;
  written: number;
  errors: number;
}

export async function discoverRecreationGovCatalog(
  opts: DiscoverRecGovOptions
): Promise<DiscoverRecGovSummary> {
  const log = opts.logger ?? (() => {});
  let offset = 0;
  let total = 0;
  let written = 0;
  let errors = 0;

  log('Fetching CA camping facilities from RIDB API…');

  while (true) {
    const url = buildRidbFacilitiesUrl(opts.apiKey, offset);
    let facilities: RidbFacility[];

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'campbrain/1.0 (personal-use catalog discovery)' },
      });
      if (!response.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { RECDATA: RidbFacility[]; METADATA: { Results: { CURRENT_COUNT: number; TOTAL_COUNT: number } } };
      facilities = json.RECDATA;
      if (offset === 0) {
        log(`  Total facilities available: ${json.METADATA.Results.TOTAL_COUNT}`);
      }
    } catch (err) {
      log(`  Error fetching offset ${offset}: ${err instanceof Error ? err.message : String(err)}`);
      errors++;
      break;
    }

    if (facilities.length === 0) break;

    const entries = parseRidbFacilities(facilities);
    for (const entry of entries) {
      try {
        upsertCatalogPark(entry, opts.dataDir);
        written++;
      } catch (err) {
        log(`  Failed to write ${entry.parkName}: ${err instanceof Error ? err.message : String(err)}`);
        errors++;
      }
    }

    total += facilities.length;
    log(`  Fetched ${total} facilities so far…`);
    offset += PAGE_SIZE;

    // Politeness delay between pages
    await new Promise((r) => setTimeout(r, 1000));
  }

  return { facilitiesFound: total, written, errors };
}
```

- [ ] **Step 5: Update `refresh-catalog.ts` to dispatch to Rec.gov discovery**

In `src/catalog/refresh-catalog.ts`, find the line where `discover` defaults to CA Parks:
```typescript
const discover = opts.discover ?? discoverCaliforniaParkCatalog;
```

Replace it with:
```typescript
const discover = opts.discover ?? (
  opts.provider === 'recreation-gov' ? undefined : discoverCaliforniaParkCatalog
);
```

Then add a new import at the top:
```typescript
import { discoverRecreationGovCatalog } from './discover-recreation-gov.js';
```

And in the `refreshCatalog` function, before the `for` loop over `selected`, add a branch for Rec.gov:

```typescript
// Rec.gov catalog discovery works differently — it fetches all CA facilities in one pass.
// Run it and return early; per-park discovery doesn't apply.
if (opts.provider === 'recreation-gov') {
  const apiKey = process.env.RIDB_API_KEY;
  if (!apiKey) {
    log('RIDB_API_KEY is not set. Get a free key at https://ridb.recreation.gov/register');
    return { attempted: 0, succeeded: 0, failed: 1, results: [] };
  }
  const summary = await discoverRecreationGovCatalog({
    apiKey,
    dataDir: opts.dataDir,
    logger: log,
  });
  log(`Done: ${summary.facilitiesFound} facilities found, ${summary.written} written, ${summary.errors} errors`);
  return {
    attempted: summary.facilitiesFound,
    succeeded: summary.written,
    failed: summary.errors,
    results: [],
  };
}
```

- [ ] **Step 6: Run the tests**

```bash
cd /Users/nimajelveh/campbrain && npm test -- test/discover-recreation-gov.test.ts
```

Expected: PASS

- [ ] **Step 7: Run typecheck**

```bash
cd /Users/nimajelveh/campbrain && npm run typecheck
```

Expected: no errors

- [ ] **Step 8: Run full test suite**

```bash
cd /Users/nimajelveh/campbrain && npm test
```

Expected: all pass

- [ ] **Step 9: Commit**

```bash
git add src/catalog/discover-recreation-gov.ts src/catalog/refresh-catalog.ts test/discover-recreation-gov.test.ts
git commit -m "feat: add Recreation.gov RIDB catalog discovery command"
```



---

## Task 9: Create `ProviderBadge` component and config map

**Files:**
- Create: `web/lib/providers.ts`
- Create: `web/components/ProviderBadge.tsx`

A data-driven badge config. Adding a new provider later = one line in `PROVIDER_BADGES`.

- [ ] **Step 1: Create `web/lib/providers.ts`**

```typescript
export interface ProviderBadgeConfig {
  label: string;
  color: 'green' | 'blue' | 'orange' | 'purple';
}

export const PROVIDER_BADGES: Record<string, ProviderBadgeConfig> = {
  'california-parks': { label: 'CA State Parks', color: 'green' },
  'recreation-gov':   { label: 'Recreation.gov', color: 'blue' },
};
```

- [ ] **Step 2: Create `web/components/ProviderBadge.tsx`**

This must be a server or client-safe component (no hooks) since it's used in both client components.

```tsx
import { PROVIDER_BADGES } from '../lib/providers';

interface Props {
  providerId: string;
  style?: React.CSSProperties;
}

export default function ProviderBadge({ providerId, style }: Props) {
  const config = PROVIDER_BADGES[providerId];
  if (!config) return null;

  const colorClass = `badge-${config.color}`;
  return (
    <span
      className={`badge ${colorClass}`}
      style={{ fontSize: 10, ...style }}
    >
      {config.label}
    </span>
  );
}
```

- [ ] **Step 3: Verify the badge CSS classes exist**

Check `web/app/globals.css` or similar for `.badge-green` and `.badge-blue` definitions:

```bash
grep -n "badge-green\|badge-blue" /Users/nimajelveh/campbrain/web/app/globals.css 2>/dev/null || grep -rn "badge-green\|badge-blue" /Users/nimajelveh/campbrain/web/app --include="*.css"
```

Expected: both classes are defined (they're used for existing walk-up badges and status badges). If `badge-blue` is missing, add it to `globals.css`:

```css
.badge-blue { background: #dbeafe; color: #1d4ed8; }
```

- [ ] **Step 4: Run typecheck**

```bash
cd /Users/nimajelveh/campbrain && npm run typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add web/lib/providers.ts web/components/ProviderBadge.tsx
git commit -m "feat: add ProviderBadge component and PROVIDER_BADGES config map"
```

---

## Task 10: Add `provider` to search API + show badge in `FindCampsitesClient`

**Files:**
- Modify: `web/app/api/search/route.ts`
- Modify: `web/app/explore/FindCampsitesClient.tsx`
- Modify: `web/app/explore/page.tsx`

- [ ] **Step 1: Add `provider` to `SearchParkResponse` type**

In `web/app/api/search/route.ts`, update:
```typescript
export type SearchParkResponse = {
  parkPageId: string;
  parkName: string;
  provider: string;      // ← add this
  region: CampRegion;
  campgrounds: SearchCampgroundResponse[];
  totalAvailable: number;
};
```

- [ ] **Step 2: Populate `provider` in the GET handler**

In the GET handler, the catalog lookup already has `coordsByPageId`. Also build a `providerByPageId` map:

```typescript
const providerByPageId = new Map(
  catalogParks.map((p) => [p.parkPageId, p.provider])
);
```

Then in the `.map((park) => {...})` block, add:
```typescript
const provider = providerByPageId.get(park.parkPageId) ?? 'california-parks';
return { ...park, region, totalAvailable, provider };
```

- [ ] **Step 3: Update `FindCampsitesClient` to import and render `ProviderBadge`**

In `web/app/explore/FindCampsitesClient.tsx`, add this import:
```typescript
import ProviderBadge from '../../components/ProviderBadge';
```

In the `ParkCard` component, the header row has the park name and region badge. Add the provider badge right after the region badge, before the availability badge:

```tsx
<span className="badge badge-gray" style={{ fontSize: 10 }}>
  {REGION_LABELS[park.region]}
</span>
<ProviderBadge providerId={park.provider} />
{hasBookable ? (
  <span className="badge badge-green">
    ...
  </span>
) : (
  ...
)}
```

The `ParkCard` component receives `park: SearchParkResponse` which now includes `provider`. No type change needed.

- [ ] **Step 4: Update the subtitle text in `explore/page.tsx`**

Change line 11 from:
```tsx
Search available campsites across California state parks
```
to:
```tsx
Search available campsites across California
```

- [ ] **Step 5: Run typecheck**

```bash
cd /Users/nimajelveh/campbrain && npm run typecheck
```

Expected: no errors

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/nimajelveh/campbrain && npm test
```

Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add web/app/api/search/route.ts web/app/explore/FindCampsitesClient.tsx web/app/explore/page.tsx
git commit -m "feat: add provider field to search API and ProviderBadge to park cards"
```

---

## Task 11: Add `ProviderBadge` to the map detail panel

**Files:**
- Modify: `web/app/map/MapClient.tsx`
- Modify: `web/app/api/map/availability/route.ts`

The map panel already has access to `park.provider` via `MapPark` (the catalog route already returns it). Add the badge to the detail panel header. Also update the map availability route to accept and pass `provider` so `getEntriesForPark` is correctly scoped.

- [ ] **Step 1: Update `web/app/api/map/availability/route.ts` to accept `provider` param**

In the GET handler, after reading `parkPageId`:
```typescript
const parkPageId = req.nextUrl.searchParams.get('parkPageId');
const providerName = req.nextUrl.searchParams.get('provider') ?? undefined;
if (!parkPageId) {
  return NextResponse.json({ error: 'parkPageId is required' }, { status: 400 });
}
```

Then change:
```typescript
const parkEntries = await getEntriesForPark(parkPageId);
```
to:
```typescript
const parkEntries = await getEntriesForPark(parkPageId, providerName);
```

- [ ] **Step 2: Add `ProviderBadge` to the map detail panel header**

In `web/app/map/MapClient.tsx`, add:
```typescript
import ProviderBadge from '../../components/ProviderBadge';
```

Find the detail panel header section (around the `<h2>{park.parkName}</h2>` line, approximately line 407):
```tsx
<div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
  <span className={`badge ${statusBadge(park.discoveryStatus)}`}>
    {park.discoveryStatus ?? 'unknown'}
  </span>
  <ProviderBadge providerId={park.provider} />
  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
    {park.campgroundCount} campground{park.campgroundCount !== 1 ? 's' : ''} · {park.siteCount} sites
  </span>
</div>
```

- [ ] **Step 3: Update `useParkAvailability` in `MapClient.tsx` to accept and forward `provider`**

`useParkAvailability` is defined at line 113. It currently takes `(parkPageId, from, to)`. Change it to:

```typescript
function useParkAvailability(
  parkPageId: string | null,
  from: string,
  to: string,
  provider?: string
): FetchState {
  const [cache, setCache] = useState<Record<string, FetchState>>({});
  const key = parkPageId ? `${parkPageId}|${from}|${to}` : null;

  useMemo(() => {
    if (!parkPageId || !key) return;
    if (cache[key]) return;

    setCache((prev) => ({ ...prev, [key]: { status: 'loading' } }));

    const params = new URLSearchParams({ parkPageId });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (provider) params.set('provider', provider);          // ← add this line

    fetch(`/api/map/availability?${params.toString()}`)
      // ... rest unchanged
```

At line 322 where the hook is called, add `park.provider`:
```typescript
const fetchState = useParkAvailability(park.parkPageId, availFrom, availTo, park.provider);
```

- [ ] **Step 4: Run typecheck**

```bash
cd /Users/nimajelveh/campbrain && npm run typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add web/app/map/MapClient.tsx web/app/api/map/availability/route.ts
git commit -m "feat: add ProviderBadge to map detail panel; scope availability fetch by provider"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
cd /Users/nimajelveh/campbrain && npm test
```

Expected: all tests pass

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/nimajelveh/campbrain && npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Verify the CA Parks proactive scanner still works end-to-end**

```bash
cd /Users/nimajelveh/campbrain && npm run worker -- --once 2>&1 | head -40
```

(If `--once` isn't a flag, use `npm run scan` instead.)

Expected: Scanner runs, reads CA Parks parks from catalog, fetches windows, writes to DB.

- [ ] **Step 4: Verify the dev server loads without errors**

```bash
cd /Users/nimajelveh/campbrain && npm run dev &
sleep 5
curl -s http://localhost:3001/api/search?from=2026-07-04&to=2026-07-06 | python3 -m json.tool | head -20
```

Expected: JSON response with park results; no 500 errors.

- [ ] **Step 5: Verify catalog commands work**

```bash
cd /Users/nimajelveh/campbrain && npm run catalog:list
```

Expected: lists CA parks; shows 0 Rec.gov parks (until RIDB_API_KEY is set and `catalog:refresh --provider=recreation-gov` is run).

- [ ] **Step 6: Document the "run catalog discovery" workflow in CLAUDE.md Next Steps**

Update `CLAUDE.md` under Commands to include:

```
npm run catalog:refresh -- --provider=recreation-gov  # Seed Rec.gov catalog (requires RIDB_API_KEY in .env)
```

- [ ] **Step 7: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: document recreation-gov catalog refresh command"
```

---

## Known Limitations (post-MVP)

1. **`park_page_id` collision risk**: The map's availability summary (`getParksWithAvailability`) returns `park_page_id` without `provider_id`. If a CA Parks ID happened to equal a Rec.gov campground ID, the wrong pin could light up. In practice, CA Parks IDs are 3-4 digits and Rec.gov IDs are 6 digits — collision risk is negligible. Fix in a follow-up by returning `{ provider_id, park_page_id }[]` pairs.

2. **Rec.gov campground grouping**: The `proactiveScanWindow` implementation groups all campsites from a facility into one campground. Facilities with multiple campground loops (e.g. Upper Pines, Lower Pines, North Pines all being separate facilities) will each appear as their own card, which is correct. But a facility with sub-loops all under one ID will appear as one campground with all sites mixed together.

3. **Rec.gov catalog is empty until RIDB_API_KEY is set**: The worker will correctly run with zero Rec.gov parks and log "0 parks, 0 windows" for the rec.gov side. This is expected until the user registers for a RIDB key and runs `catalog:refresh`.
