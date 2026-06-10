# Map Filter Bar Rework + Site Type Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace query-time site-name regexes with persisted, typed site-classification columns; teach the availability queries/APIs to filter on those columns plus a min-stay (consecutive-nights) constraint; then rebuild the `/map` filter bar and `/explore` filter panel around a shared taxonomy (Access / Site kind / Hide) with a single horizon-preset row, a min-stay row, a park finder, and a plain-language summary sentence.

**Architecture:** A single pure classifier (`src/catalog/site-classifier.ts`) becomes the only home for classification regexes. Scan-time upserts persist six typed columns on `sites`; a one-off backfill classifies existing rows by name. All availability queries (`buildAvailabilityClauses`, `getParkAvailabilityCounts`, the `/explore` search query, the materialized view) drop name regexes and filter on the typed columns, gaining an `access`/`kinds`/`hide`/`minNights` surface. `minNights` is a gaps-and-islands SQL pass over each site's available dates. The three map/search APIs adopt the same params. On the web side a shared `web/lib/site-taxonomy.ts` exports the pill groups; `/map` and `/explore` both render them, and `/map`'s client-side `passesSiteFilters` filtering is removed in favor of server-side detail filtering.

**Tech Stack:** TypeScript (strict, no `any`), Postgres via the `postgres` client, Vitest, Next.js 14 / React 18, Leaflet.

**Spec:** [docs/superpowers/specs/2026-06-09-map-filter-rework-design.md](../specs/2026-06-09-map-filter-rework-design.md)

**Conventions that apply to every task** (from CLAUDE.md): TypeScript strict, no `any` (prefer `unknown` + narrowing); kebab-case files; early returns over nested conditionals; no unnecessary comments; provider parsing stays behind adapters in `src/providers/`. Tests live in `test/` at the repo root and import source via relative paths with `.js` extensions (see `test/availability-clauses.test.ts` for the pattern). Run a single test file with `npx vitest run test/<file>.test.ts`. Run `npm run typecheck` after every meaningful change. The branch is `map-pin-redesign` (clean tree); this work builds directly on it.

---

## Open questions (flag before/while building — do not resolve silently)

These are spec ambiguities the Planner surfaced. The implementing agents should confirm answers with the Architect/user rather than guessing; the plan below picks a documented default for each so work is not blocked, but each default is called out at its task.

1. **`hike-in only` semantics changed from include to access-multiselect.** The old `hike_in_only` was a positive include ("show ONLY hike-in"). The new model has `Access` as a multi-select where "none = all" and selecting `Hike-in` means `s.access = ANY('{hike_in}')` — i.e. selecting only Hike-in reproduces the old include. Confirmed consistent with spec Part 1 (`access` filter) and Part 2 Row 3. **Default taken:** Access multi-select replaces `hike_in_only` entirely; there is no standalone "hike-in only" pill. No open action unless the user wanted to keep an explicit include toggle.

2. **`boat_in` is reachable via Access but not via Hide.** The old `exclude_boat_in` filter is dropped; boat-in is now an Access *value* (`Drive-in / Hike-in / Boat-in`), so the only way to exclude boat-in sites is to select Drive-in and/or Hike-in (which excludes boat-in by omission). The spec lists Hide as `Group · Equestrian · Walk-up` only — no "hide boat-in". **Default taken:** follow the spec exactly; no boat-in Hide pill. Flag if the user expects a one-click "hide boat-in".

3. **Min-stay vs the `/explore` exact-range search are different query shapes.** `/explore`'s `searchAvailableStays` already requires *every* night in `[from,to)` (an exact-length stay), so `minNights` is not meaningful there. The spec's `minNights` work targets the *summary* (pin) query and the *detail* panel, not `/explore`. **Default taken:** `minNights` is added to the summary + detail queries only; `/explore` keeps its exact-range semantics and gains only the taxonomy params (`access`/`kinds`/`hide`). Flag if the user wanted a min-stay control on `/explore` too.

4. **`minNights` + `weekendsOnly` interaction with the 8-day window boundary.** A 3-night Friday stay needs Fri+Sat+Sun all available; gaps-and-islands islands only form from contiguous `available` rows in `availability`. Because scan windows overlap and dedupe by `(site_id,date)` in the table itself (PK is `(site_id,date)`), island detection is naturally deduped — but an island can still be *truncated* at a window edge if the far night wasn't scanned. **Default taken:** accept current cache coverage (matches existing 2-night MV behavior, which has the same boundary property); add a test documenting the truncation case. Flag if the user wants cross-window gap-filling.

5. **Rec.gov `campsite_type` field name/casing.** The spec says `campsite_type` is "already in the response we fetch and currently dropped." The current `RecGovCampsite` interface does NOT declare it, so its exact JSON key/casing is unverified against a live payload. **Default taken:** add `campsite_type?: string` to the interface and thread it; the classifier upper-cases and substring-matches (`TENT ONLY`, `RV`, `ELECTRIC`, `WALK TO`, `HIKE TO`, `BOAT`, `GROUP`, `EQUESTRIAN`, `CABIN`, `YURT`, `DAY`) per the spec, falling back to name patterns when the field is absent/empty. The Rec.gov-rescan milestone (worker restart) is where this gets validated against live data. Flag if a saved Rec.gov payload sample is available to pin the exact key earlier.

6. **Default load `minNights` is `Any`, but default `weekendsOnly` is on + locked under "This weekend".** Spec Part 2 says default = This weekend + Weekends only on + min stay Any. With This-weekend the date range is a single Fri–Mon span, so weekends-only is forced on and visually locked. **Default taken:** implement the lock exactly as specified; switching off "This weekend" unlocks the Weekends-only pill. No open action; noted because it couples two controls.

---

## File structure (what each file owns after this plan)

**Engine (Chunk 1):**
- `src/catalog/site-classifier.ts` *(new)* — `classifySite()`, `SiteTypeInfo`, `isWalkUpSite()`; the ONLY place classification regexes live.
- `src/cache/db.ts` *(modify)* — six `ALTER TABLE sites ADD COLUMN IF NOT EXISTS` in `initDb`; MV definition loses its name-regex arm and gains `is_day_use = false`.
- `src/cache/availability-cache.ts` *(modify)* — delete `FILTER_SQL`/`WALK_UP_SQL`; new `buildAvailabilityClauses` signature; `getParkAvailabilityCounts` reads typed columns + `minNights` gaps-and-islands; `searchAvailableStays` filters on typed columns; site upserts in `upsertEntry` set/update the type columns.
- `src/providers/recreation-gov-provider.ts` *(modify)* — add `campsite_type?` to `RecGovCampsite`; thread it into the site entries so the upsert can classify.
- `src/providers/california-parks-parser.ts` *(verify only)* — produces site names; no type fields needed (classifier runs at upsert time off the name). Confirm no change required.
- `src/cli/commands/db-backfill-types.ts` *(new)* + `src/cli/index.ts` *(modify)* + `package.json` *(modify)* — `db:backfill-types` script.
- API routes *(modify)*: `web/app/api/map/availability/summary/route.ts`, `web/app/api/map/availability/route.ts`, `web/app/api/search/route.ts` — parse `access`/`kinds`/`hide`/`minNights`; drop `filters`.

**UI (Chunk 2):**
- `web/lib/site-taxonomy.ts` *(new)* — pill group definitions (ids, labels, param mapping) + re-export `isWalkUpSite` from the classifier.
- `web/lib/site-filters.ts` *(delete the filter list; keep nothing or re-export)* — `AVAILABLE_FILTERS`/`passesSiteFilters` removed; `isWalkUpSite` moves to the classifier (re-exported via taxonomy).
- `web/app/components/SiteFilterPanel.tsx` *(replace)* — renders taxonomy groups instead of the six-filter list (or is replaced by a new `TaxonomyFilterGroups` component).
- `web/app/map/MapClient.tsx` *(modify)* — four-row filter bar, horizon presets, weekends-only pill, min-stay row, summary sentence + Reset, server-side detail filtering (remove `passesSiteFilters`).
- `web/app/map/ParkFinder.tsx` *(new)* + wired into `web/app/map/MapClient.tsx` — type-ahead park search overlay.
- `web/app/explore/FindCampsitesClient.tsx` *(modify)* — swap `SiteFilterPanel` for taxonomy groups; send `access`/`kinds`/`hide`.

**Tests:**
- `test/site-classifier.test.ts` *(new)*, `test/availability-clauses.test.ts` *(rewrite)*, `test/min-nights.test.ts` *(new, or fold into availability tests)*, plus existing suites kept green.

---

# CHUNK 1 — ENGINE

> Chunk 1 ends with a verification gate (Task 11) and a "user restarts `npm run worker` for Rec.gov rescan" milestone. Chunk 2 (UI) may begin once the API shapes from Tasks 8–10 are merged.

---

### Task 1: Site classifier module

The single source of truth for classification. Pure functions, no DB, no React — node-testable.

**Files:**
- Create: `src/catalog/site-classifier.ts`
- Test: `test/site-classifier.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/site-classifier.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { classifySite, isWalkUpSite } from '../src/catalog/site-classifier.js';

describe('classifySite — CA name patterns', () => {
  it('flags hike/bike as walk-up', () => {
    const r = classifySite('Hike/Bike Site 1', 'Main Campground');
    expect(r.isWalkUp).toBe(true);
  });
  it('flags group sites', () => {
    expect(classifySite('Group Tent Site A', 'Group Camp').isGroup).toBe(true);
  });
  it('flags equestrian and horse', () => {
    expect(classifySite('Equestrian Site 3', 'Horse Camp').isEquestrian).toBe(true);
    expect(classifySite('Horse Camp 2', '').isEquestrian).toBe(true);
  });
  it('flags day-use / picnic', () => {
    expect(classifySite('Day Use Area', '').isDayUse).toBe(true);
    expect(classifySite('Picnic Site 4', '').isDayUse).toBe(true);
  });
  it('folds primitive/environmental/hike-in into access=hike_in', () => {
    expect(classifySite('Environmental Site 1', '').access).toBe('hike_in');
    expect(classifySite('Primitive Site', '').access).toBe('hike_in');
    expect(classifySite('Hike-in Site 2', '').access).toBe('hike_in');
    expect(classifySite('Walk-in Site', '').access).toBe('hike_in');
  });
  it('detects boat-in access', () => {
    expect(classifySite('Boat-in Site 5', '').access).toBe('boat_in');
  });
  it('detects site kinds', () => {
    expect(classifySite('Site 12 (E/W Hookup)', '').siteKind).toBe('hookup');
    expect(classifySite('Tent Site 7', '').siteKind).toBe('tent');
    expect(classifySite('Cabin 3', '').siteKind).toBe('cabin');
    expect(classifySite('Yurt 1', '').siteKind).toBe('cabin');
  });
  it('defaults to drive_in with null kind', () => {
    const r = classifySite('047', '');
    expect(r.access).toBe('drive_in');
    expect(r.siteKind).toBeNull();
    expect(r.isGroup).toBe(false);
  });
  it('treats group + tent + hike-in as orthogonal dimensions', () => {
    const r = classifySite('Group Tent Primitive Campsite', '');
    expect(r.isGroup).toBe(true);
    expect(r.access).toBe('hike_in');
    expect(r.siteKind).toBe('tent');
  });
});

describe('classifySite — Rec.gov campsite_type', () => {
  it('prefers campsite_type over name', () => {
    expect(classifySite('047', '', 'TENT ONLY').siteKind).toBe('tent');
    expect(classifySite('B027', '', 'RV NONELECTRIC').siteKind).toBe('hookup');
    expect(classifySite('A1', '', 'WALK TO').access).toBe('hike_in');
    expect(classifySite('A1', '', 'BOAT IN').access).toBe('boat_in');
    expect(classifySite('A1', '', 'GROUP TENT').isGroup).toBe(true);
    expect(classifySite('A1', '', 'EQUESTRIAN').isEquestrian).toBe(true);
    expect(classifySite('A1', '', 'CABIN NONELECTRIC').siteKind).toBe('cabin');
    expect(classifySite('A1', '', 'DAY USE').isDayUse).toBe(true);
  });
  it('falls back to name patterns when campsite_type is absent or empty', () => {
    expect(classifySite('Tent Site 7', '', '').siteKind).toBe('tent');
    expect(classifySite('Tent Site 7', '', undefined).siteKind).toBe('tent');
  });
});

describe('isWalkUpSite (re-exported helper)', () => {
  it('matches hike/bike regardless of separator', () => {
    expect(isWalkUpSite('Hike/Bike 1')).toBe(true);
    expect(isWalkUpSite('Hike & Bike Site')).toBe(true);
    expect(isWalkUpSite('Standard Site 4')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/site-classifier.test.ts`
Expected: FAIL — `classifySite` is not defined / module not found.

- [ ] **Step 3: Implement the classifier**

Create `src/catalog/site-classifier.ts`:

```typescript
export type SiteAccess = 'drive_in' | 'hike_in' | 'boat_in';
export type SiteKind = 'tent' | 'hookup' | 'cabin';

export interface SiteTypeInfo {
  access: SiteAccess;
  siteKind: SiteKind | null;
  isGroup: boolean;
  isEquestrian: boolean;
  isWalkUp: boolean;
  isDayUse: boolean;
}

const WALK_UP_RE = /\bhike\s*[/&]?\s*bike\b/i;
const GROUP_RE = /\bgroup\b/i;
const EQUESTRIAN_RE = /\b(equestrian|horse)\b/i;
const DAY_USE_RE = /\b(day.?use|dailyuse|picnic)\b/i;
const HIKE_IN_RE = /\b(hike.?in|walk.?in|environmental|primitive)\b/i;
const BOAT_IN_RE = /\bboat[\s-]?(in|to|access)?\b/i;
const HOOKUP_RE = /\bhook.?up\b|\(E\/W/i;
const TENT_RE = /\btent\b/i;
const CABIN_RE = /\b(cabin|yurt|cottage)\b/i;

/**
 * True for sites that are walk-up / first-come-first-served only (CA State Parks
 * "Hike/Bike" sites). These show as "Available" on parks.ca.gov but are NOT
 * bookable on ReserveCalifornia, so they must never count as bookable.
 */
export function isWalkUpSite(siteName: string, campgroundName = ''): boolean {
  return WALK_UP_RE.test(`${siteName} ${campgroundName}`);
}

function classifyByName(text: string): SiteTypeInfo {
  const isWalkUp = WALK_UP_RE.test(text);
  let access: SiteAccess = 'drive_in';
  if (HIKE_IN_RE.test(text)) access = 'hike_in';
  else if (BOAT_IN_RE.test(text)) access = 'boat_in';

  let siteKind: SiteKind | null = null;
  if (HOOKUP_RE.test(text)) siteKind = 'hookup';
  else if (TENT_RE.test(text)) siteKind = 'tent';
  else if (CABIN_RE.test(text)) siteKind = 'cabin';

  return {
    access,
    siteKind,
    isGroup: GROUP_RE.test(text),
    isEquestrian: EQUESTRIAN_RE.test(text),
    isWalkUp,
    isDayUse: DAY_USE_RE.test(text),
  };
}

function applyRecGovType(info: SiteTypeInfo, t: string): SiteTypeInfo {
  const next = { ...info };
  if (t.includes('GROUP')) next.isGroup = true;
  if (t.includes('EQUESTRIAN')) next.isEquestrian = true;
  if (t.includes('DAY')) next.isDayUse = true;
  if (t.includes('WALK TO') || t.includes('HIKE TO')) next.access = 'hike_in';
  else if (t.includes('BOAT')) next.access = 'boat_in';
  if (t.includes('CABIN') || t.includes('YURT')) next.siteKind = 'cabin';
  else if (t.includes('RV') || t.includes('ELECTRIC')) next.siteKind = 'hookup';
  else if (t.includes('TENT')) next.siteKind = 'tent';
  return next;
}

export function classifySite(
  siteName: string,
  campgroundName: string,
  recGovCampsiteType?: string,
): SiteTypeInfo {
  const base = classifyByName(`${siteName} ${campgroundName}`);
  const t = recGovCampsiteType?.trim().toUpperCase();
  if (!t) return base;
  return applyRecGovType(base, t);
}
```

> Note: `RV` is checked before `ELECTRIC` only matters for `site_kind`; both map to `hookup`. `CABIN`/`YURT` take precedence over `RV`/`TENT` because a "GROUP CABIN" is still a cabin. Order mirrors the spec's mapping list.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/site-classifier.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/catalog/site-classifier.ts test/site-classifier.test.ts
git commit -m "feat(catalog): site-classifier — single source of truth for site type regexes"
```

---

### Task 2: Schema — typed columns on `sites`

Add the six columns idempotently in `initDb`. Depends on nothing (DDL only).

**Files:**
- Modify: `src/cache/db.ts` (inside `initDb`, after the `sites` `CREATE TABLE`, before the indexes)

- [ ] **Step 1: Add the ALTER statements**

In `src/cache/db.ts`, immediately after the `CREATE TABLE IF NOT EXISTS sites (...)` block and before `CREATE INDEX ... idx_sites_park`, add:

```typescript
  await db`ALTER TABLE sites ADD COLUMN IF NOT EXISTS access TEXT NOT NULL DEFAULT 'drive_in'`;
  await db`ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_kind TEXT`;
  await db`ALTER TABLE sites ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false`;
  await db`ALTER TABLE sites ADD COLUMN IF NOT EXISTS is_equestrian BOOLEAN NOT NULL DEFAULT false`;
  await db`ALTER TABLE sites ADD COLUMN IF NOT EXISTS is_walk_up BOOLEAN NOT NULL DEFAULT false`;
  await db`ALTER TABLE sites ADD COLUMN IF NOT EXISTS is_day_use BOOLEAN NOT NULL DEFAULT false`;
```

- [ ] **Step 2: Run db:init against the local DB**

Run: `docker compose up -d && npm run db:init`
Expected: "Initializing database schema…" then "Done." with no error. Run it a second time to confirm idempotency (no error on existing columns).

- [ ] **Step 3: Verify columns exist**

Run: `docker compose exec -T db psql -U postgres -d campbrain -c "\d sites"` (adjust user/db to match `DATABASE_URL`).
Expected: the six new columns appear with the documented defaults.

- [ ] **Step 4: Commit**

```bash
git add src/cache/db.ts
git commit -m "feat(db): add typed site-classification columns to sites (idempotent)"
```

---

### Task 3: Persist classification at scan time (`upsertEntry`)

Site upserts must set the type columns on insert AND update them on conflict, so reclassification heals existing rows. Depends on Task 1 (classifier) and Task 2 (columns). Rec.gov `campsite_type` threading is Task 4 — this task wires CA name-based classification, which already works for both providers via name fallback.

**Files:**
- Modify: `src/cache/availability-cache.ts` — the site upsert block in `upsertEntry` (currently lines ~115–137)
- Modify: `src/cache/types.ts` — add optional `recGovCampsiteType?` to `SiteDailyAvailability` so the provider can pass it through

- [ ] **Step 1: Add the optional field to the site shape**

In `src/cache/types.ts`, extend `SiteDailyAvailability`:

```typescript
export interface SiteDailyAvailability {
  name: string;
  /** Keys are YYYY-MM-DD dates within the window */
  dates: Record<string, 'available' | 'unavailable' | 'unknown'>;
  /** Rec.gov campsite_type string when available — used to classify site type at upsert. */
  recGovCampsiteType?: string;
}
```

- [ ] **Step 2: Set the type columns in the site upsert**

In `src/cache/availability-cache.ts`, add the import at the top (next to the existing imports):

```typescript
import { classifySite } from '../catalog/site-classifier.js';
```

Replace the `siteRowMap` construction and the `INSERT INTO sites ... DO UPDATE` (currently lines ~116–137) with a version that classifies each row and writes all six columns:

```typescript
    // 6. Bulk upsert sites — deduplicate by (campground_name, site_name) within this park.
    //    Classify each site so the typed columns are set on insert and healed on conflict.
    const siteRowMap = new Map<string, {
      provider_id: string; park_page_id: string; campground_name: string; site_name: string;
      access: string; site_kind: string | null;
      is_group: boolean; is_equestrian: boolean; is_walk_up: boolean; is_day_use: boolean;
    }>();
    for (const cg of entry.campgrounds) {
      for (const site of cg.sites) {
        const info = classifySite(site.name, cg.name, site.recGovCampsiteType);
        siteRowMap.set(`${cg.name}::${site.name}`, {
          provider_id: providerId,
          park_page_id: entry.parkPageId,
          campground_name: cg.name,
          site_name: site.name,
          access: info.access,
          site_kind: info.siteKind,
          is_group: info.isGroup,
          is_equestrian: info.isEquestrian,
          is_walk_up: info.isWalkUp,
          is_day_use: info.isDayUse,
        });
      }
    }
    const siteRows = Array.from(siteRowMap.values());

    if (siteRows.length === 0) return;

    type SiteRow = { site_id: number; campground_name: string; site_name: string };
    const returnedSites = (await tx`
      INSERT INTO sites ${tx(siteRows, 'provider_id', 'park_page_id', 'campground_name', 'site_name', 'access', 'site_kind', 'is_group', 'is_equestrian', 'is_walk_up', 'is_day_use')}
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name)
      DO UPDATE SET
        site_name = EXCLUDED.site_name,
        access = EXCLUDED.access,
        site_kind = EXCLUDED.site_kind,
        is_group = EXCLUDED.is_group,
        is_equestrian = EXCLUDED.is_equestrian,
        is_walk_up = EXCLUDED.is_walk_up,
        is_day_use = EXCLUDED.is_day_use
      RETURNING site_id, campground_name, site_name
    `) as unknown as SiteRow[];
```

(The `siteIdMap` build and availability insert that follow are unchanged.)

- [ ] **Step 3: Run the existing provider/cache tests**

Run: `npx vitest run test/availability-cache-provider.test.ts`
Expected: PASS (upsert path still works; the test asserts on availability, not the new columns yet — that is fine).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/cache/availability-cache.ts src/cache/types.ts
git commit -m "feat(cache): classify and persist site type columns on upsert (heals on conflict)"
```

---

### Task 4: Thread Rec.gov `campsite_type` into site entries

The Rec.gov month payload carries `campsite_type` which is currently dropped. Add it to the interface and copy it onto each site so the upsert classifier (Task 3) prefers it. Depends on Task 3 (consumes `recGovCampsiteType`).

**Files:**
- Modify: `src/providers/recreation-gov-provider.ts` — `RecGovCampsite` interface + `proactiveScanWindow` site-map build

- [ ] **Step 1: Add the field to the interface**

In `src/providers/recreation-gov-provider.ts`, extend `RecGovCampsite`:

```typescript
interface RecGovCampsite {
  availabilities: Record<string, string>;
  campsite_id: string;
  loop: string;
  site: string;
  type_of_use: string;
  max_num_people: number;
  min_num_people: number;
  campsite_type?: string;
}
```

- [ ] **Step 2: Carry campsite_type onto each site in proactiveScanWindow**

In `proactiveScanWindow`, the site-map build (currently lines ~236–249) records `{ name, dates }`. Update it to also record the campsite_type the first time a site is seen:

```typescript
    const siteMap = new Map<string, SiteDailyAvailability>();
    for (const campsite of Object.values(data.campsites)) {
      const siteName = campsite.site;
      if (!siteMap.has(siteName)) {
        const entry: SiteDailyAvailability = { name: siteName, dates: {} };
        if (campsite.campsite_type) entry.recGovCampsiteType = campsite.campsite_type;
        siteMap.set(siteName, entry);
      }
      const siteEntry = siteMap.get(siteName)!;
      for (const [isoDatetime, status] of Object.entries(campsite.availabilities)) {
        const date = isoDatetime.slice(0, 10);
        if (date >= window.windowStart && date <= window.windowEnd) {
          siteEntry.dates[date] = status === 'Available' ? 'available' : 'unavailable';
        }
      }
    }
```

- [ ] **Step 3: Run the Rec.gov provider tests + typecheck**

Run: `npx vitest run test/availability-cache-provider.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/providers/recreation-gov-provider.ts
git commit -m "feat(providers): thread Rec.gov campsite_type into site entries for classification"
```

> **OPEN QUESTION 5 reminder:** `campsite_type` casing/key is unverified against a live payload. The classifier upper-cases and substring-matches, so casing is tolerated; an absent key falls back to name patterns. Live validation happens at the Rec.gov rescan milestone after Chunk 1 merges.

---

### Task 5: Backfill script for existing rows

Classify every existing `sites` row by name (Rec.gov rows get name fallback until the next worker scan supplies `campsite_type`). Depends on Task 1 (classifier) and Task 2 (columns).

**Files:**
- Create: `src/cli/commands/db-backfill-types.ts`
- Modify: `src/cli/index.ts` — register the `db backfill-types` subcommand
- Modify: `package.json` — add `db:backfill-types` script

- [ ] **Step 1: Write the backfill command**

Create `src/cli/commands/db-backfill-types.ts`:

```typescript
import { getSql, endDb } from '../../cache/db.js';
import { classifySite } from '../../catalog/site-classifier.js';

export async function dbBackfillTypesCommand(): Promise<void> {
  const sql = getSql();
  console.log('Backfilling site type columns by name…');

  const rows = await sql<{ site_id: number; site_name: string; campground_name: string }[]>`
    SELECT site_id, site_name, campground_name FROM sites
  `;
  console.log(`Classifying ${rows.length} sites…`);

  let done = 0;
  for (const row of rows) {
    const info = classifySite(row.site_name, row.campground_name);
    await sql`
      UPDATE sites SET
        access = ${info.access},
        site_kind = ${info.siteKind},
        is_group = ${info.isGroup},
        is_equestrian = ${info.isEquestrian},
        is_walk_up = ${info.isWalkUp},
        is_day_use = ${info.isDayUse}
      WHERE site_id = ${row.site_id}
    `;
    done++;
    if (done % 500 === 0) console.log(`  ${done}/${rows.length}`);
  }

  console.log(`Backfill complete: ${done} sites updated.`);
  await endDb();
}
```

- [ ] **Step 2: Register the subcommand**

In `src/cli/index.ts`, add the import near the other db-command imports:

```typescript
import { dbBackfillTypesCommand } from './commands/db-backfill-types.js';
```

And add the subcommand inside the `dbCmd` block (after `rebuild-mv`):

```typescript
dbCmd.command('backfill-types')
  .description('Classify existing sites rows by name and set type columns')
  .action(async () => {
    try { await dbBackfillTypesCommand(); }
    catch (e) { console.error(e); process.exit(1); }
  });
```

- [ ] **Step 3: Add the npm script**

In `package.json` `scripts`, after `"db:rebuild-mv"`:

```json
    "db:backfill-types": "tsx src/cli/index.ts db backfill-types",
```

- [ ] **Step 4: Run the backfill against the local DB**

Run: `npm run db:backfill-types`
Expected: "Backfilling…", a count, then "Backfill complete: N sites updated." with no error. Spot-check:
```bash
docker compose exec -T db psql -U postgres -d campbrain -c "SELECT access, count(*) FROM sites GROUP BY access; SELECT count(*) FROM sites WHERE is_walk_up;"
```
Expected: most CA sites `drive_in`, a nonzero walk-up count matching the old hike/bike regex.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/db-backfill-types.ts src/cli/index.ts package.json
git commit -m "feat(db): db:backfill-types — classify existing sites by name"
```

---

### Task 6: Rewrite `buildAvailabilityClauses` for typed columns + new signature

Delete `FILTER_SQL`/`WALK_UP_SQL`; the clause builder now takes structured `access`/`kinds`/`hide`/`minNights` and emits column predicates. The `minNights` gaps-and-islands logic is added in Task 7 (it changes the FROM/JOIN, not just WHERE), so this task handles the column predicates and the new return shape; `minNights` is threaded as an input but its SQL lands in Task 7. Depends on Task 2 (columns).

**Files:**
- Modify: `src/cache/availability-cache.ts` — `FILTER_SQL`, `WALK_UP_SQL`, `AvailabilityClauseResult`, `buildAvailabilityClauses`
- Test: `test/availability-clauses.test.ts` (full rewrite)

- [ ] **Step 1: Rewrite the test for the new signature**

Replace the entire contents of `test/availability-clauses.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildAvailabilityClauses } from '../src/cache/availability-cache.js';

describe('buildAvailabilityClauses', () => {
  it('always includes status, current-date, and is_day_use guards', () => {
    const { clauses, params } = buildAvailabilityClauses({});
    expect(clauses).toContain("a.status = 'available'");
    expect(clauses).toContain('a.date >= CURRENT_DATE');
    expect(clauses).toContain('s.is_day_use = false');
    expect(params).toEqual([]);
  });

  it('adds from/to as ordered parameters', () => {
    const { clauses, params } = buildAvailabilityClauses({ from: '2026-07-01', to: '2026-07-14' });
    expect(clauses).toContain('a.date >= $1');
    expect(clauses).toContain('a.date <= $2');
    expect(params).toEqual(['2026-07-01', '2026-07-14']);
  });

  it('adds the weekend arrival clause when weekendsOnly', () => {
    const { clauses } = buildAvailabilityClauses({ weekendsOnly: true });
    expect(clauses).toContain('EXTRACT(DOW FROM a.date)::int IN (5, 6)');
  });

  it('filters access with = ANY when access values given; omits when empty', () => {
    const empty = buildAvailabilityClauses({ access: [] });
    expect(empty.clauses.some((c) => c.includes('s.access'))).toBe(false);
    const some = buildAvailabilityClauses({ access: ['hike_in', 'boat_in'] });
    expect(some.clauses.some((c) => c.includes("s.access = ANY('{hike_in,boat_in}')"))).toBe(true);
  });

  it('filters site_kind with = ANY (excludes NULL kinds by design)', () => {
    const some = buildAvailabilityClauses({ kinds: ['tent'] });
    expect(some.clauses.some((c) => c.includes("s.site_kind = ANY('{tent}')"))).toBe(true);
  });

  it('translates hide ids into NOT column clauses', () => {
    const { clauses } = buildAvailabilityClauses({ hide: ['group', 'equestrian'] });
    expect(clauses).toContain('NOT s.is_group');
    expect(clauses).toContain('NOT s.is_equestrian');
  });

  it('reports excludeWalkUp when walk_up is hidden, without a clause', () => {
    const r = buildAvailabilityClauses({ hide: ['walk_up'] });
    expect(r.excludeWalkUp).toBe(true);
    expect(r.clauses).not.toContain('NOT s.is_walk_up');
    expect(buildAvailabilityClauses({}).excludeWalkUp).toBe(false);
  });

  it('passes minNights through on the result for the caller to apply', () => {
    expect(buildAvailabilityClauses({ minNights: 2 }).minNights).toBe(2);
    expect(buildAvailabilityClauses({}).minNights).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/availability-clauses.test.ts`
Expected: FAIL — signature is positional `(from, to, filterIds, weekendsOnly)`, not an options object; new fields undefined.

- [ ] **Step 3: Delete the regex maps and rewrite the builder**

In `src/cache/availability-cache.ts`, delete `FILTER_SQL` (lines ~360–366) and `WALK_UP_SQL` (line ~368). Replace the `AvailabilityClauseResult` interface and `buildAvailabilityClauses` with:

```typescript
export type SiteAccess = 'drive_in' | 'hike_in' | 'boat_in';
export type SiteKind = 'tent' | 'hookup' | 'cabin';
export type HideTarget = 'group' | 'equestrian' | 'walk_up';

export interface AvailabilityClauseOptions {
  from?: string | null;
  to?: string | null;
  access?: SiteAccess[];
  kinds?: SiteKind[];
  hide?: HideTarget[];
  minNights?: 1 | 2 | 3;
  weekendsOnly?: boolean;
}

export interface AvailabilityClauseResult {
  clauses: string[];
  params: string[];
  excludeWalkUp: boolean;
  minNights?: 1 | 2 | 3;
}

/**
 * Validates an enum list against the allowed set before inlining into SQL.
 * Returns a Postgres array literal like '{hike_in,boat_in}' or null if empty.
 */
function pgEnumArray(values: string[] | undefined, allowed: readonly string[]): string | null {
  if (!values || values.length === 0) return null;
  const safe = values.filter((v) => allowed.includes(v));
  if (safe.length === 0) return null;
  return `'{${safe.join(',')}}'`;
}

const ACCESS_VALUES = ['drive_in', 'hike_in', 'boat_in'] as const;
const KIND_VALUES = ['tent', 'hookup', 'cabin'] as const;

/** Pure WHERE-clause builder for availability queries (exported for tests). */
export function buildAvailabilityClauses(opts: AvailabilityClauseOptions): AvailabilityClauseResult {
  const { from, to, access, kinds, hide = [], minNights, weekendsOnly = false } = opts;
  const params: string[] = [];
  const clauses: string[] = [
    "a.status = 'available'",
    'a.date >= CURRENT_DATE',
    's.is_day_use = false',
  ];

  if (from) { clauses.push(`a.date >= $${params.length + 1}`); params.push(from); }
  if (to)   { clauses.push(`a.date <= $${params.length + 1}`); params.push(to); }

  if (weekendsOnly) clauses.push('EXTRACT(DOW FROM a.date)::int IN (5, 6)');

  const accessArr = pgEnumArray(access, ACCESS_VALUES);
  if (accessArr) clauses.push(`s.access = ANY(${accessArr})`);

  const kindArr = pgEnumArray(kinds, KIND_VALUES);
  if (kindArr) clauses.push(`s.site_kind = ANY(${kindArr})`);

  let excludeWalkUp = false;
  for (const h of hide) {
    if (h === 'group') clauses.push('NOT s.is_group');
    else if (h === 'equestrian') clauses.push('NOT s.is_equestrian');
    else if (h === 'walk_up') excludeWalkUp = true;
  }

  const result: AvailabilityClauseResult = { clauses, params, excludeWalkUp };
  if (minNights) result.minNights = minNights;
  return result;
}
```

> Enum values are validated against a closed allowlist before inlining, so the inlined array literals are not user-controlled (mirrors the prior "patterns are hardcoded constants" safety note). `from`/`to` stay parameterized.

- [ ] **Step 4: Run the clause test to verify it passes**

Run: `npx vitest run test/availability-clauses.test.ts`
Expected: PASS.

> Note: `getParkAvailabilityCounts`, `searchAvailableStays`, and `findNextAvailableDates` still reference the old constants and signature at this point and will NOT typecheck yet. They are fixed in Tasks 7–9. Do not run a full `npm run typecheck` as a gate until Task 9. (If you want a green intermediate state, do Tasks 6–9 as one logical unit before committing — but the per-task commits below keep history readable; choose based on the executor's preference.)

- [ ] **Step 5: Commit**

```bash
git add src/cache/availability-cache.ts test/availability-clauses.test.ts
git commit -m "refactor(cache): typed-column clause builder; delete FILTER_SQL/WALK_UP_SQL"
```

---

### Task 7: `getParkAvailabilityCounts` — typed columns, walk-up via column, min-stay gaps-and-islands

Rebuild the summary query to consume the new clause result, count walk-up via `s.is_walk_up`, and apply `minNights` via gaps-and-islands. Depends on Task 6.

**Files:**
- Modify: `src/cache/availability-cache.ts` — `getParkAvailabilityCounts`
- Test: `test/min-nights.test.ts` (new) — unit-tests the island helper

Because the gaps-and-islands island detection is the riskiest SQL, extract the per-site island computation into a pure helper that can be unit-tested without a DB, then use it to shape the SQL. The helper answers: *given a sorted list of a single site's available dates, is there an arrival `d` with `minNights` consecutive available dates, `d >= from`, `d+minNights-1 <= to`, and (if weekendsOnly) `DOW(d) ∈ {5,6}`?*

- [ ] **Step 1: Write the failing helper test**

Create `test/min-nights.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { siteMatchesMinStay } from '../src/cache/availability-cache.js';

const opts = (o: Partial<Parameters<typeof siteMatchesMinStay>[1]> = {}) => ({
  minNights: 2 as 1 | 2 | 3,
  from: '2026-06-01',
  to: '2026-06-30',
  weekendsOnly: false,
  ...o,
});

describe('siteMatchesMinStay', () => {
  it('matches a 2-night island inside the window', () => {
    expect(siteMatchesMinStay(['2026-06-05', '2026-06-06'], opts())).toBe(true);
  });
  it('rejects a single isolated night when minNights=2', () => {
    expect(siteMatchesMinStay(['2026-06-05', '2026-06-08'], opts())).toBe(false);
  });
  it('requires the whole stay to end on/before `to`', () => {
    // arrival 06-30 needs 07-01 too — out of window
    expect(siteMatchesMinStay(['2026-06-30', '2026-07-01'], opts({ to: '2026-06-30' }))).toBe(false);
  });
  it('requires the arrival to be on/after `from`', () => {
    expect(siteMatchesMinStay(['2026-05-31', '2026-06-01'], opts({ from: '2026-06-01' }))).toBe(false);
  });
  it('weekendsOnly requires a Fri or Sat arrival', () => {
    // 2026-06-05 is a Friday
    expect(siteMatchesMinStay(['2026-06-05', '2026-06-06'], opts({ weekendsOnly: true }))).toBe(true);
    // 2026-06-09 is a Tuesday — island exists but not a weekend arrival
    expect(siteMatchesMinStay(['2026-06-09', '2026-06-10'], opts({ weekendsOnly: true }))).toBe(false);
  });
  it('finds a 3-night island and rejects a 2-night gap for minNights=3', () => {
    const dates = ['2026-06-12', '2026-06-13', '2026-06-14']; // Fri,Sat,Sun
    expect(siteMatchesMinStay(dates, opts({ minNights: 3, weekendsOnly: true }))).toBe(true);
    expect(siteMatchesMinStay(['2026-06-12', '2026-06-13'], opts({ minNights: 3 }))).toBe(false);
  });
  it('dedupes duplicate dates (overlapping scan windows) before island detection', () => {
    expect(siteMatchesMinStay(['2026-06-05', '2026-06-05', '2026-06-06'], opts())).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/min-nights.test.ts`
Expected: FAIL — `siteMatchesMinStay` not exported.

- [ ] **Step 3: Implement the pure helper**

In `src/cache/availability-cache.ts`, add (near `buildAvailabilityClauses`):

```typescript
export interface MinStayOptions {
  minNights: 1 | 2 | 3;
  from?: string | null;
  to?: string | null;
  weekendsOnly?: boolean;
}

/** DOW of an ISO date: 0=Sun … 5=Fri, 6=Sat (UTC-safe, date-only). */
function isoDow(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * True if the site (given its available dates) supports at least one stay of
 * `minNights` consecutive available nights with arrival d where d >= from,
 * d + minNights - 1 <= to, and (when weekendsOnly) DOW(d) in {5,6}.
 * Dedupes input dates (overlapping scan windows can repeat a date).
 */
export function siteMatchesMinStay(availableDates: string[], opts: MinStayOptions): boolean {
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
    if (ok) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `npx vitest run test/min-nights.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `getParkAvailabilityCounts` to use the typed clauses + apply min-stay**

Replace `getParkAvailabilityCounts` (currently lines ~418–446) with an options-based signature. When `minNights` is set, fetch per-site available dates within the window and apply `siteMatchesMinStay` in TS (keeps the gaps-and-islands logic in the unit-tested helper rather than duplicating it in SQL). Walk-up counting uses the `s.is_walk_up` column:

```typescript
export interface ParkAvailabilityCount {
  parkPageId: string;
  siteCount: number;
  walkUpCount: number;
}

/**
 * Per-facility bookable + walk-up site counts in the date range, with optional
 * access/kind/hide filters and a min-stay (consecutive-nights) constraint.
 * Walk-up (hike/bike) sites never count as bookable; walkUpCount is forced to 0
 * when walk_up is hidden. Counts dedupe sites across overlapping scan windows.
 */
export async function getParkAvailabilityCounts(
  opts: AvailabilityClauseOptions = {},
): Promise<ParkAvailabilityCount[]> {
  const sql = getSql();
  const { clauses, params, excludeWalkUp, minNights } = buildAvailabilityClauses(opts);

  if (!minNights) {
    const bookable = 'COUNT(DISTINCT s.site_id) FILTER (WHERE NOT s.is_walk_up)';
    const walkUp = excludeWalkUp ? '0' : 'COUNT(DISTINCT s.site_id) FILTER (WHERE s.is_walk_up)';
    const rows = await sql.unsafe<{ park_page_id: string; site_count: number; walk_up_count: number }[]>(`
      SELECT s.park_page_id,
             (${bookable})::int AS site_count,
             (${walkUp})::int AS walk_up_count
      FROM availability a
      JOIN sites s ON s.site_id = a.site_id
      WHERE ${clauses.join('\n        AND ')}
      GROUP BY s.park_page_id
      HAVING (${bookable}) > 0${excludeWalkUp ? '' : ` OR (${walkUp}) > 0`}
    `, params);
    return rows.map((r) => ({
      parkPageId: r.park_page_id,
      siteCount: Number(r.site_count),
      walkUpCount: Number(r.walk_up_count),
    }));
  }

  // Min-stay path: pull per-site available dates within the window, then apply the
  // gaps-and-islands helper per site and aggregate per park. The WHERE clause already
  // bounds dates/access/kind/hide and weekend-arrival; we still re-check the stay in TS.
  type Row = { park_page_id: string; site_id: number; is_walk_up: boolean; date: string };
  const rows = await sql.unsafe<Row[]>(`
    SELECT s.park_page_id, s.site_id, s.is_walk_up, a.date::text AS date
    FROM availability a
    JOIN sites s ON s.site_id = a.site_id
    WHERE ${clauses.filter((c) => !c.startsWith('EXTRACT(DOW')).join('\n      AND ')}
    ORDER BY s.park_page_id, s.site_id, a.date
  `, params);

  // Group dates per site, keep park + walk-up flag.
  const bySite = new Map<number, { parkPageId: string; isWalkUp: boolean; dates: string[] }>();
  for (const r of rows) {
    let e = bySite.get(r.site_id);
    if (!e) { e = { parkPageId: r.park_page_id, isWalkUp: r.is_walk_up, dates: [] }; bySite.set(r.site_id, e); }
    e.dates.push(r.date);
  }

  const stay = { minNights, from: opts.from ?? null, to: opts.to ?? null, weekendsOnly: opts.weekendsOnly ?? false };
  const perPark = new Map<string, { siteCount: number; walkUpCount: number }>();
  for (const { parkPageId, isWalkUp, dates } of bySite.values()) {
    if (!siteMatchesMinStay(dates, stay)) continue;
    let p = perPark.get(parkPageId);
    if (!p) { p = { siteCount: 0, walkUpCount: 0 }; perPark.set(parkPageId, p); }
    if (isWalkUp) { if (!excludeWalkUp) p.walkUpCount++; }
    else p.siteCount++;
  }

  return [...perPark.entries()]
    .map(([parkPageId, c]) => ({ parkPageId, ...c }))
    .filter((c) => c.siteCount > 0 || c.walkUpCount > 0);
}
```

> The weekend-arrival DOW filter is dropped from the min-stay SQL (we filter on the *arrival* date in the helper, not on every available date — a Saturday-arrival 2-night stay legitimately includes Sunday). The non-min-stay path keeps the SQL DOW filter because it has no concept of arrival vs night. **OPEN QUESTION 4 reminder:** an island truncated at a window edge may miss a stay whose far night wasn't scanned; this matches the existing MV's 2-night boundary behavior. The min-nights test file documents the in-window case.

- [ ] **Step 6: Run the min-nights + clause tests + typecheck of this file's exports**

Run: `npx vitest run test/min-nights.test.ts test/availability-clauses.test.ts`
Expected: PASS. (Full `npm run typecheck` still fails until Tasks 8–9 fix callers and the search query.)

- [ ] **Step 7: Commit**

```bash
git add src/cache/availability-cache.ts test/min-nights.test.ts
git commit -m "feat(cache): summary counts on typed columns + min-stay gaps-and-islands"
```

---

### Task 8: `searchAvailableStays` + `findNextAvailableDates` — typed columns

Replace the name-regex filtering in the `/explore` search and the fallback "next available" query with typed-column predicates. Depends on Task 6. NOTE per Open Question 3: `/explore` keeps its exact-range stay semantics; only the filter *predicates* change (access/kinds/hide), not the stay shape.

**Files:**
- Modify: `src/cache/availability-cache.ts` — `searchAvailableStays`, `findNextAvailableDates`

- [ ] **Step 1: Change `searchAvailableStays` to accept structured filters and emit column predicates**

Update the `searchAvailableStays` params type and the filter-clause build (currently lines ~685–743). Replace `filterIds?: string[]` with the structured options, build predicates from the typed columns, and compute `is_walk_up` from the column instead of the inline regex:

```typescript
export async function searchAvailableStays(params: {
  from: string;
  to: string;
  access?: SiteAccess[];
  kinds?: SiteKind[];
  hide?: HideTarget[];
}): Promise<SearchParkResult[]> {
  const sql = getSql();
  const { from, to, access, kinds, hide = [] } = params;
  const nightCount = dayjs(to).diff(dayjs(from), 'day');
  if (nightCount < 1) return [];

  const filterClauses: string[] = ['s.is_day_use = false'];
  const accessArr = pgEnumArray(access, ACCESS_VALUES);
  if (accessArr) filterClauses.push(`s.access = ANY(${accessArr})`);
  const kindArr = pgEnumArray(kinds, KIND_VALUES);
  if (kindArr) filterClauses.push(`s.site_kind = ANY(${kindArr})`);
  if (hide.includes('group')) filterClauses.push('NOT s.is_group');
  if (hide.includes('equestrian')) filterClauses.push('NOT s.is_equestrian');
  const excludeWalkUp = hide.includes('walk_up');
  if (excludeWalkUp) filterClauses.push('NOT s.is_walk_up');
  const filterWhere = `AND ${filterClauses.join(' AND ')}`;

  type Row = {
    park_page_id: string;
    park_name: string;
    campground_name: string;
    nightly_fee: string | null;
    booking_url: string | null;
    site_name: string;
    is_walk_up: boolean;
  };

  const rows = await sql.unsafe<Row[]>(`
    SELECT
      p.park_page_id,
      p.park_name,
      cg.campground_name,
      cg.nightly_fee::text,
      cg.booking_url,
      s.site_name,
      s.is_walk_up
    FROM sites s
    JOIN campgrounds cg
      ON cg.provider_id = s.provider_id
      AND cg.park_page_id = s.park_page_id
      AND cg.campground_name = s.campground_name
    JOIN parks p
      ON p.provider_id = s.provider_id
      AND p.park_page_id = s.park_page_id
    WHERE s.site_id IN (
      SELECT a.site_id
      FROM availability a
      WHERE a.date >= $1::date
        AND a.date < $2::date
        AND a.status = 'available'
      GROUP BY a.site_id
      HAVING COUNT(DISTINCT a.date) = $3::int
    )
      ${filterWhere}
    ORDER BY p.park_name, cg.campground_name, s.site_name
  `, [from, to, String(nightCount)]);
```

(The row-grouping loop below this — building parks → campgrounds and splitting on `row.is_walk_up` — is unchanged.)

- [ ] **Step 2: Change `findNextAvailableDates` to use the walk-up column**

In `findNextAvailableDates` (currently lines ~792–836), replace the inline regex clause:

```typescript
    `NOT (s.site_name ~* 'hike\\s*[/&]?\\s*bike')`,
```

with the column predicate plus the day-use guard:

```typescript
    'NOT s.is_walk_up',
    's.is_day_use = false',
```

- [ ] **Step 3: Run the full test suite + typecheck**

Run: `npm run typecheck`
Expected: now PASS — but `getParkAvailabilityCounts` callers (the summary API) and `searchAvailableStays` caller (`/api/search`) still pass the old args. Those are Task 9/10. If `npm run typecheck` reports errors ONLY in `web/app/api/**`, that is expected; proceed to Task 9. Cache-module-internal references should be clean.

Run: `npx vitest run`
Expected: All non-API suites PASS. (API route tests, if any, may fail until Task 9–10. Note which suites fail and confirm they are only the routes being updated next.)

- [ ] **Step 4: Commit**

```bash
git add src/cache/availability-cache.ts
git commit -m "refactor(cache): /explore search + fallback use typed site columns"
```

---

### Task 9: Update the materialized view (drop name regex, add is_day_use guard)

The MV's `avail` CTE computes `is_walk_up` from an inline regex and includes day-use sites. Switch to the persisted columns and exclude day-use. MV schema change → `db:rebuild-mv` required after. Depends on Task 2 (columns) + Task 5 (backfill, so existing rows are classified before refresh).

**Files:**
- Modify: `src/cache/db.ts` — `MV_DEFINITION`

- [ ] **Step 1: Update the MV definition**

In `src/cache/db.ts`, in `MV_DEFINITION`, change the `avail` CTE so `is_walk_up` reads the column and day-use sites are excluded:

```sql
  WITH avail AS (
    SELECT
      s.provider_id,
      s.park_page_id,
      s.campground_name,
      s.site_name,
      s.site_id,
      a.date,
      s.is_walk_up
    FROM availability a
    JOIN sites s ON s.site_id = a.site_id
    WHERE a.status = 'available' AND a.date >= CURRENT_DATE AND s.is_day_use = false
  ),
```

(The `stays` CTE and the final SELECT are unchanged — they already reference `a.is_walk_up`.)

- [ ] **Step 2: Rebuild + refresh the MV against the local DB**

Run: `npm run db:rebuild-mv`
Expected: "Dropping and recreating mv_available_stays…", "Refreshing data…", "Done." with no error.

- [ ] **Step 3: Spot-check the MV no longer leaks day-use into available_sites**

Run:
```bash
docker compose exec -T db psql -U postgres -d campbrain -c "SELECT count(*) FROM mv_available_stays WHERE available_sites && (SELECT array_agg(site_name) FROM sites WHERE is_day_use);"
```
Expected: `0` (no day-use site name appears in any `available_sites` array). If nonzero, re-run `db:backfill-types` then `db:rebuild-mv`.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors from `db.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/cache/db.ts
git commit -m "feat(db): MV reads is_walk_up column and excludes day-use sites"
```

---

### Task 10: API routes — adopt `access`/`kinds`/`hide`/`minNights`; drop `filters`

Three routes parse the new params and call the new query signatures. Depends on Tasks 7–8. The detail route additionally filters server-side (Task 12 removes the client-side `passesSiteFilters`; this task makes the detail API capable of it).

**Files:**
- Modify: `web/app/api/map/availability/summary/route.ts`
- Modify: `web/app/api/map/availability/route.ts`
- Modify: `web/app/api/search/route.ts`
- Modify: `web/lib/availability-cache.ts` — re-export the new types (`SiteAccess`, `SiteKind`, `HideTarget`, `AvailabilityClauseOptions`) for the routes

- [ ] **Step 1: Re-export the new types from the web shim**

In `web/lib/availability-cache.ts`, add to the type re-export line:

```typescript
export type { SiteAccess, SiteKind, HideTarget, AvailabilityClauseOptions } from '../../src/cache/availability-cache';
```

- [ ] **Step 2: Add a shared param parser**

Create `web/lib/filter-params.ts`:

```typescript
import type { SiteAccess, SiteKind, HideTarget } from './availability-cache';

const ACCESS = new Set<SiteAccess>(['drive_in', 'hike_in', 'boat_in']);
const KINDS = new Set<SiteKind>(['tent', 'hookup', 'cabin']);
const HIDE = new Set<HideTarget>(['group', 'equestrian', 'walk_up']);

function csv<T extends string>(raw: string | null, allowed: Set<T>): T[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter((s): s is T => allowed.has(s as T));
}

export function parseFilterParams(sp: URLSearchParams): {
  access: SiteAccess[]; kinds: SiteKind[]; hide: HideTarget[]; minNights?: 1 | 2 | 3;
} {
  const access = csv(sp.get('access'), ACCESS);
  const kinds = csv(sp.get('kinds'), KINDS);
  const hide = csv(sp.get('hide'), HIDE);
  const mnRaw = Number(sp.get('minNights'));
  const minNights = mnRaw === 1 || mnRaw === 2 || mnRaw === 3 ? mnRaw : undefined;
  return { access, kinds, hide, minNights };
}
```

- [ ] **Step 3: Rewrite the summary route**

Replace `web/app/api/map/availability/summary/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getParkAvailabilityCounts } from '../../../../../lib/availability-cache';
import { parseFilterParams } from '../../../../../lib/filter-params';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') ?? null;
  const to = searchParams.get('to') ?? null;
  const weekendsOnly = searchParams.get('weekendsOnly') === 'true';
  const { access, kinds, hide, minNights } = parseFilterParams(searchParams);

  const parks = await getParkAvailabilityCounts({ from, to, access, kinds, hide, minNights, weekendsOnly });
  return NextResponse.json({ parks });
}
```

- [ ] **Step 4: Rewrite the `/api/search` route to pass structured filters**

In `web/app/api/search/route.ts`, replace the `filtersParam`/`filterIds` parsing (lines ~48–49) and the `searchAvailableStays({ from, to, filterIds })` call (line ~86):

```typescript
  const { access, kinds, hide } = parseFilterParams(searchParams);
```
```typescript
    const results: SearchParkResult[] = await searchAvailableStays({ from, to, access, kinds, hide });
```

Add the import at the top:

```typescript
import { parseFilterParams } from '../../../lib/filter-params';
```

- [ ] **Step 5: Make the detail route filter server-side**

In `web/app/api/map/availability/route.ts`, the panel currently returns everything and the client filters. Add server-side site filtering by classifying/marking each site. The simplest correct approach: parse the same params and filter the site arrays in the handler using the classifier + min-stay semantics already available. Add the import:

```typescript
import { parseFilterParams } from '../../../../lib/filter-params';
import { classifySite } from '../../../../../src/catalog/site-classifier';
```

After reading `from`/`to`, parse filters:

```typescript
  const { access, kinds, hide, minNights } = parseFilterParams(req.nextUrl.searchParams);
```

Add a predicate used wherever site names are emitted into `sites` / tier arrays (replace the existing `isWalkUpSite`-only split). A site passes the access/kind/hide gate when:

```typescript
  function passesTaxonomy(siteName: string, cgName: string): boolean {
    const info = classifySite(siteName, cgName);
    if (info.isDayUse) return false;
    if (access.length > 0 && !access.includes(info.access)) return false;
    if (kinds.length > 0 && (info.siteKind === null || !kinds.includes(info.siteKind))) return false;
    if (hide.includes('group') && info.isGroup) return false;
    if (hide.includes('equestrian') && info.isEquestrian) return false;
    if (hide.includes('walk_up') && info.isWalkUp) return false;
    return true;
  }
```

Apply `passesTaxonomy` in `buildDateSiteMap` consumption and in the weekend tier builder so filtered sites never reach the response. The `minNights` constraint on the detail panel is applied by the existing tier logic (3-night / 2-night arrays already encode consecutive nights); ensure the response still returns the tier arrays so the client can render `max(minNights,1)`-night Book links (Task 12 handles the client copy).

> Implementation note for the executor: the cleanest seam is to filter inside `buildDateSiteMap` — skip any `site` whose name fails `passesTaxonomy(site.name, cg.name)` before adding it to `dateMap`. That single change filters both the dates list and the weekend tiers, because both derive from `dateMap`. Keep `splitWalkUp` for the walk-up display split.

- [ ] **Step 6: Run typecheck + full suite**

Run: `npm run typecheck && npx vitest run`
Expected: PASS across the board now (no remaining references to the old positional signature or `filterIds`).

- [ ] **Step 7: Manual API smoke check**

Run `npm run dev` in one terminal, then:
```bash
curl -s 'http://localhost:3001/api/map/availability/summary?from=2026-06-12&to=2026-06-15&access=drive_in&hide=walk_up&minNights=2&weekendsOnly=true' | head -c 400
curl -s 'http://localhost:3001/api/search?from=2026-06-12&to=2026-06-14&access=hike_in' | head -c 400
```
Expected: valid JSON, `parks` arrays; `minNights=2` returns fewer/equal parks than `minNights=1`; no 500s.

- [ ] **Step 8: Commit**

```bash
git add web/app/api/map/availability/summary/route.ts web/app/api/map/availability/route.ts web/app/api/search/route.ts web/lib/availability-cache.ts web/lib/filter-params.ts
git commit -m "feat(api): summary/detail/search accept access/kinds/hide/minNights; drop filters"
```

---

### Task 11: CHUNK 1 VERIFICATION GATE

Do not proceed to Chunk 2 until every check passes. This is the engine acceptance gate.

- [ ] **Step 1: Clean DB rebuild path runs end-to-end**

Run, in order:
```bash
npm run db:init
npm run db:backfill-types
npm run db:rebuild-mv
```
Expected: each completes with no error.

- [ ] **Step 2: Typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all ~340+ tests pass (new: `site-classifier`, `min-nights`, rewritten `availability-clauses`).

- [ ] **Step 3: API parity smoke**

With `npm run dev` running, confirm the three endpoints from Task 10 Step 7 return coherent JSON and that toggling `minNights` and `hide=walk_up` changes counts in the expected direction.

- [ ] **Step 4: Rec.gov rescan milestone (USER ACTION — document, do not block on)**

State explicitly in the handoff: *"Restart `npm run worker` to repopulate Rec.gov `campsite_type`-based classifications. Until a full scan cycle completes, Rec.gov rows are classified by name fallback (mostly `drive_in`). CA classifications are accurate immediately from the backfill."*

- [ ] **Step 5: Commit any gate fixes, then tag the engine as done**

```bash
git commit --allow-empty -m "chore: chunk 1 (engine) verification gate passed"
```

---

# CHUNK 2 — UI

> Begins once Task 10's API shapes are merged. Final visual verification (Task 18) happens after a fresh scan.

---

### Task 12: Shared taxonomy module + retire the old filter list

Define the pill groups once; both `/map` and `/explore` consume them. `isWalkUpSite` moves to the classifier (Task 1) and is re-exported here. Depends on Task 1.

**Files:**
- Create: `web/lib/site-taxonomy.ts`
- Modify: `web/lib/site-filters.ts` — remove `AVAILABLE_FILTERS`, `SiteFilter`, `getFilter`, `passesSiteFilters`, `campgroundPassesFilters`, and the local `isWalkUpSite`; re-export `isWalkUpSite` from the classifier (or delete the file and update imports — see Step 3)
- Test: `test/site-taxonomy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/site-taxonomy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ACCESS_GROUP, KIND_GROUP, HIDE_GROUP, taxonomyToParams, isWalkUpSite } from '../web/lib/site-taxonomy.js';

describe('site taxonomy groups', () => {
  it('exposes the three access options', () => {
    expect(ACCESS_GROUP.options.map((o) => o.id)).toEqual(['drive_in', 'hike_in', 'boat_in']);
  });
  it('exposes the three site kinds', () => {
    expect(KIND_GROUP.options.map((o) => o.id)).toEqual(['tent', 'hookup', 'cabin']);
  });
  it('exposes the three hide targets', () => {
    expect(HIDE_GROUP.options.map((o) => o.id)).toEqual(['group', 'equestrian', 'walk_up']);
  });
  it('maps selected state to query params, omitting empties', () => {
    const qp = taxonomyToParams({ access: ['drive_in'], kinds: [], hide: ['walk_up'] });
    expect(qp.get('access')).toBe('drive_in');
    expect(qp.get('hide')).toBe('walk_up');
    expect(qp.has('kinds')).toBe(false);
  });
  it('re-exports isWalkUpSite from the classifier', () => {
    expect(isWalkUpSite('Hike/Bike 1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/site-taxonomy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the taxonomy module**

Create `web/lib/site-taxonomy.ts`:

```typescript
export { isWalkUpSite } from '../../src/catalog/site-classifier';
import type { SiteAccess, SiteKind, HideTarget } from './availability-cache';

export interface TaxonomyOption<T extends string> { id: T; label: string }
export interface TaxonomyGroup<T extends string> {
  param: 'access' | 'kinds' | 'hide';
  label: string;
  variant: 'select' | 'hide';
  options: TaxonomyOption<T>[];
}

export const ACCESS_GROUP: TaxonomyGroup<SiteAccess> = {
  param: 'access',
  label: 'Access',
  variant: 'select',
  options: [
    { id: 'drive_in', label: 'Drive-in' },
    { id: 'hike_in', label: 'Hike-in' },
    { id: 'boat_in', label: 'Boat-in' },
  ],
};

export const KIND_GROUP: TaxonomyGroup<SiteKind> = {
  param: 'kinds',
  label: 'Site kind',
  variant: 'select',
  options: [
    { id: 'tent', label: 'Tent' },
    { id: 'hookup', label: 'Hookups (RV)' },
    { id: 'cabin', label: 'Cabin / yurt' },
  ],
};

export const HIDE_GROUP: TaxonomyGroup<HideTarget> = {
  param: 'hide',
  label: 'Hide',
  variant: 'hide',
  options: [
    { id: 'group', label: 'Group' },
    { id: 'equestrian', label: 'Equestrian' },
    { id: 'walk_up', label: 'Walk-up (first-come)' },
  ],
};

export interface TaxonomyState {
  access: SiteAccess[];
  kinds: SiteKind[];
  hide: HideTarget[];
}

export const EMPTY_TAXONOMY: TaxonomyState = { access: [], kinds: [], hide: [] };

export function taxonomyToParams(state: TaxonomyState): URLSearchParams {
  const qp = new URLSearchParams();
  if (state.access.length) qp.set('access', state.access.join(','));
  if (state.kinds.length) qp.set('kinds', state.kinds.join(','));
  if (state.hide.length) qp.set('hide', state.hide.join(','));
  return qp;
}

export function isTaxonomyDefault(state: TaxonomyState): boolean {
  return state.access.length === 0 && state.kinds.length === 0 && state.hide.length === 0;
}
```

- [ ] **Step 4: Run the taxonomy test to verify it passes**

Run: `npx vitest run test/site-taxonomy.test.ts`
Expected: PASS.

- [ ] **Step 5: Gut `web/lib/site-filters.ts`**

Replace the entire contents of `web/lib/site-filters.ts` with a thin re-export so any straggler import does not break compilation (the next tasks remove the real importers):

```typescript
export { isWalkUpSite } from '../../src/catalog/site-classifier';
```

> The detail route already imports `isWalkUpSite` from `../../../../lib/site-filters` — this keeps that import valid. Tasks 13–14 remove `passesSiteFilters`/`AVAILABLE_FILTERS` importers, so deleting them here is safe once those tasks land. Run `npm run typecheck` after this step; if it reports `passesSiteFilters`/`AVAILABLE_FILTERS` not found, those are the importers Tasks 13–14 fix — proceed.

- [ ] **Step 6: Commit**

```bash
git add web/lib/site-taxonomy.ts web/lib/site-filters.ts test/site-taxonomy.test.ts
git commit -m "feat(web): shared site-taxonomy module; retire site-filters filter list"
```

---

### Task 13: Taxonomy filter component (pills)

A reusable component rendering the three groups as pills: green for selected `select` groups, slate + eye-off for active `hide` pills. Replaces `SiteFilterPanel`. Depends on Task 12.

**Files:**
- Replace: `web/app/components/SiteFilterPanel.tsx` with a taxonomy renderer (keep the filename so importers need minimal churn, OR create `TaxonomyFilterGroups.tsx` and update both importers — this plan keeps the filename and changes the props)

- [ ] **Step 1: Rewrite SiteFilterPanel to render taxonomy groups**

Replace `web/app/components/SiteFilterPanel.tsx`:

```tsx
'use client';

import { ACCESS_GROUP, KIND_GROUP, HIDE_GROUP } from '../../lib/site-taxonomy';
import type { TaxonomyState } from '../../lib/site-taxonomy';
import type { SiteAccess, SiteKind, HideTarget } from '../../lib/availability-cache';

interface Props {
  state: TaxonomyState;
  onChange: (next: TaxonomyState) => void;
  /** Which groups to render. Defaults to all three. */
  groups?: Array<'access' | 'kinds' | 'hide'>;
}

function toggle<T extends string>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export default function SiteFilterPanel({ state, onChange, groups = ['access', 'kinds', 'hide'] }: Props) {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {groups.includes('access') && (
        <Group label={ACCESS_GROUP.label}>
          {ACCESS_GROUP.options.map((o) => (
            <Pill
              key={o.id}
              label={o.label}
              active={state.access.includes(o.id)}
              hide={false}
              onClick={() => onChange({ ...state, access: toggle<SiteAccess>(state.access, o.id) })}
            />
          ))}
        </Group>
      )}
      {groups.includes('kinds') && (
        <Group label={KIND_GROUP.label}>
          {KIND_GROUP.options.map((o) => (
            <Pill
              key={o.id}
              label={o.label}
              active={state.kinds.includes(o.id)}
              hide={false}
              onClick={() => onChange({ ...state, kinds: toggle<SiteKind>(state.kinds, o.id) })}
            />
          ))}
        </Group>
      )}
      {groups.includes('hide') && (
        <Group label={HIDE_GROUP.label}>
          {HIDE_GROUP.options.map((o) => (
            <Pill
              key={o.id}
              label={o.label}
              active={state.hide.includes(o.id)}
              hide
              onClick={() => onChange({ ...state, hide: toggle<HideTarget>(state.hide, o.id) })}
            />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function Pill({ label, active, hide, onClick }: { label: string; active: boolean; hide: boolean; onClick: () => void }) {
  const cls = active ? (hide ? 'btn-slate' : 'btn-primary') : 'btn-ghost';
  return (
    <button type="button" className={`btn btn-sm ${cls}`} onClick={onClick} style={active ? { fontWeight: 700 } : {}}>
      {active && hide ? '🚫 ' : ''}{label}
    </button>
  );
}
```

> Design note: the spec calls for "slate + eye-off icon" for active Hide pills. If a `btn-slate` class does not exist in the design system, the frontend-developer should add it (slate background, muted text) to `web/app/globals.css` or equivalent, and swap the `🚫` placeholder for the project's eye-off glyph/icon. Flag to the Architect if a token is missing — do not invent a one-off color.

- [ ] **Step 2: Typecheck (expect importer errors only in MapClient/FindCampsitesClient)**

Run: `npm run typecheck`
Expected: errors only where `SiteFilterPanel` is used with the old `activeFilters`/`onChange` string-array props (MapClient, FindCampsitesClient). Those are Tasks 14–15.

- [ ] **Step 3: Commit**

```bash
git add web/app/components/SiteFilterPanel.tsx
git commit -m "feat(web): SiteFilterPanel renders taxonomy pill groups"
```

---

### Task 14: `/map` MapClient — four-row filter bar, presets, weekends-only pill, min-stay, summary + reset, server-side detail filtering

The largest UI change. Depends on Tasks 10, 12, 13. Implements spec Part 2 Rows 1–4 + park-finder wiring (Task 15 supplies the finder component).

**Files:**
- Modify: `web/app/map/MapClient.tsx`

This task is broad; execute it as the following ordered sub-steps, running `npm run typecheck` after each, and committing once at the end. Each sub-step is small.

- [ ] **Step 1: Replace filter state with the new model**

Swap the per-control state. Remove `activeFilters: string[]`, `nightCount`, `tab`. Add:

```tsx
import { EMPTY_TAXONOMY, taxonomyToParams, isTaxonomyDefault } from '../../lib/site-taxonomy';
import type { TaxonomyState } from '../../lib/site-taxonomy';
```
```tsx
  const [taxonomy, setTaxonomy] = useState<TaxonomyState>(EMPTY_TAXONOMY);
  const [minNights, setMinNights] = useState<1 | 2 | 3 | null>(null); // null = Any
  const [preset, setPreset] = useState<'this_weekend' | 'next_2_weeks' | 'next_month' | 'anytime'>('this_weekend');
  const [weekendsOnly, setWeekendsOnly] = useState(true);
```

Drop `tab`; the panel layout is now driven by `weekendsOnly` (weekend tiers when on, date rows when off).

- [ ] **Step 2: Initialize default dates from the This-weekend preset and lock weekends-only under it**

Keep the mount effect that sets `availFrom`/`availTo` from `upcomingWeekendRange`. Add a helper that applies a preset to the date inputs:

```tsx
  function applyPreset(p: typeof preset) {
    setPreset(p);
    if (p === 'this_weekend') {
      const { from, to } = upcomingWeekendRange(new Date());
      setAvailFrom(from); setAvailTo(to); setWeekendsOnly(true);
    } else if (p === 'next_2_weeks') {
      setAvailFrom(todayIso()); setAvailTo(addDaysIso(todayIso(), 14));
    } else if (p === 'next_month') {
      setAvailFrom(todayIso()); setAvailTo(addDaysIso(todayIso(), 30));
    } else { // anytime — no clamp: from today, no `to`
      setAvailFrom(todayIso()); setAvailTo('');
    }
  }
```

The Weekends-only pill is disabled (locked on) when `preset === 'this_weekend'`. Manual date edits set `preset` to whichever preset matches the new range or none (reuse existing equality logic against `upcomingWeekendRange`, `+14`, `+30`).

- [ ] **Step 3: Send the new params on the summary fetch**

In the summary-fetch effect, replace the param build:

```tsx
      const params = new URLSearchParams(taxonomyToParams(taxonomy));
      if (availFrom) params.set('from', availFrom);
      if (availTo) params.set('to', availTo);
      if (weekendsOnly) params.set('weekendsOnly', 'true');
      if (minNights) params.set('minNights', String(minNights));
```

Update the effect deps to `[availFrom, availTo, taxonomy, weekendsOnly, minNights]`. Crucially: because `Anytime` sends `from=today` with no `to`, `availByFacility` is ALWAYS set (never `null` from a cleared range) — remove the `if (!availFrom && !availTo) { setAvailByFacility(null); return; }` early-return so pins always reflect a real query. (See spec Row 1: the all-green `availByFacility === null` state is now unreachable.)

- [ ] **Step 4: Render Row 1 (When)**

Replace the old park dropdown + Weekends/All-dates tab + date-chip cluster with: horizon preset pills (`This weekend` · `Next 2 weeks` · `Next month` · `Anytime`, exactly one active via `preset`), the two native date inputs, and the `Weekends only` pill (disabled when `preset === 'this_weekend'`). Remove the `✕` clear button entirely. The park dropdown is removed here (Task 15 adds the finder overlay).

- [ ] **Step 5: Render Row 2 (Min stay + Near)**

Min-stay pills `Any` · `1 night` · `2 nights` · `3 nights` setting `minNights` to `null|1|2|3`. Keep the existing Near/location/distance block, but render distance pills disabled (reduced opacity, no error toast) until `resolvedLocation` is set — remove the `setGeocodeError('Enter a city first…')` path; instead give the pills `disabled` + `opacity: .5` when `!resolvedLocation`.

- [ ] **Step 6: Render Row 3 (taxonomy)**

```tsx
        <SiteFilterPanel state={taxonomy} onChange={setTaxonomy} />
```

- [ ] **Step 7: Render Row 4 (summary sentence + Reset)**

Compose a plain-language sentence from active state, omitting default clauses. Add a pure builder in MapClient (or a small `web/lib/summary-sentence.ts` if preferred — keep it testable):

```tsx
  const summarySentence = useMemo(() => {
    const matchCount = filteredParks.length;
    const total = parks.length;
    const parts: string[] = [];
    if (minNights) parts.push(`${minNights}-night`);
    if (taxonomy.access.length === 1) parts.push(ACCESS_LABEL[taxonomy.access[0]!]);
    if (weekendsOnly) parts.push('weekend');
    parts.push('stay');
    const dateClause = availTo ? ` ${formatDate(availFrom)} – ${formatDate(availTo)}` : ' anytime';
    const nearClause = resolvedLocation && distanceMiles ? ` within ${distanceMiles} mi of ${resolvedLocation.name}` : '';
    return `${matchCount} of ${total} parks have a ${parts.join(' ')}${dateClause}${nearClause}`;
  }, [filteredParks.length, parks.length, minNights, taxonomy.access, weekendsOnly, availFrom, availTo, resolvedLocation, distanceMiles]);
```

(`ACCESS_LABEL` is a small local `Record<SiteAccess,string>`.) Render this single line — it REPLACES both the old `{filteredParks.length} / {parks.length} parks` span and the `{filteredParks.length} match` span (fixing the double-count bug). Render `Reset` only when state differs from default:

```tsx
  const isDefaultState =
    preset === 'this_weekend' && weekendsOnly && minNights === null &&
    isTaxonomyDefault(taxonomy) && resolvedLocation === null;
```

`handleResetFilters` now restores defaults (This weekend, weekends-only on, min stay Any, empty taxonomy, no location) rather than clearing to empty — and re-applies the This-weekend preset dates. The park finder selection is NOT reset (spec: park finder is not part of Reset).

- [ ] **Step 8: Remove client-side `passesSiteFilters` from the detail panel**

Delete the `import { passesSiteFilters } from '../../lib/site-filters'`. The `DetailPanel` no longer takes `activeFilters`/`nightCount`/`tab`; instead it takes `taxonomy`, `minNights`, `weekendsOnly`, and passes them to the detail fetch so the server filters (Task 10 Step 5). Replace the `filteredDates`/`filteredWeekends` `useMemo`s that called `passesSiteFilters` with direct consumption of the already-filtered server response (`data.nextAvailableDates` / `data.nextAvailableWeekends` rendered as-is, choosing tiers by `minNights`). Append the taxonomy/minNights params onto the detail fetch URL in `useParkAvailability`:

```tsx
    const tax = taxonomyToParams(taxonomy);
    for (const [k, v] of tax) params.set(k, v);
    if (weekendsOnly) params.set('weekendsOnly', 'true');
    if (minNights) params.set('minNights', String(minNights));
```

Drive the panel layout off `weekendsOnly` (tiers when on, date rows when off) instead of the removed `tab`.

- [ ] **Step 9: Book-link nights for the date-rows view**

In the date-rows (`weekendsOnly` off) view, Book links inject `max(minNights ?? 1, 1)` nights (spec Row 2). Update `DateRow`'s `nights` prop to `Math.max(minNights ?? 1, 1)`.

- [ ] **Step 10: Typecheck + dev-load**

Run: `npm run typecheck`
Expected: clean. Then `npm run dev` and load `http://localhost:3001/map`:
- No console errors / hydration warnings.
- Default load: This-weekend preset active, Weekends-only locked on, no green-styled default controls (taxonomy/min-stay show no green), NO Reset button.
- Changing Min stay to 2 nights changes pin counts.
- Switching to Anytime keeps real (non-all-green) counts.

- [ ] **Step 11: Commit**

```bash
git add web/app/map/MapClient.tsx
git commit -m "feat(map): four-row filter bar — presets, weekends-only, min-stay, summary sentence, server-side detail filtering"
```

---

### Task 15: Park finder overlay

The "All parks" dropdown leaves the bar; a type-ahead search box overlays the map (top-right). Selecting opens the panel + flies to the park (selection ≠ filter). Depends on Task 14 (consumes `setSelectedPark`).

**Files:**
- Create: `web/app/map/ParkFinder.tsx`
- Modify: `web/app/map/MapClient.tsx` — render `<ParkFinder>` inside `.map-container`

- [ ] **Step 1: Implement the finder**

Create `web/app/map/ParkFinder.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import type { MapPark } from '../api/map/catalog/route';

interface Props {
  parks: MapPark[];
  onSelect: (park: MapPark) => void;
}

export default function ParkFinder({ parks, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return parks
      .filter((p) => p.parkName.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, parks]);

  return (
    <div className="park-finder">
      <input
        className="form-input"
        placeholder="Find a park…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: 220, fontSize: 12, padding: '6px 10px' }}
      />
      {matches.length > 0 && (
        <ul className="park-finder-results">
          {matches.map((p) => (
            <li key={p.parkPageId}>
              <button
                type="button"
                onClick={() => { onSelect(p); setQuery(''); }}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'var(--text)', padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}
              >
                {p.parkName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Add minimal CSS (the frontend-developer places this in the map's stylesheet): `.park-finder` absolutely positioned top-right over the map with a high z-index; `.park-finder-results` a bordered dropdown.

- [ ] **Step 2: Wire it into MapClient**

Inside the `.map-container` div in `MapClient`, after `<LeafletMap … />`, render:

```tsx
          <ParkFinder parks={sortedParks} onSelect={(p) => setSelectedPark(p)} />
```

Add the import. Remove the now-dead `selectedParkId` state and the old `<select>` (already removed in Task 14 Step 4 if done there — verify it is gone).

- [ ] **Step 3: Typecheck + dev-load**

Run: `npm run typecheck && npm run dev`
Expected: typing a park name shows up to 8 matches; clicking one opens the detail panel and pans/flies to it; the finder is NOT reset by Reset.

- [ ] **Step 4: Commit**

```bash
git add web/app/map/ParkFinder.tsx web/app/map/MapClient.tsx
git commit -m "feat(map): park finder overlay replaces the All-parks dropdown"
```

---

### Task 16: Empty-state + weekends copy fixes

Fix the panel empty states so they account for `minNights` and the no-weekend-days case. Depends on Task 14.

**Files:**
- Modify: `web/app/map/MapClient.tsx` — `DetailPanel` empty-state branches

- [ ] **Step 1: Min-stay-aware "next opening"**

In the empty-state branches that show `Next opening: {formatDate(data.earliestAvailableDate)}`, only show that hint when `minNights` is null or 1. When `minNights >= 2`, replace with a neutral line: `No {minNights}-night stay in this range.` (the global `earliestAvailableDate` is a 1-night signal and would mislead at minNights 2/3).

- [ ] **Step 2: No-weekend-days copy**

When `weekendsOnly` is on and the selected date range contains no Friday or Saturday, show `No weekend days in this date range.` instead of the generic all-grey "no availability". Detect by scanning `[availFrom, availTo]` for any DOW ∈ {5,6} (a small inline loop using `isoDow`/`addDaysIso` helpers, or reuse the existing `isWeekendArrival`).

- [ ] **Step 3: Dev-load verification**

Run: `npm run dev`, set Min stay 2 on a fully-booked park → empty state says "No 2-night stay…", not a 1-night "Next opening". Set Weekends-only + a Mon–Wed range → "No weekend days in this date range."

- [ ] **Step 4: Commit**

```bash
git add web/app/map/MapClient.tsx
git commit -m "fix(map): min-stay-aware empty states + no-weekend-days copy"
```

---

### Task 17: `/explore` parity — taxonomy panel + new params

`/explore` swaps the old `SiteFilterPanel` usage for the Access/Site-kind/Hide groups (no When/Near rows — explore keeps its date pickers + region chips) and sends `access`/`kinds`/`hide`. Depends on Tasks 12, 13, 10 (search route).

**Files:**
- Modify: `web/app/explore/FindCampsitesClient.tsx`

- [ ] **Step 1: Replace the filter state + props**

Replace `const [activeFilters, setActiveFilters] = useState<string[]>([])` and `showWalkUp` derivation with:

```tsx
import { EMPTY_TAXONOMY, taxonomyToParams } from '../../lib/site-taxonomy';
import type { TaxonomyState } from '../../lib/site-taxonomy';
```
```tsx
  const [taxonomy, setTaxonomy] = useState<TaxonomyState>(EMPTY_TAXONOMY);
  const showWalkUp = !taxonomy.hide.includes('walk_up');
```

- [ ] **Step 2: Send taxonomy params in the search fetch**

Replace the `serverFilters`/`filters` param build (around lines 228–229, 247 deps) with:

```tsx
    const params = new URLSearchParams(taxonomyToParams(taxonomy));
    params.set('from', checkIn);
    params.set('to', checkOut);
    if (selectedRegion) params.set('region', selectedRegion);
```

Update the effect deps to include `taxonomy` instead of `activeFilters`. The `exclude_walk_up` special-casing is retired — walk-up display is now driven by `hide=walk_up` (the server already separates `availableSites`/`walkUpSites`; `showWalkUp` just controls display).

- [ ] **Step 3: Render the taxonomy panel**

Replace `<SiteFilterPanel activeFilters={activeFilters} onChange={setActiveFilters} />` with:

```tsx
        <SiteFilterPanel state={taxonomy} onChange={setTaxonomy} />
```

(All three groups; `/explore` shows the same Access/Site-kind/Hide set.)

- [ ] **Step 4: Fix any remaining references**

Search the file for `activeFilters` and update the "no results / clear filters" affordance (around line 424) to clear `taxonomy` to `EMPTY_TAXONOMY` instead.

- [ ] **Step 5: Typecheck + dev-load**

Run: `npm run typecheck && npm run dev`
Load `http://localhost:3001/explore`:
- Taxonomy pills render; selecting `Hike-in` re-queries and narrows results.
- `Hide → Walk-up` removes walk-up display; clearing it restores it.
- No console errors / hydration warnings.

- [ ] **Step 6: Commit**

```bash
git add web/app/explore/FindCampsitesClient.tsx
git commit -m "feat(explore): adopt shared taxonomy filter groups; send access/kinds/hide"
```

---

### Task 18: CHUNK 2 VERIFICATION GATE + parity check

Final acceptance. Depends on all prior tasks. Ideally run after a fresh `npm run worker` scan so Rec.gov rows are properly classified.

- [ ] **Step 1: Typecheck + full suite + web build**

Run: `npm run typecheck && npm test && npm --prefix web run build`
Expected: typecheck clean, all tests pass, Next build succeeds.

- [ ] **Step 2: `/map` live checks (spec Verification gates)**

With `npm run dev`:
- Default load shows NO green-styled default controls and NO Reset.
- Min stay 2 changes pin counts (fewer or equal vs Any).
- Clearing to Anytime keeps real counts (no all-green pins).
- Weekends-only pill is locked on under This-weekend; unlocks under other presets.
- Park finder opens the panel + flies; not affected by Reset.
- Summary sentence renders once (no double count), omitting default clauses.

- [ ] **Step 3: `/explore` live checks**

- Taxonomy filters re-query and change results.
- Walk-up sites appear/disappear with the Hide → Walk-up pill.

- [ ] **Step 4: Pins / panel / explore parity**

For one identical filter state (e.g. drive-in, 2-night, weekends-only, a fixed range), confirm: a pin's bookable count, that park's detail panel sites, and the `/explore` count for the same park agree. Day-use sites appear nowhere. Walk-up sites never count as bookable.

- [ ] **Step 5: Final commit / hand to Reviewer + Doc Steward**

```bash
git commit --allow-empty -m "chore: chunk 2 (UI) verification gate passed"
```

Hand off to the Reviewer (gating diff) and the Documentation Steward (update `docs/reference/surfaces/map.md`, `docs/reference/surfaces/explore.md`, `docs/reference/engines/cache.md`, the Site Filters table in `CLAUDE.md`, and the Commands list with `db:backfill-types`).

---

## Self-review checklist (Planner — completed)

- **Spec coverage:** Approved decisions 1–10 map to tasks — schema (T2), site-kind chips (T12/13), primitive→hike-in (T1), day-use removal (T1/3/9/10), default load (T14), min-stay→pins (T7/10/14), park dropdown→finder (T15), `/explore` parity (T17), Fri/Sat weekend unchanged (T7 helper + existing logic), pills/green/slate language (T13). Part 1 engine = T1–T11; Part 2 UI = T12–T18. Verification gates = T11, T18.
- **Placeholders:** none — every code step shows the code; commands have expected output.
- **Type consistency:** `SiteAccess`/`SiteKind`/`HideTarget`, `AvailabilityClauseOptions`, `TaxonomyState`, `siteMatchesMinStay`, `classifySite`/`SiteTypeInfo`, `parseFilterParams`, `taxonomyToParams` are defined once and reused with the same shape across engine, API, and UI tasks.
- **Open questions:** six flagged at the top with documented defaults so execution is unblocked; OQ3/4/5 are re-flagged inline at their tasks.
