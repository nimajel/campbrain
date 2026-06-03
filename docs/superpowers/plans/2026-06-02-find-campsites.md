# Find Campsites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Take Me Camping!" (`/explore`) page with a cache-backed campground search engine called "Find Campsites," and retire the now-redundant "What's Available" (`/available`) page.

**Architecture:** The user picks check-in/check-out dates, a region chip, and site-type filters; the client fetches `GET /api/search` which queries the Postgres `availability` table for sites available on every requested night, joins the catalog for lat/lon to assign a region, and returns results grouped by park. Results appear reactively; when nothing matches, a fallback panel surfaces alternate dates from the same region.

**Tech Stack:** Next.js 14 / React 18, TypeScript (strict), PostgreSQL via `postgres` client, `dayjs`, Tailwind-light custom CSS classes (`.card`, `.btn`, `.badge`, `.chip`, `SiteFilterPanel`).

---

## File Map

| Action | File |
|---|---|
| **Create** | `web/lib/regions.ts` — region classifier (pure, no I/O) |
| **Modify** | `src/cache/availability-cache.ts` — add `searchAvailableStays()` + `findNextAvailableDates()` |
| **Modify** | `web/lib/availability-cache.ts` — re-export new functions |
| **Create** | `web/app/api/search/route.ts` — GET handler |
| **Create** | `web/app/explore/FindCampsitesClient.tsx` — new React client |
| **Modify** | `web/app/explore/page.tsx` — swap import, update title |
| **Modify** | `web/app/layout.tsx` — rename nav link, remove What's Available |
| **Delete** | `web/app/explore/ExploreClient.tsx` |
| **Delete** | `web/app/api/explore/route.ts` |
| **Delete** | `web/app/available/page.tsx`, `web/app/available/AvailableClient.tsx` |
| **Delete** | `web/app/api/available/route.ts`, `web/app/api/available/refresh/route.ts` |

---

## Task 1: Region classifier

**Files:**
- Create: `web/lib/regions.ts`
- Test: `test/regions.test.ts`

- [ ] **Step 1: Create `web/lib/regions.ts`**

```typescript
export type CampRegion = 'north-coast' | 'bay-area' | 'sierra' | 'central-coast' | 'socal';

export const REGION_LABELS: Record<CampRegion, string> = {
  'north-coast':   'North Coast',
  'bay-area':      'Bay Area',
  'sierra':        'Sierra',
  'central-coast': 'Central Coast',
  'socal':         'SoCal',
};

export const ALL_REGIONS: CampRegion[] = [
  'north-coast', 'bay-area', 'sierra', 'central-coast', 'socal',
];

/**
 * Map a park's lat/lon to one of five California camping regions.
 * Bounding boxes are derived from the actual spread of the 88 CA State Parks
 * with campground data. Edge-case parks near boundaries fall into the nearest
 * reasonable region — this is a UX grouping, not a precise geographic standard.
 *
 *   North Coast  (lat ≥ 39.4, lon ≤ -121.5): Redwoods, Humboldt, Mendocino far-north (39.4 places Russian Gulch in Bay Area by design)
 *   Bay Area     (lat ≥ 37.0, lon ≤ -121.5): SF Bay, Wine Country, Mendocino coast south (incl. Russian Gulch at 39.33)
 *   Sierra       (lon > -121.5, lat ≥ 35):   Lake Tahoe, Gold Country, Shasta interior
 *   Central Coast(lat < 37, lat ≥ 33.5, lon ≤ -119.5): Big Sur, SLO, Santa Barbara
 *   SoCal        (everything else):           LA, OC, San Diego, desert
 */
export function classifyRegion(lat: number, lon: number): CampRegion {
  if (lat >= 39.4 && lon <= -121.5) return 'north-coast';
  if (lat >= 37.0 && lon <= -121.5) return 'bay-area';
  if (lat < 37.0 && lat >= 33.5 && lon <= -119.5) return 'central-coast';
  if (lat >= 35.0 && lon > -121.5) return 'sierra';
  return 'socal';
}
```

- [ ] **Step 2: Write tests in `test/regions.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { classifyRegion } from '../web/lib/regions.js';

describe('classifyRegion', () => {
  describe('North Coast', () => {
    it('classifies Jedediah Smith Redwoods (41.78, -124.10)', () => {
      expect(classifyRegion(41.78, -124.10)).toBe('north-coast');
    });
    it('classifies Humboldt Redwoods (40.34, -124.00)', () => {
      expect(classifyRegion(40.34, -124.00)).toBe('north-coast');
    });
    it('classifies MacKerricher (39.50, -123.79)', () => {
      expect(classifyRegion(39.50, -123.79)).toBe('north-coast');
    });
  });

  describe('Bay Area', () => {
    it('classifies Salt Point (38.58, -123.31)', () => {
      expect(classifyRegion(38.58, -123.31)).toBe('bay-area');
    });
    it('classifies Samuel P. Taylor (38.02, -122.73)', () => {
      expect(classifyRegion(38.02, -122.73)).toBe('bay-area');
    });
    it('classifies Russian Gulch (39.33, -123.76)', () => {
      expect(classifyRegion(39.33, -123.76)).toBe('bay-area');
    });
  });

  describe('Sierra', () => {
    it('classifies D.L. Bliss (38.99, -120.10)', () => {
      expect(classifyRegion(38.99, -120.10)).toBe('sierra');
    });
    it('classifies Donner Memorial (39.29, -120.29)', () => {
      expect(classifyRegion(39.29, -120.29)).toBe('sierra');
    });
    it('classifies Plumas-Eureka (39.76, -120.70)', () => {
      expect(classifyRegion(39.76, -120.70)).toBe('sierra');
    });
  });

  describe('Central Coast', () => {
    it('classifies Pfeiffer Big Sur (36.25, -121.78)', () => {
      expect(classifyRegion(36.25, -121.78)).toBe('central-coast');
    });
    it('classifies Morro Bay (35.34, -120.83)', () => {
      expect(classifyRegion(35.34, -120.83)).toBe('central-coast');
    });
    it('classifies Gaviota (34.49, -120.24)', () => {
      expect(classifyRegion(34.49, -120.24)).toBe('central-coast');
    });
  });

  describe('SoCal', () => {
    it('classifies Malibu Creek (34.08, -118.75)', () => {
      expect(classifyRegion(34.08, -118.75)).toBe('socal');
    });
    it('classifies Anza-Borrego (33.10, -116.30)', () => {
      expect(classifyRegion(33.10, -116.30)).toBe('socal');
    });
    it('classifies Fort Tejon (34.87, -118.90)', () => {
      expect(classifyRegion(34.87, -118.90)).toBe('socal');
    });
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --reporter=verbose test/regions.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/lib/regions.ts test/regions.test.ts
git commit -m "feat: add region classifier for CA state park geographic grouping"
```

---

## Task 2: Cache queries — `searchAvailableStays` and `findNextAvailableDates`

**Files:**
- Modify: `src/cache/availability-cache.ts` (append to end of file)

- [ ] **Step 1: Add types and `searchAvailableStays` to `src/cache/availability-cache.ts`**

Append after the `getAvailableSitesForStay` function (end of file):

```typescript
// ---------------------------------------------------------------------------
// Search: sites available for every night in [from, to) across all parks
// ---------------------------------------------------------------------------

export type SearchCampground = {
  name: string;
  nightlyFee: number | null;
  bookingUrl: string | null;
  availableSites: string[];   // bookable (non-walk-up) site names, sorted
  walkUpSites: string[];      // hike/bike first-come sites, sorted
};

export type SearchParkResult = {
  parkPageId: string;
  parkName: string;
  campgrounds: SearchCampground[];
};

/**
 * Find all sites with status='available' on EVERY night from `from` (inclusive)
 * to `to` (exclusive — last night is the night before `to`).
 * Applies FILTER_SQL patterns for the given filterIds.
 * Walk-up (hike/bike) sites are separated into walkUpSites; bookable sites go
 * into availableSites. Parks with zero bookable sites still appear if they have
 * walk-up sites.
 */
export async function searchAvailableStays(params: {
  from: string;
  to: string;
  filterIds?: string[];
}): Promise<SearchParkResult[]> {
  const sql = getSql();
  const { from, to, filterIds = [] } = params;
  const nightCount = dayjs(to).diff(dayjs(from), 'day');
  if (nightCount < 1) return [];

  // Build dynamic filter clauses — patterns are hardcoded constants, not user input
  const filterClauses: string[] = [];
  for (const id of filterIds) {
    const f = FILTER_SQL[id];
    if (!f) continue; // unknown filter ids (e.g. exclude_walk_up) are silently skipped
    const col = `(s.site_name || ' ' || s.campground_name) ~* '${f.pattern}'`;
    filterClauses.push(f.exclude ? `NOT (${col})` : col);
  }
  const filterWhere = filterClauses.length > 0 ? `AND ${filterClauses.join(' AND ')}` : '';

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
      s.site_name ~* 'hike\\s*[/&]?\\s*bike' AS is_walk_up
    FROM sites s
    JOIN campgrounds cg
      ON cg.provider_id = s.provider_id
      AND cg.park_page_id = s.park_page_id
      AND cg.campground_name = s.campground_name
    JOIN parks p
      ON p.provider_id = s.provider_id
      AND p.park_page_id = s.park_page_id
    WHERE s.provider_id = $1
      AND s.site_id IN (
        SELECT site_id
        FROM availability
        WHERE date >= $2::date
          AND date < $3::date
          AND status = 'available'
        GROUP BY site_id
        HAVING COUNT(DISTINCT date) = $4::int
      )
      ${filterWhere}
    ORDER BY p.park_name, cg.campground_name, s.site_name
  `, [PROVIDER, from, to, String(nightCount)]);

  // Group rows into parks → campgrounds
  const parkMap = new Map<string, SearchParkResult>();
  for (const row of rows) {
    if (!parkMap.has(row.park_page_id)) {
      parkMap.set(row.park_page_id, {
        parkPageId: row.park_page_id,
        parkName: row.park_name,
        campgrounds: [],
      });
    }
    const park = parkMap.get(row.park_page_id)!;
    let cg = park.campgrounds.find((c) => c.name === row.campground_name);
    if (!cg) {
      cg = {
        name: row.campground_name,
        nightlyFee: row.nightly_fee !== null ? Number(row.nightly_fee) : null,
        bookingUrl: row.booking_url,
        availableSites: [],
        walkUpSites: [],
      };
      park.campgrounds.push(cg);
    }
    if (row.is_walk_up) {
      cg.walkUpSites.push(row.site_name);
    } else {
      cg.availableSites.push(row.site_name);
    }
  }

  return [...parkMap.values()];
}
```

- [ ] **Step 2: Add `findNextAvailableDates` to `src/cache/availability-cache.ts`**

Append immediately after `searchAvailableStays`:

```typescript
// ---------------------------------------------------------------------------
// Fallback: earliest available date per park within a look-ahead window
// ---------------------------------------------------------------------------

export type NextAvailableResult = {
  parkPageId: string;
  parkName: string;
  earliestDate: string; // YYYY-MM-DD
};

/**
 * For up to 5 parks (optionally restricted by parkPageIds), find the earliest
 * date with any available site within the next `withinDays` days.
 * Used for the "no results" fallback panel.
 */
export async function findNextAvailableDates(params: {
  withinDays?: number;
  parkPageIds?: string[];
}): Promise<NextAvailableResult[]> {
  const sql = getSql();
  const { withinDays = 60, parkPageIds } = params;
  const endDate = dayjs().add(withinDays, 'day').format('YYYY-MM-DD');

  const paramValues: string[] = [PROVIDER, endDate];
  const clauses: string[] = [
    `s.provider_id = $1`,
    `a.status = 'available'`,
    `a.date >= CURRENT_DATE`,
    `a.date <= $2::date`,
  ];

  if (parkPageIds && parkPageIds.length > 0) {
    const placeholders = parkPageIds.map((_, i) => `$${paramValues.length + i + 1}`).join(', ');
    clauses.push(`s.park_page_id IN (${placeholders})`);
    paramValues.push(...parkPageIds);
  }

  type Row = { park_page_id: string; park_name: string; earliest_date: string };

  const rows = await sql.unsafe<Row[]>(`
    SELECT s.park_page_id, p.park_name, MIN(a.date)::text AS earliest_date
    FROM availability a
    JOIN sites s ON s.site_id = a.site_id
    JOIN parks p
      ON p.provider_id = s.provider_id
      AND p.park_page_id = s.park_page_id
    WHERE ${clauses.join('\n      AND ')}
    GROUP BY s.park_page_id, p.park_name
    ORDER BY earliest_date
    LIMIT 5
  `, paramValues);

  return rows.map((r) => ({
    parkPageId: r.park_page_id,
    parkName: r.park_name,
    earliestDate: r.earliest_date,
  }));
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/cache/availability-cache.ts
git commit -m "feat: add searchAvailableStays and findNextAvailableDates cache queries"
```

---

## Task 3: Re-export new cache functions from the web layer

**Files:**
- Modify: `web/lib/availability-cache.ts`

- [ ] **Step 1: Update `web/lib/availability-cache.ts`**

Replace the entire file with:

```typescript
import { listAllEntries, getCacheStats, getAvailableSitesForStay, getEntriesForPark, getParksWithAvailability, listAvailableStays, refreshMaterializedView, rebuildMaterializedView, searchAvailableStays, findNextAvailableDates } from '../../src/cache/availability-cache';
import type { AvailabilityWindowEntry, CampgroundWindow, SiteDailyAvailability, AvailableStay, SearchParkResult, SearchCampground, NextAvailableResult } from '../../src/cache/availability-cache';

export async function listFreshEntriesWeb(): Promise<AvailabilityWindowEntry[]> {
  return listAllEntries();
}

export async function getAllEntriesWeb(): Promise<AvailabilityWindowEntry[]> {
  return listAllEntries();
}

export { getCacheStats, getAvailableSitesForStay, getEntriesForPark, getParksWithAvailability, listAvailableStays, refreshMaterializedView, rebuildMaterializedView, searchAvailableStays, findNextAvailableDates };
export type { AvailabilityWindowEntry, CampgroundWindow, SiteDailyAvailability, AvailableStay, SearchParkResult, SearchCampground, NextAvailableResult };
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/lib/availability-cache.ts
git commit -m "chore: re-export searchAvailableStays and findNextAvailableDates from web lib"
```

---

## Task 4: `/api/search` route

**Files:**
- Create: `web/app/api/search/route.ts`

- [ ] **Step 1: Create `web/app/api/search/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { searchAvailableStays, findNextAvailableDates } from '../../../lib/availability-cache';
import { classifyRegion, ALL_REGIONS } from '../../../lib/regions';
import type { CampRegion } from '../../../lib/regions';
import type { SearchParkResult, SearchCampground } from '../../../lib/availability-cache';
import { listParksWeb } from '../../../lib/catalog';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Response types (consumed by FindCampsitesClient)
// ---------------------------------------------------------------------------

export type SearchCampgroundResponse = SearchCampground;

export type SearchParkResponse = {
  parkPageId: string;
  parkName: string;
  region: CampRegion;
  campgrounds: SearchCampgroundResponse[];
  totalAvailable: number; // bookable sites only
};

export type FallbackPark = {
  parkPageId: string;
  parkName: string;
  region: CampRegion;
  earliestDate: string;
};

export type SearchApiResponse = {
  parks: SearchParkResponse[];
  fallback: { alternateDates: FallbackPark[] } | null;
};

// ---------------------------------------------------------------------------
// GET /api/search?from=YYYY-MM-DD&to=YYYY-MM-DD[&filters=id1,id2][&region=slug]
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest
): Promise<NextResponse<SearchApiResponse | { error: string }>> {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const filtersParam = searchParams.get('filters') ?? '';
  const filterIds = filtersParam ? filtersParam.split(',') : [];
  const regionParam = searchParams.get('region');
  const regionFilter: CampRegion | null =
    regionParam && (ALL_REGIONS as string[]).includes(regionParam)
      ? (regionParam as CampRegion)
      : null;

  if (!from || !to || from >= to) {
    return NextResponse.json(
      { error: 'from and to are required and from must be before to' },
      { status: 400 }
    );
  }

  // lat/lon lookup from catalog (parks table has no coords — they live in the JSON)
  const catalogParks = listParksWeb();
  const coordsByPageId = new Map(
    catalogParks
      .filter((p): p is typeof p & { lat: number; lon: number } =>
        p.lat !== undefined && p.lon !== undefined
      )
      .map((p) => [p.parkPageId, { lat: p.lat, lon: p.lon }])
  );

  const results: SearchParkResult[] = await searchAvailableStays({ from, to, filterIds });

  const parks: SearchParkResponse[] = results
    .map((park) => {
      const coords = coordsByPageId.get(park.parkPageId);
      const region: CampRegion = coords
        ? classifyRegion(coords.lat, coords.lon)
        : 'socal';
      const totalAvailable = park.campgrounds.reduce(
        (n, cg) => n + cg.availableSites.length,
        0
      );
      return { ...park, region, totalAvailable };
    })
    .filter((park) => !regionFilter || park.region === regionFilter)
    .sort((a, b) => b.totalAvailable - a.totalAvailable);

  // Fallback: only when zero results
  let fallback: SearchApiResponse['fallback'] = null;
  if (parks.length === 0) {
    const parkPageIds = regionFilter
      ? catalogParks
          .filter(
            (p): p is typeof p & { lat: number; lon: number } =>
              p.lat !== undefined && p.lon !== undefined
          )
          .filter((p) => classifyRegion(p.lat, p.lon) === regionFilter)
          .map((p) => p.parkPageId)
      : undefined;

    const altDates = await findNextAvailableDates({ withinDays: 60, parkPageIds });
    fallback = {
      alternateDates: altDates.map((p) => {
        const coords = coordsByPageId.get(p.parkPageId);
        const region: CampRegion = coords
          ? classifyRegion(coords.lat, coords.lon)
          : 'socal';
        return { parkPageId: p.parkPageId, parkName: p.parkName, region, earliestDate: p.earliestDate };
      }),
    };
  }

  return NextResponse.json({ parks, fallback });
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/search/route.ts
git commit -m "feat: add /api/search route backed by Postgres availability cache"
```

---

## Task 5: `FindCampsitesClient.tsx` and update `page.tsx`

**Files:**
- Create: `web/app/explore/FindCampsitesClient.tsx`
- Modify: `web/app/explore/page.tsx`

- [ ] **Step 1: Create `web/app/explore/FindCampsitesClient.tsx`**

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import SiteFilterPanel from '../components/SiteFilterPanel';
import { injectBookingDates } from '../../lib/booking-url';
import { ALL_REGIONS, REGION_LABELS } from '../../lib/regions';
import type { CampRegion } from '../../lib/regions';
import type { SearchApiResponse, SearchParkResponse } from '../api/search/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nightCount(from: string, to: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round(
    (new Date(to).getTime() - new Date(from).getTime()) / msPerDay
  );
}

// ---------------------------------------------------------------------------
// ParkCard
// ---------------------------------------------------------------------------

function ParkCard({
  park,
  checkIn,
  nights,
  showWalkUp,
}: {
  park: SearchParkResponse;
  checkIn: string;
  nights: number;
  showWalkUp: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasBookable = park.totalAvailable > 0;

  return (
    <div className="card" style={{ marginBottom: 8, padding: open ? undefined : '8px 16px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          marginBottom: open ? 6 : 0,
        }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen((v) => !v);
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            transition: 'transform .15s',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            display: 'inline-block',
            flexShrink: 0,
          }}
        >
          ▶
        </span>
        <h3 style={{ margin: 0, flex: 1, fontSize: 14, fontWeight: hasBookable ? 600 : 400 }}>
          {park.parkName}
        </h3>
        <span className="badge badge-gray" style={{ fontSize: 10 }}>
          {REGION_LABELS[park.region]}
        </span>
        {hasBookable ? (
          <span className="badge badge-green">
            {park.totalAvailable} site{park.totalAvailable !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="badge badge-gray" style={{ opacity: 0.6 }}>
            walk-up only
          </span>
        )}
      </div>

      {open &&
        park.campgrounds.map((cg, i) => {
          const hasAvail = cg.availableSites.length > 0;
          const hasWalkUp = showWalkUp && cg.walkUpSites.length > 0;
          if (!hasAvail && !hasWalkUp) return null;

          return (
            <div
              key={i}
              style={{ padding: '7px 0', borderTop: '1px solid var(--border)' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
                  {cg.name}
                </span>
                {cg.nightlyFee !== null && (
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--muted)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ${cg.nightlyFee}/night ·{' '}
                    <strong style={{ color: 'var(--text)' }}>
                      ${cg.nightlyFee * nights} total
                    </strong>
                  </span>
                )}
                {cg.bookingUrl && hasAvail && (
                  <a
                    href={injectBookingDates(cg.bookingUrl, checkIn, nights)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-sm btn-success"
                    style={{ fontSize: 11 }}
                  >
                    Book ↗
                  </a>
                )}
              </div>

              {hasAvail && (
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap',
                    marginTop: 5,
                  }}
                >
                  {cg.availableSites.map((site) => (
                    <span
                      key={site}
                      className="chip chip-green"
                      style={{ fontSize: 11 }}
                    >
                      {site}
                    </span>
                  ))}
                </div>
              )}

              {hasWalkUp && (
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap',
                    marginTop: 4,
                    alignItems: 'center',
                  }}
                >
                  <span className="badge badge-gray" style={{ fontSize: 9 }}>
                    walk-up
                  </span>
                  {cg.walkUpSites.map((site) => (
                    <span
                      key={site}
                      className="chip"
                      style={{ fontSize: 11, opacity: 0.6 }}
                    >
                      {site}
                    </span>
                  ))}
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--muted)',
                      fontStyle: 'italic',
                    }}
                  >
                    first-come, not reservable
                  </span>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function FindCampsitesClient() {
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<CampRegion | null>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [data, setData] = useState<SearchApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nights = checkIn && checkOut ? nightCount(checkIn, checkOut) : 0;

  const showWalkUp = !activeFilters.includes('exclude_walk_up');

  const runSearch = useCallback(async () => {
    if (!checkIn || !checkOut || checkIn >= checkOut) return;

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ from: checkIn, to: checkOut });
    if (selectedRegion) params.set('region', selectedRegion);
    // exclude_walk_up is display-only; other filters go to the server
    const serverFilters = activeFilters.filter((f) => f !== 'exclude_walk_up');
    if (serverFilters.length > 0) params.set('filters', serverFilters.join(','));

    try {
      const res = await fetch(`/api/search?${params.toString()}`);
      const json = (await res.json()) as SearchApiResponse | { error: string };
      if (!res.ok) {
        setError('error' in json ? json.error : `HTTP ${res.status}`);
        setData(null);
      } else {
        setData(json as SearchApiResponse);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [checkIn, checkOut, selectedRegion, activeFilters]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  const totalAvailable = data?.parks.reduce((n, p) => n + p.totalAvailable, 0) ?? 0;

  return (
    <div>
      {/* Search form */}
      <div className="card" style={{ marginBottom: 20 }}>
        {/* Dates row */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            marginBottom: 16,
          }}
        >
          <label style={{ flex: '0 0 150px' }}>
            Check-in
            <input
              type="date"
              value={checkIn}
              min={todayIso()}
              onChange={(e) => {
                setCheckIn(e.target.value);
                // push check-out forward if it would be before new check-in
                if (checkOut && e.target.value >= checkOut) setCheckOut('');
              }}
            />
          </label>
          <label style={{ flex: '0 0 150px' }}>
            Check-out
            <input
              type="date"
              value={checkOut}
              min={checkIn || todayIso()}
              onChange={(e) => setCheckOut(e.target.value)}
            />
          </label>
          {nights > 0 && (
            <span
              style={{
                fontSize: 13,
                color: 'var(--muted)',
                alignSelf: 'flex-end',
                paddingBottom: 6,
              }}
            >
              {nights} night{nights !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Region chips */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              marginBottom: 8,
            }}
          >
            Region
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${selectedRegion === null ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setSelectedRegion(null)}
            >
              {selectedRegion === null ? '✓ All' : 'All'}
            </button>
            {ALL_REGIONS.map((region) => (
              <button
                key={region}
                type="button"
                className={`btn btn-sm ${selectedRegion === region ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() =>
                  setSelectedRegion((prev) => (prev === region ? null : region))
                }
              >
                {selectedRegion === region ? `✓ ${REGION_LABELS[region]}` : REGION_LABELS[region]}
              </button>
            ))}
          </div>
        </div>

        {/* Site filters */}
        <SiteFilterPanel activeFilters={activeFilters} onChange={setActiveFilters} />
      </div>

      {/* States */}
      {!checkIn && !checkOut && (
        <div className="empty">
          <p>Pick a check-in and check-out date to see available campsites.</p>
        </div>
      )}

      {checkIn && !checkOut && (
        <div className="empty">
          <p>Now pick a check-out date.</p>
        </div>
      )}

      {loading && (
        <div className="empty">
          <p>Searching…</p>
        </div>
      )}

      {error && !loading && (
        <div className="card" style={{ color: 'var(--red)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Results */}
      {!loading && data && (
        <>
          {data.parks.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <h2 style={{ margin: 0, flex: 1 }}>
                {data.parks.length} park{data.parks.length !== 1 ? 's' : ''}
              </h2>
              <span className="badge badge-green">
                {totalAvailable} site{totalAvailable !== 1 ? 's' : ''} available
              </span>
            </div>
          )}

          {data.parks.map((park) => (
            <ParkCard
              key={park.parkPageId}
              park={park}
              checkIn={checkIn}
              nights={nights}
              showWalkUp={showWalkUp}
            />
          ))}

          {/* Fallback panel */}
          {data.parks.length === 0 && (
            <div className="empty" style={{ textAlign: 'left' }}>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>
                No availability for those dates.
              </p>

              {activeFilters.length > 0 && (
                <p style={{ fontSize: 13, marginBottom: 12 }}>
                  Try removing some site filters — they may be hiding available
                  sites.
                </p>
              )}

              {data.fallback && data.fallback.alternateDates.length > 0 && (
                <div>
                  <p
                    style={{
                      fontSize: 13,
                      color: 'var(--muted)',
                      marginBottom: 8,
                    }}
                  >
                    Next openings in{' '}
                    {selectedRegion ? REGION_LABELS[selectedRegion] : 'all regions'}
                    :
                  </p>
                  {data.fallback.alternateDates.map((p) => (
                    <div
                      key={p.parkPageId}
                      style={{ fontSize: 13, marginBottom: 4 }}
                    >
                      <strong>{p.parkName}</strong>{' '}
                      <span style={{ color: 'var(--muted)' }}>
                        — openings from{' '}
                        {new Date(p.earliestDate + 'T12:00:00').toLocaleDateString(
                          'en-US',
                          { month: 'short', day: 'numeric' }
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {data.fallback && data.fallback.alternateDates.length === 0 && (
                <p style={{ fontSize: 13 }}>
                  No availability found in the next 60 days for this region.
                  Try expanding your region or date range.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update `web/app/explore/page.tsx`**

Replace the entire file with:

```typescript
import FindCampsitesClient from './FindCampsitesClient';

export const dynamic = 'force-dynamic';

export default function FindCampsitesPage() {
  return (
    <>
      <div className="page-header">
        <h1>Find Campsites</h1>
        <p className="page-subtitle">
          Search available campsites across California state parks
        </p>
      </div>
      <FindCampsitesClient />
    </>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/app/explore/FindCampsitesClient.tsx web/app/explore/page.tsx
git commit -m "feat: add FindCampsitesClient with date picker, region chips, and fallback panel"
```

---

## Task 6: Update nav

**Files:**
- Modify: `web/app/layout.tsx`

- [ ] **Step 1: Edit `web/app/layout.tsx`**

In the `<nav>` block, make two changes:
1. Remove the `<a href="/available">What&apos;s Available</a>` line
2. Change `Take Me Camping!` → `Find Campsites`

The nav block should look like this after the edit:

```tsx
<nav>
  <a href="/">Dashboard</a>
  <a href="/explore">Find Campsites</a>
  <a href="/map">Map</a>
  <a href="/alerts">Alerts</a>
  <a href="/scan-history">Scan History</a>
  <a href="/calendar">Calendar</a>
  <a href="/settings">Settings</a>
</nav>
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/app/layout.tsx
git commit -m "chore: rename nav link to Find Campsites, remove What's Available"
```

---

## Task 7: Delete retired files and verify

**Files to delete:**
- `web/app/explore/ExploreClient.tsx`
- `web/app/api/explore/route.ts`
- `web/app/available/AvailableClient.tsx`
- `web/app/available/page.tsx`
- `web/app/api/available/route.ts`
- `web/app/api/available/refresh/route.ts`

- [ ] **Step 1: Delete retired files**

```bash
rm web/app/explore/ExploreClient.tsx
rm web/app/api/explore/route.ts
rm web/app/available/AvailableClient.tsx
rm web/app/available/page.tsx
rm web/app/api/available/route.ts
rm web/app/api/available/refresh/route.ts
rmdir web/app/available
rmdir web/app/api/available
```

- [ ] **Step 2: Delete retired lib files that are only used by the deleted pages**

Check whether `web/lib/available-display.ts` is still imported anywhere:

```bash
grep -r "available-display" web/
```

If the only remaining imports are from the deleted files (none remain after deletion), delete it too:

```bash
rm web/lib/available-display.ts
```

If it's still imported by other files, leave it.

- [ ] **Step 3: Typecheck — must be clean**

```bash
npm run typecheck
```

Expected: no errors. If there are "module not found" errors, those are stale imports from files that weren't deleted — trace and fix them.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass. Tests in `test/available-page.test.ts` test pure functions from `web/lib/available-display.ts` and `web/lib/site-filters.ts`. If `available-display.ts` was deleted (Step 2), those tests will fail — in that case, delete `test/available-page.test.ts` as well (the functionality it tested no longer exists).

- [ ] **Step 5: Verify Next.js build**

```bash
npm --prefix web run build
```

Expected: build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: retire What's Available and Take Me Camping pages; Find Campsites is live"
```

---

## Self-review notes

- `FILTER_SQL` is already defined in `availability-cache.ts` and is reused by `searchAvailableStays` — no duplication.
- `exclude_walk_up` is correctly excluded from server-side filter params in `FindCampsitesClient`; walk-up sites always come back in `walkUpSites` arrays and the client hides them based on `showWalkUp`.
- The `nightCount` helper uses `Math.round` to avoid floating-point drift from DST transitions.
- The fallback `earliestDate` uses `+ 'T12:00:00'` when constructing a `Date` for `toLocaleDateString` to avoid off-by-one from UTC midnight parsing in local time zones.
- `web/lib/available-display.ts` deletion is guarded by a grep check (Step 2 of Task 7) — it may still be needed by other pages.
