# CampBrain Hosted Launch — Phase 1d-2 (Vite Leaflet map page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This is a fresh-session plan — it is self-contained; read the cited legacy files for behavioral fidelity.**

**Goal:** Port the legacy Next.js interactive park map (`web/app/map/*`, ~1,900 lines) to the Vite + TanStack-Router + Tailwind/shadcn app at `apps/web`, consuming the Phase-1d-1 `api.map.*` tRPC procedures, so the live map becomes the full-bleed front door at `/`.

**Architecture:** The 1,205-line `MapClient` monolith is decomposed into a `features/map/` module: pure `lib/` helpers (TDD-tested), data hooks wrapping `api.map.*` in TanStack Query (`useQuery`), and presentational components (visually verified). The legacy files are the behavioral source of truth — port from exact paths + line ranges. CA-only: one `MapPark` per park, single `parkPageId` (no rec.gov `facilityIds` grouping); `availByFacility` collapses to `availByPark`. The legacy hand-rolled summary debounce + per-park availability cache are replaced by TanStack Query's cache + a debounced filter snapshot. `minNights` stays client-side (the 1d-1 `availability` procedure does not apply it).

**Tech Stack:** Bun · Vite · React 19 · TanStack Router + Query · tRPC v11 (vanilla client) · Tailwind v4 + shadcn · Leaflet/react-leaflet/markercluster · Vitest.

**Spec:** docs/superpowers/specs/2026-06-22-hosted-launch-phase1d2-map-page-design.md

---

## Scope

**In 1d-2:**
- Full map page at `/` (replaces `apps/web/src/routes/index.tsx`), full-bleed (override the `__root` `p-4` padding for the index route only).
- The decomposed feature module under `apps/web/src/features/map/` (hooks + components + ported pure lib helpers + scoped CSS).
- Leaflet stack: `leaflet`, `react-leaflet`, `leaflet.markercluster` deps + the marker-icon Vite fix + `leaflet.css` imported first.
- Data via the vanilla tRPC client + TanStack Query (`useQuery` wrapping `api.map.catalog/availability/summary`).
- Unit tests for the pure helpers + the extracted client-filter logic; visual verification of the rendered page via the `preview_*` tools.

**Deferred (consistent with phasing):**
- Save-this-search + alert toggles on the map (Phase 2 — the save/alert mutations + `allowlistedProcedure` don't exist yet).
- URL-search-param hydration from `/saved` (`?savedSearch=<id>`, `weekendsOnly=true` deep-link) — Phase 2.
- Recreation.gov provider + multi-facility (`facilityIds`) grouping — CA-only single `parkPageId`.
- Storybook stories for the new components (Storybook is not set up in `apps/web`).

## File structure

```
apps/web/src/
  routes/index.tsx                 MODIFY: render <MapPage/>
  routes/__root.tsx                MODIFY: drop <main> p-4 padding for the "/" route only
  features/map/
    MapPage.tsx                    composition root; runs api.map.catalog; owns selectedPark + layout
    hooks/
      use-map-filters.ts           all filter state (WHEN/preset/dates/weekendsOnly, minNights, taxonomy,
                                    location/distance) + geocode + geolocation handlers + reset + derived
                                    summary-sentence/activeFilterCount/isDefaultState
      use-map-summary.ts           api.map.summary via useQuery, keyed on a debounced filter snapshot;
                                    returns availByPark: Map<parkPageId, ParkAvailabilitySummary>
      use-park-availability.ts     api.map.availability via useQuery (queryKey = parkPageId + filters);
                                    returns ParkAvailabilityResponse + loading/error
      use-filtered-parks.ts        haversine distance filter + availability merge →
                                    {displayedParks, listRows, matchCount}
      use-is-mobile.ts             (max-width:640px) media-query hook (replaces legacy useIsMobile)
    components/
      FilterBar.tsx                header (menu/toggle/summary-sentence/reset/ParkFinder) + Rows 1–3
      DateRangePicker.tsx          shadcn Calendar (react-day-picker); 2 months desktop / 1 mobile
      SiteFilterPanel.tsx          access / site-kind / hide pill groups
      ParkFinder.tsx               park typeahead (input + dropdown)
      MapView.tsx                  react-leaflet MapContainer (Carto Voyager tiles, CA bounds) +
                                   FlyTo + FocusOnLocation + focus CircleMarker + clusters + MapLegend
      MarkerClusterGroup.tsx       ported ~as-is (createPathComponent + leaflet.markercluster)
      MapLegend.tsx                bottom-left legend (pins + glyphs)
      ParkDetail.tsx               detail panel: weekend-tier rows / dates rows + walk-up + Book links
      ResultsDrawer.tsx            results list + mobile sheet (peek/half/full detent)
    lib/
      map-pins.ts                  pin/cluster/legend HTML builders (teardrop SVG, glyphs, donut)
      site-taxonomy.ts             ACCESS/KIND/HIDE groups + TaxonomyState + taxonomyToParams/isTaxonomyDefault
      booking-url.ts               injectBookingDates(url, arrivalDate, nights)
      site-display.ts              formatSiteName (title-case, de-shout)
      upcoming-weekend.ts          upcomingWeekendRange(today) → {from,to}
      park-list.ts                 sortParkRows + ParkListRow type
      sheet-detent.ts              cycleDetent + SheetDetent type
      stay-tiers.ts                NEW pure module: weekend-tier selection (by minNights) +
                                   consecutive-night intersection for the dates view
      map-utils.ts                 haversine, todayIso/addDaysIso, formatDate, relativeDate,
                                   relativeTime, isoDow, rangeHasWeekendDay
      types.ts                     shared types: Preset, MinNights, ResolvedLocation, ParkAvailabilitySummary
      filter-derivations.ts        pure: buildAvailByPark, computeFilteredParks, buildListRows,
                                   computeActiveFilterCount, summary-sentence (tested in Task 6)
    map.css                        scoped: @import leaflet.css (first) + the pin/cluster CSS custom
                                   properties (--accent/--walkup/--surface/--muted/--green/--border/...)
```

> **Helper-reuse note (verified):** the legacy `web/lib` helpers being ported (`map-pins`, `site-taxonomy`,
> `booking-url`, `site-display`, `upcoming-weekend`, `park-list`, `sheet-detent`) are **UI/presentation
> concerns** with no `@campbrain/core` equivalent — they live in `apps/web/src/features/map/lib`. The
> response types (`MapPark`, `ParkAvailabilityResponse`, `AvailableDateEntry`, `WeekendEntry`,
> `ParkAvailabilityCount`) come from `@campbrain/core` / `@campbrain/db` **via tRPC inference** — never
> redeclare them; import or infer. Date math in `stay-tiers`/`map-utils` is local-tz-consistent with
> `@campbrain/core`'s `addDays`/`parseDateLocal`, so the new helpers must use the same `new Date(y,m-1,d)`
> construction (NOT `Date.parse`).

## Critical adaptations (apply throughout)

These five adaptations recur across the component tasks. Read them once here; each task references them.

1. **REST fetch → tRPC `useQuery`.** Legacy `fetch('/api/map/...')` becomes `useQuery({ queryKey, queryFn: () => api.map.X.query(input) })`. Import `api` from `@/lib/trpc`. The `availability` input is `{ parkPageId, provider?, from?, to?, access[], kinds[], hide[] }` (NO `minNights`/`weekendsOnly`). The `summary` input is `{ from?, to?, weekendsOnly, access[], kinds[], hide[], minNights? }`.
2. **`next/dynamic` + `'use client'` → direct import.** Vite is a SPA; drop the `dynamic(() => import('./LeafletMap'), { ssr: false })` wrapper and the `'use client'` directive. Import `MapView` directly (optionally `React.lazy` it in `MapPage`).
3. **Custom CSS classes → Tailwind/shadcn.** Legacy uses `.btn`/`.btn-sm`/`.btn-primary`/`.map-detail-panel`/etc. from `globals.css`. Replace with shadcn `<Button>` (variants) + Tailwind utility classes. The ONLY raw CSS that survives is the Leaflet pin/cluster custom properties in `features/map/map.css` (the pin HTML is built by `map-pins.ts` as SVG strings referencing `var(--accent)` etc.).
4. **`facilityIds` / rec.gov grouping → single `parkPageId`.** The `MapPark` from `api.map.catalog` has NO `facilityPageIds`/`sites[]`/`siteTypes`. Each park is one entry with one `parkPageId`. Drop all `facilityPageIds` loops.
5. **`availByFacility` → `availByPark`.** The `summary` procedure already returns per-park counts (`ParkAvailabilityCount[]`). Build `availByPark: Map<parkPageId, ParkAvailabilitySummary>` directly — no facility→park aggregation.

**Shared types (define in early tasks, reuse verbatim by name later):**

```ts
// in apps/web/src/features/map/lib/types.ts (created in Task 1)
export interface ParkAvailabilitySummary {
  siteCount: number;
  walkUpCount: number;
  soonestDate: string | null;
}
export type Preset = "this_weekend" | "next_2_weeks" | "next_month" | "anytime";
export type MinNights = 1 | 2 | 3 | null;
export interface ResolvedLocation { lat: number; lon: number; name: string }
```

`MapPark`, `ParkAvailabilityResponse`, `AvailableDateEntry`, `WeekendEntry`, `WeekendCampground`, `AvailableDateCampground` are imported from `@campbrain/core` (re-exported by the API package; import via `import type { MapPark } from "@campbrain/core"`). `TaxonomyState`, `ParkListRow`, `ParkListSort`, `SheetDetent` are defined in the ported `lib/` modules (Tasks 2, 4).

---

## Task 0: Dependencies + setup

**Files:**
- Modify: `apps/web/package.json` (deps)
- Create (shadcn): `apps/web/src/components/ui/calendar.tsx`, `button.tsx`, `popover.tsx` (if not present)

- [ ] **Step 1: Add Leaflet deps to apps/web**

Run from repo root:
```bash
cd apps/web && bun add leaflet react-leaflet leaflet.markercluster && bun add -d @types/leaflet @types/leaflet.markercluster
```
Expected: `package.json` `dependencies` gains `leaflet`, `react-leaflet`, `leaflet.markercluster`; `devDependencies` gains the two `@types/*`.

- [ ] **Step 2: Add shadcn primitives the filter bar + date picker need**

Run from `apps/web`:
```bash
bunx shadcn@latest add button popover calendar
```
Expected: creates `src/components/ui/{button,popover,calendar}.tsx`. `calendar` pulls in `react-day-picker` + `date-fns` as deps. If a component already exists, accept the overwrite prompt or skip — `button` likely exists from NavBar; verify it does (`ls src/components/ui/button.tsx`) and only add what is missing.

- [ ] **Step 3: Verify the workspace still builds + typechecks**

Run from repo root:
```bash
bun --filter @campbrain/web typecheck && bun --filter @campbrain/web build
```
Expected: both PASS (no map code yet; this confirms the new deps + shadcn files compile).

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/src/components/ui bun.lock
git commit -m "chore(web): add leaflet + shadcn calendar deps for map page"
```

---

## Task 1: `lib/map-utils.ts` + `lib/types.ts` (pure date/geo helpers)

**Source:** `web/app/map/MapClient.tsx:129-189` (haversine, todayIso, addDaysIso, formatDate, relativeDate, relativeTime, isoDow, rangeHasWeekendDay).

**Files:**
- Create: `apps/web/src/features/map/lib/types.ts`
- Create: `apps/web/src/features/map/lib/map-utils.ts`
- Test: `apps/web/src/features/map/lib/map-utils.test.ts`

- [ ] **Step 1: Create the shared types file**

`apps/web/src/features/map/lib/types.ts`:
```ts
export interface ParkAvailabilitySummary {
  siteCount: number;
  walkUpCount: number;
  soonestDate: string | null;
}
export type Preset = "this_weekend" | "next_2_weeks" | "next_month" | "anytime";
export type MinNights = 1 | 2 | 3 | null;
export interface ResolvedLocation { lat: number; lon: number; name: string }
```

- [ ] **Step 2: Write the failing test**

`apps/web/src/features/map/lib/map-utils.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  haversine, todayIso, addDaysIso, formatDate, relativeDate, isoDow, rangeHasWeekendDay,
} from "./map-utils";

describe("haversine", () => {
  it("returns ~0 for identical points", () => {
    expect(haversine(37.7, -122.4, 37.7, -122.4)).toBeCloseTo(0, 5);
  });
  it("returns ~347 miles SF→LA", () => {
    // SF (37.77,-122.42) → LA (34.05,-118.24)
    expect(haversine(37.77, -122.42, 34.05, -118.24)).toBeGreaterThan(340);
    expect(haversine(37.77, -122.42, 34.05, -118.24)).toBeLessThan(355);
  });
});

describe("addDaysIso", () => {
  it("adds days across a month boundary", () => {
    expect(addDaysIso("2026-06-30", 2)).toBe("2026-07-02");
  });
  it("subtracts with negatives", () => {
    expect(addDaysIso("2026-07-01", -1)).toBe("2026-06-30");
  });
});

describe("formatDate", () => {
  it("formats an ISO date as 'Fri, Jun 5'", () => {
    expect(formatDate("2026-06-05")).toBe("Fri, Jun 5");
  });
  it("returns '' for empty input", () => {
    expect(formatDate("")).toBe("");
  });
});

describe("relativeDate", () => {
  it("returns the day before, month+day only", () => {
    expect(relativeDate("2026-06-05")).toBe("Jun 4");
  });
});

describe("isoDow", () => {
  it("returns 5 for a Friday", () => {
    expect(isoDow("2026-06-05")).toBe(5); // 2026-06-05 is a Friday
  });
  it("returns 0 for a Sunday", () => {
    expect(isoDow("2026-06-07")).toBe(0);
  });
});

describe("rangeHasWeekendDay", () => {
  it("true when the range spans a Fri/Sat", () => {
    expect(rangeHasWeekendDay("2026-06-05", "2026-06-08")).toBe(true);
  });
  it("false for a Mon–Thu range", () => {
    expect(rangeHasWeekendDay("2026-06-08", "2026-06-11")).toBe(false);
  });
  it("true (open range) when from or to missing", () => {
    expect(rangeHasWeekendDay("", "2026-06-08")).toBe(true);
  });
});

describe("todayIso", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run from repo root:
```bash
bun --filter @campbrain/web test map-utils
```
Expected: FAIL — "Cannot find module './map-utils'".

- [ ] **Step 4: Implement `map-utils.ts`**

Port from `web/app/map/MapClient.tsx:129-189`. `relativeTime` is included (used by `ParkDetail` in Task 9). Use the local-tz `new Date(y, m-1, d)` construction (matches `@campbrain/core`):

`apps/web/src/features/map/lib/map-utils.ts`:
```ts
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function relativeDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const prev = new Date(y!, m! - 1, d!);
  prev.setDate(prev.getDate() - 1);
  return prev.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function isoDow(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).getDay();
}

export function rangeHasWeekendDay(from: string, to: string): boolean {
  if (!from || !to) return true;
  let cursor = from;
  while (cursor <= to) {
    const dow = isoDow(cursor);
    if (dow === 5 || dow === 6) return true;
    cursor = addDaysIso(cursor, 1);
  }
  return false;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun --filter @campbrain/web test map-utils
```
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/map/lib/types.ts apps/web/src/features/map/lib/map-utils.ts apps/web/src/features/map/lib/map-utils.test.ts
git commit -m "feat(web): map-utils date/geo helpers + shared types"
```

---

## Task 2: `lib/site-taxonomy.ts`

**Source:** `web/lib/site-taxonomy.ts` (entire file). **Adaptation:** the legacy file imports `SiteAccess`/`SiteKind`/`HideTarget` from `../../src/cache/availability-cache.js`. In `apps/web` those literal unions come from `@campbrain/types`/`@campbrain/core` via the `accessSchema`/`kindsSchema`/`hideSchema` enums (`packages/types/src/map.ts`). Define them locally as string-literal unions to avoid coupling the UI lib to a backend package (they match the zod enums exactly).

**Files:**
- Create: `apps/web/src/features/map/lib/site-taxonomy.ts`
- Test: `apps/web/src/features/map/lib/site-taxonomy.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/map/lib/site-taxonomy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  EMPTY_TAXONOMY, taxonomyToParams, isTaxonomyDefault,
  ACCESS_GROUP, KIND_GROUP, HIDE_GROUP,
} from "./site-taxonomy";

describe("taxonomyToParams", () => {
  it("emits no keys for the empty taxonomy", () => {
    expect([...taxonomyToParams(EMPTY_TAXONOMY).keys()]).toEqual([]);
  });
  it("joins each group as CSV", () => {
    const p = taxonomyToParams({ access: ["drive_in", "hike_in"], kinds: ["tent"], hide: ["walk_up"] });
    expect(p.get("access")).toBe("drive_in,hike_in");
    expect(p.get("kinds")).toBe("tent");
    expect(p.get("hide")).toBe("walk_up");
  });
  it("omits a group when its array is empty", () => {
    const p = taxonomyToParams({ access: ["boat_in"], kinds: [], hide: [] });
    expect(p.has("kinds")).toBe(false);
    expect(p.has("hide")).toBe(false);
  });
});

describe("isTaxonomyDefault", () => {
  it("true for EMPTY_TAXONOMY", () => {
    expect(isTaxonomyDefault(EMPTY_TAXONOMY)).toBe(true);
  });
  it("false when any group is non-empty", () => {
    expect(isTaxonomyDefault({ access: [], kinds: ["cabin"], hide: [] })).toBe(false);
  });
});

describe("taxonomy groups", () => {
  it("expose the expected option ids", () => {
    expect(ACCESS_GROUP.options.map((o) => o.id)).toEqual(["drive_in", "hike_in", "boat_in"]);
    expect(KIND_GROUP.options.map((o) => o.id)).toEqual(["tent", "hookup", "cabin"]);
    expect(HIDE_GROUP.options.map((o) => o.id)).toEqual(["group", "equestrian", "walk_up"]);
    expect(HIDE_GROUP.variant).toBe("hide");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun --filter @campbrain/web test site-taxonomy
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `site-taxonomy.ts`**

Port from `web/lib/site-taxonomy.ts`, with local union types (matching `packages/types/src/map.ts` enums):

`apps/web/src/features/map/lib/site-taxonomy.ts`:
```ts
export type SiteAccess = "drive_in" | "hike_in" | "boat_in";
export type SiteKind = "tent" | "hookup" | "cabin";
export type HideTarget = "group" | "equestrian" | "walk_up";

export interface TaxonomyOption<T extends string> { id: T; label: string }
export interface TaxonomyGroup<T extends string> {
  param: "access" | "kinds" | "hide";
  label: string;
  variant: "select" | "hide";
  options: TaxonomyOption<T>[];
}

export const ACCESS_GROUP: TaxonomyGroup<SiteAccess> = {
  param: "access",
  label: "Access",
  variant: "select",
  options: [
    { id: "drive_in", label: "Drive-in" },
    { id: "hike_in", label: "Hike-in" },
    { id: "boat_in", label: "Boat-in" },
  ],
};

export const KIND_GROUP: TaxonomyGroup<SiteKind> = {
  param: "kinds",
  label: "Site kind",
  variant: "select",
  options: [
    { id: "tent", label: "Tent" },
    { id: "hookup", label: "Hookups (RV)" },
    { id: "cabin", label: "Cabin / yurt" },
  ],
};

export const HIDE_GROUP: TaxonomyGroup<HideTarget> = {
  param: "hide",
  label: "Hide",
  variant: "hide",
  options: [
    { id: "group", label: "Group" },
    { id: "equestrian", label: "Equestrian" },
    { id: "walk_up", label: "Walk-up (first-come)" },
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
  if (state.access.length) qp.set("access", state.access.join(","));
  if (state.kinds.length) qp.set("kinds", state.kinds.join(","));
  if (state.hide.length) qp.set("hide", state.hide.join(","));
  return qp;
}

export function isTaxonomyDefault(state: TaxonomyState): boolean {
  return state.access.length === 0 && state.kinds.length === 0 && state.hide.length === 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --filter @campbrain/web test site-taxonomy
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/lib/site-taxonomy.ts apps/web/src/features/map/lib/site-taxonomy.test.ts
git commit -m "feat(web): site-taxonomy groups + param mapping"
```

---

## Task 3: `lib/map-pins.ts`

**Source:** `web/lib/map-pins.ts` (entire file — port VERBATIM; it is pure, no imports). **Adaptation:** none to the code; but its SVG strings reference `var(--accent)`, `var(--walkup)`, `var(--surface)`, `var(--muted)`, `var(--border)`, `var(--text)`, `var(--surface-2)` — those custom properties do NOT exist in `apps/web`'s shadcn token set. They get defined in `map.css` (Task 7). The pin HTML builders are tested here independent of CSS.

**Files:**
- Create: `apps/web/src/features/map/lib/map-pins.ts`
- Test: `apps/web/src/features/map/lib/map-pins.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/map/lib/map-pins.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  getParkType, buildPinHtml, buildClusterHtml, buildLegendSwatchHtml,
  formatCount, PIN_LEGEND, GLYPHS, CLUSTER_SIZE,
} from "./map-pins";

describe("getParkType", () => {
  it("maps california-parks to state", () => {
    expect(getParkType("california-parks")).toBe("state");
  });
  it("maps anything else to federal", () => {
    expect(getParkType("recreation-gov")).toBe("federal");
  });
});

describe("formatCount", () => {
  it("caps at 99+", () => {
    expect(formatCount(150)).toBe("99+");
    expect(formatCount(7)).toBe("7");
  });
});

describe("buildPinHtml", () => {
  it("includes the availability class", () => {
    const html = buildPinHtml({ parkType: "state", availability: "match", count: 3 });
    expect(html).toContain("cb-pin--match");
  });
  it("renders a count badge for match with a count", () => {
    const html = buildPinHtml({ parkType: "state", availability: "match", count: 3 });
    expect(html).toContain(">3<");
  });
  it("omits the badge for the 'none' state", () => {
    const html = buildPinHtml({ parkType: "state", availability: "none", count: 0 });
    expect(html).not.toContain("cb-badge");
  });
  it("draws the selection ring when selected", () => {
    const html = buildPinHtml({ parkType: "state", availability: "match", count: 1, selected: true });
    expect(html).toContain("stroke-width=\"4\"");
  });
  it("uses the state glyph path for a state park", () => {
    const html = buildPinHtml({ parkType: "state", availability: "match", count: 1 });
    expect(html).toContain(GLYPHS.state);
  });
  it("escapes the aria-label", () => {
    const html = buildPinHtml({ parkType: "state", availability: "match", count: 1, label: "A & B \"park\"" });
    expect(html).toContain("aria-label=\"A &amp; B &quot;park&quot;\"");
  });
});

describe("buildClusterHtml", () => {
  it("sizes the icon container to CLUSTER_SIZE", () => {
    const html = buildClusterHtml(10, 4);
    expect(html).toContain(`width:${CLUSTER_SIZE}px`);
    expect(html).toContain(">10<");
  });
  it("marks the cluster as none when no matches", () => {
    expect(buildClusterHtml(10, 0)).toContain("cb-cluster--none");
  });
  it("draws a full ring when all match", () => {
    const html = buildClusterHtml(5, 5);
    expect(html).not.toContain("stroke-dasharray");
  });
  it("draws a partial arc when some match", () => {
    expect(buildClusterHtml(10, 3)).toContain("stroke-dasharray");
  });
});

describe("PIN_LEGEND + swatch", () => {
  it("flags pin-none as only-when-filtered", () => {
    const none = PIN_LEGEND.find((e) => e.kind === "pin-none");
    expect(none?.onlyWhenFiltered).toBe(true);
  });
  it("builds a glyph swatch for state", () => {
    expect(buildLegendSwatchHtml("glyph-state")).toContain(GLYPHS.state);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun --filter @campbrain/web test map-pins
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `map-pins.ts`**

Copy `web/lib/map-pins.ts` lines 1-162 VERBATIM into `apps/web/src/features/map/lib/map-pins.ts` (no imports to rewrite — the file is self-contained). Do not change any SVG/string content.

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --filter @campbrain/web test map-pins
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/lib/map-pins.ts apps/web/src/features/map/lib/map-pins.test.ts
git commit -m "feat(web): map pin + cluster + legend HTML builders"
```

---

## Task 4: small pure helpers (booking-url, site-display, upcoming-weekend, park-list, sheet-detent)

**Sources (port verbatim, adjust nothing — none have imports):** `web/lib/booking-url.ts`, `web/lib/site-display.ts`, `web/lib/upcoming-weekend.ts`, `web/lib/park-list.ts`, `web/lib/sheet-detent.ts`.

**Files:**
- Create: `apps/web/src/features/map/lib/booking-url.ts`
- Create: `apps/web/src/features/map/lib/site-display.ts`
- Create: `apps/web/src/features/map/lib/upcoming-weekend.ts`
- Create: `apps/web/src/features/map/lib/park-list.ts`
- Create: `apps/web/src/features/map/lib/sheet-detent.ts`
- Test: `apps/web/src/features/map/lib/pure-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/map/lib/pure-helpers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { injectBookingDates } from "./booking-url";
import { formatSiteName } from "./site-display";
import { upcomingWeekendRange } from "./upcoming-weekend";
import { sortParkRows, type ParkListRow } from "./park-list";
import { cycleDetent } from "./sheet-detent";

describe("injectBookingDates", () => {
  it("overwrites date + night params", () => {
    const out = injectBookingDates("https://x.com/r?date=2026-11-22&night=1", "2026-07-04", 3);
    expect(out).toContain("date=2026-07-04");
    expect(out).toContain("night=3");
  });
  it("returns the original string when the URL is unparseable", () => {
    expect(injectBookingDates("not-a-url", "2026-07-04", 2)).toBe("not-a-url");
  });
});

describe("formatSiteName", () => {
  it("title-cases all-caps words", () => {
    expect(formatSiteName("UPPER PINES")).toBe("Upper Pines");
  });
  it("leaves #-prefixed codes and digit tokens untouched", () => {
    expect(formatSiteName("#GTC 12B")).toBe("#GTC 12B");
  });
});

describe("upcomingWeekendRange", () => {
  it("returns Fri→Mon for a Wednesday", () => {
    // 2026-06-03 is a Wednesday → Friday 2026-06-05 .. Monday 2026-06-08
    const r = upcomingWeekendRange(new Date(2026, 5, 3));
    expect(r).toEqual({ from: "2026-06-05", to: "2026-06-08" });
  });
  it("keeps the in-progress weekend on Saturday (today→Mon)", () => {
    // 2026-06-06 is a Saturday → today .. Monday 2026-06-08
    const r = upcomingWeekendRange(new Date(2026, 5, 6));
    expect(r).toEqual({ from: "2026-06-06", to: "2026-06-08" });
  });
});

describe("sortParkRows", () => {
  const rows: ParkListRow[] = [
    { parkPageId: "1", parkName: "Bravo", isFederal: false, siteCount: 2, walkUpCount: 0, distanceMi: 30, soonestDate: "2026-07-10" },
    { parkPageId: "2", parkName: "Alpha", isFederal: false, siteCount: 5, walkUpCount: 0, distanceMi: 10, soonestDate: "2026-07-05" },
    { parkPageId: "3", parkName: "Charlie", isFederal: false, siteCount: 5, walkUpCount: 0, distanceMi: null, soonestDate: null },
  ];
  it("sorts by sites desc, name asc as tiebreak", () => {
    expect(sortParkRows(rows, "sites").map((r) => r.parkPageId)).toEqual(["2", "3", "1"]);
  });
  it("sorts by name", () => {
    expect(sortParkRows(rows, "name").map((r) => r.parkName)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });
  it("sorts by distance, nulls last", () => {
    expect(sortParkRows(rows, "distance").map((r) => r.parkPageId)).toEqual(["2", "1", "3"]);
  });
  it("sorts by soonest, nulls last", () => {
    expect(sortParkRows(rows, "soonest").map((r) => r.parkPageId)).toEqual(["2", "1", "3"]);
  });
});

describe("cycleDetent", () => {
  it("cycles peek → half → full → peek", () => {
    expect(cycleDetent("peek")).toBe("half");
    expect(cycleDetent("half")).toBe("full");
    expect(cycleDetent("full")).toBe("peek");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun --filter @campbrain/web test pure-helpers
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the five helpers (verbatim ports)**

Copy each legacy file verbatim:
- `apps/web/src/features/map/lib/booking-url.ts` ← `web/lib/booking-url.ts` (lines 1-22)
- `apps/web/src/features/map/lib/site-display.ts` ← `web/lib/site-display.ts` (lines 1-19)
- `apps/web/src/features/map/lib/upcoming-weekend.ts` ← `web/lib/upcoming-weekend.ts` (lines 1-26)
- `apps/web/src/features/map/lib/park-list.ts` ← `web/lib/park-list.ts` (lines 1-29; exports `ParkListSort`, `ParkListRow`, `sortParkRows`)
- `apps/web/src/features/map/lib/sheet-detent.ts` ← `web/lib/sheet-detent.ts` (lines 1-7; exports `SheetDetent`, `cycleDetent`)

None of these import anything, so no path rewrites are needed.

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --filter @campbrain/web test pure-helpers
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/lib/booking-url.ts apps/web/src/features/map/lib/site-display.ts apps/web/src/features/map/lib/upcoming-weekend.ts apps/web/src/features/map/lib/park-list.ts apps/web/src/features/map/lib/sheet-detent.ts apps/web/src/features/map/lib/pure-helpers.test.ts
git commit -m "feat(web): booking-url, site-display, weekend-range, park-list, sheet-detent helpers"
```

---

## Task 5: `lib/stay-tiers.ts` (NEW — extracted weekend-tier + intersection logic)

**Source of behavior:** `web/app/map/MapClient.tsx`. The weekend-tier visibility rules live inline in `WeekendRow` (`:307-393`); the dates-view consecutive-night intersection lives in `DetailPanel`'s `processedDates` memo (`:432-463`). This task pulls **pure** functions out so they are unit-testable. They operate on the `@campbrain/core` response shapes `WeekendEntry`/`WeekendCampground` and `AvailableDateEntry`/`AvailableDateCampground`.

**Two functions:**

1. `selectWeekendTiers(cg, minNights)` → which of the 5 tiers (3N / 2N-Fri / 2N-Sat / 1N-Fri / 1N-Sat) are visible for a campground given `minNights`, exactly mirroring `WeekendRow`'s per-campground logic (`:362-372`):
   - `show3Night = minNights !== 1`; `show2Night = minNights !== 1 && minNights !== 3`; `show3NightOnly = minNights === 3`.
   - `line3 = show3Night && cg.sites3Night.length > 0`.
   - `line2Fri = show2Night && !show3NightOnly && cg.sites2NightFri.length > 0 && !line3`.
   - `line2Sat = show2Night && !show3NightOnly && cg.sites2NightSat.length > 0 && !line3`.
   - `longerShown = line3 || line2Fri || line2Sat`.
   - `show1Night = minNights === 1 || (minNights === null && !longerShown)`.
   - `line1Fri = show1Night && cg.sites1NightFri.length > 0`; `line1Sat = show1Night && cg.sites1NightSat.length > 0`.
   - returns `{ line3, line2Fri, line2Sat, line1Fri, line1Sat }` (all booleans). The component renders a `TierLine` per `true` flag (Task 9).

2. `intersectConsecutiveDates(dates, minNights)` → for the dates view when `minNights >= 2`, port `processedDates` (`:436-460`): chain N consecutive `AvailableDateEntry`s (via `addDaysIso`), intersect each campground's `sites` across the chain, drop campgrounds/entries that go empty, and set `walkUpSites: []` + `availableSiteCount = sites.length` on the survivors. When `minNights` is `null` or `1`, return `dates` unchanged.

**Files:**
- Create: `apps/web/src/features/map/lib/stay-tiers.ts`
- Test: `apps/web/src/features/map/lib/stay-tiers.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/map/lib/stay-tiers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { WeekendCampground, AvailableDateEntry } from "@campbrain/core";
import { selectWeekendTiers, intersectConsecutiveDates } from "./stay-tiers";

function cg(over: Partial<WeekendCampground>): WeekendCampground {
  return {
    name: "Loop A",
    nightlyFee: 35,
    sites3Night: [],
    sites2NightFri: [],
    sites2NightSat: [],
    sites1NightFri: [],
    sites1NightSat: [],
    walkUpSites: [],
    ...over,
  };
}

describe("selectWeekendTiers", () => {
  it("minNights=null: full 3N suppresses the shorter tiers", () => {
    const r = selectWeekendTiers(cg({ sites3Night: ["1"], sites2NightFri: ["1"], sites1NightFri: ["1"] }), null);
    expect(r).toEqual({ line3: true, line2Fri: false, line2Sat: false, line1Fri: false, line1Sat: false });
  });
  it("minNights=null: with no 3N, a 2N-Fri suppresses 1N", () => {
    const r = selectWeekendTiers(cg({ sites2NightFri: ["1"], sites1NightFri: ["1"], sites1NightSat: ["2"] }), null);
    expect(r).toEqual({ line3: false, line2Fri: true, line2Sat: false, line1Fri: false, line1Sat: false });
  });
  it("minNights=null: only 1N available shows both 1N lines", () => {
    const r = selectWeekendTiers(cg({ sites1NightFri: ["1"], sites1NightSat: ["2"] }), null);
    expect(r).toEqual({ line3: false, line2Fri: false, line2Sat: false, line1Fri: true, line1Sat: true });
  });
  it("minNights=1: forces 1N lines even when longer stays exist", () => {
    const r = selectWeekendTiers(cg({ sites3Night: ["1"], sites1NightFri: ["1"] }), 1);
    expect(r).toEqual({ line3: false, line2Fri: false, line2Sat: false, line1Fri: true, line1Sat: false });
  });
  it("minNights=2: shows 3N and 2N, never 1N", () => {
    const r = selectWeekendTiers(cg({ sites2NightSat: ["1"], sites1NightSat: ["1"] }), 2);
    expect(r).toEqual({ line3: false, line2Fri: false, line2Sat: true, line1Fri: false, line1Sat: false });
  });
  it("minNights=3: only the 3N tier, never 2N/1N", () => {
    const r = selectWeekendTiers(cg({ sites3Night: ["1"], sites2NightFri: ["1"], sites1NightFri: ["1"] }), 3);
    expect(r).toEqual({ line3: true, line2Fri: false, line2Sat: false, line1Fri: false, line1Sat: false });
  });
  it("minNights=3 with no 3N stay: nothing visible", () => {
    const r = selectWeekendTiers(cg({ sites2NightFri: ["1"], sites1NightFri: ["1"] }), 3);
    expect(r).toEqual({ line3: false, line2Fri: false, line2Sat: false, line1Fri: false, line1Sat: false });
  });
});

describe("intersectConsecutiveDates", () => {
  function entry(date: string, sites: string[]): AvailableDateEntry {
    return {
      date,
      dayLabel: date,
      isWeekend: false,
      campgrounds: [
        { name: "Loop A", nightlyFee: 35, availableSiteCount: sites.length, sites, walkUpSites: [] },
      ],
    };
  }

  it("returns input unchanged for minNights null", () => {
    const dates = [entry("2026-06-05", ["1"])];
    expect(intersectConsecutiveDates(dates, null)).toBe(dates);
  });
  it("returns input unchanged for minNights 1", () => {
    const dates = [entry("2026-06-05", ["1"])];
    expect(intersectConsecutiveDates(dates, 1)).toBe(dates);
  });
  it("minNights=2: keeps only dates with a 2-night chain, intersecting sites", () => {
    // site '1' is on both Jun 5 and Jun 6 → a valid 2-night stay from Jun 5.
    // site '2' is only on Jun 5 → excluded. Jun 6 has no Jun 7 follow-on → dropped.
    const dates = [
      entry("2026-06-05", ["1", "2"]),
      entry("2026-06-06", ["1"]),
    ];
    const out = intersectConsecutiveDates(dates, 2);
    expect(out).toHaveLength(1);
    expect(out[0]!.date).toBe("2026-06-05");
    expect(out[0]!.campgrounds[0]!.sites).toEqual(["1"]);
    expect(out[0]!.campgrounds[0]!.availableSiteCount).toBe(1);
    expect(out[0]!.campgrounds[0]!.walkUpSites).toEqual([]);
  });
  it("minNights=2: drops a date when the next day is missing entirely", () => {
    const dates = [entry("2026-06-05", ["1"])]; // no Jun 6 entry
    expect(intersectConsecutiveDates(dates, 2)).toEqual([]);
  });
  it("minNights=3: requires three consecutive days; site available all three survives", () => {
    const dates = [
      entry("2026-06-05", ["1"]),
      entry("2026-06-06", ["1"]),
      entry("2026-06-07", ["1"]),
    ];
    const out = intersectConsecutiveDates(dates, 3);
    expect(out).toHaveLength(1);
    expect(out[0]!.date).toBe("2026-06-05");
    expect(out[0]!.campgrounds[0]!.sites).toEqual(["1"]);
  });
  it("minNights=3: a Fri-only site does not survive a 3-night chain", () => {
    const dates = [
      entry("2026-06-05", ["1"]),
      entry("2026-06-06", []),
      entry("2026-06-07", ["1"]),
    ];
    expect(intersectConsecutiveDates(dates, 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun --filter @campbrain/web test stay-tiers
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `stay-tiers.ts`**

Port the inline logic from `MapClient.tsx:362-372` (tier select) and `:436-460` (intersection):

`apps/web/src/features/map/lib/stay-tiers.ts`:
```ts
import type { WeekendCampground, AvailableDateEntry } from "@campbrain/core";
import { addDaysIso } from "./map-utils";
import type { MinNights } from "./types";

export interface WeekendTierFlags {
  line3: boolean;
  line2Fri: boolean;
  line2Sat: boolean;
  line1Fri: boolean;
  line1Sat: boolean;
}

/** Which weekend stay-tier lines are visible for a campground given minNights.
 *  Mirrors the inline per-campground rules in the legacy WeekendRow. */
export function selectWeekendTiers(cg: WeekendCampground, minNights: MinNights): WeekendTierFlags {
  const show3Night = minNights !== 1; // null/2/3
  const show2Night = minNights !== 1 && minNights !== 3; // null/2
  const show3NightOnly = minNights === 3;

  const line3 = show3Night && cg.sites3Night.length > 0;
  const line2Fri = show2Night && !show3NightOnly && cg.sites2NightFri.length > 0 && !line3;
  const line2Sat = show2Night && !show3NightOnly && cg.sites2NightSat.length > 0 && !line3;
  const longerShown = line3 || line2Fri || line2Sat;
  const show1Night = minNights === 1 || (minNights === null && !longerShown);
  const line1Fri = show1Night && cg.sites1NightFri.length > 0;
  const line1Sat = show1Night && cg.sites1NightSat.length > 0;

  return { line3, line2Fri, line2Sat, line1Fri, line1Sat };
}

/** For the dates view with minNights >= 2, keep only dates that anchor a full
 *  N-consecutive-night chain, intersecting each campground's sites across the chain.
 *  minNights null/1 → input returned unchanged (same reference). */
export function intersectConsecutiveDates(
  dates: AvailableDateEntry[],
  minNights: MinNights,
): AvailableDateEntry[] {
  if (minNights === null || minNights < 2) return dates;

  const byDate = new Map(dates.map((d) => [d.date, d]));
  return dates.flatMap((entry) => {
    const chain: AvailableDateEntry[] = [entry];
    for (let i = 1; i < minNights; i++) {
      const next = byDate.get(addDaysIso(entry.date, i));
      if (!next) return [];
      chain.push(next);
    }
    const campgrounds = entry.campgrounds.flatMap((cg) => {
      let sitesIntersection = cg.sites;
      for (let i = 1; i < chain.length; i++) {
        const chainCg = chain[i]!.campgrounds.find((c) => c.name === cg.name);
        if (!chainCg) return [];
        sitesIntersection = sitesIntersection.filter((s) => chainCg.sites.includes(s));
      }
      if (sitesIntersection.length === 0) return [];
      return [{ ...cg, sites: sitesIntersection, walkUpSites: [], availableSiteCount: sitesIntersection.length }];
    });
    if (campgrounds.length === 0) return [];
    return [{ ...entry, campgrounds }];
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --filter @campbrain/web test stay-tiers
```
Expected: PASS (all branches).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/lib/stay-tiers.ts apps/web/src/features/map/lib/stay-tiers.test.ts
git commit -m "feat(web): stay-tiers weekend-tier select + consecutive-night intersection"
```

---

## Task 6: data + filter hooks

Four hooks. The pure derivations (summary sentence, active-filter count, default-state check, filtered-parks/list-rows) are extracted into a tested module `lib/filter-derivations.ts`; the hooks themselves wrap state + tRPC `useQuery` and are verified visually in later tasks.

**Sources:** `MapClient.tsx` state block (`:599-631`), preset/geocode/reset handlers (`:633-862`), summary effect (`:673-692`), derived memos (`:694-796`), `useParkAvailability` (`:201-251`).

**Files:**
- Create: `apps/web/src/features/map/lib/filter-derivations.ts`
- Test: `apps/web/src/features/map/lib/filter-derivations.test.ts`
- Create: `apps/web/src/features/map/hooks/use-map-filters.ts`
- Create: `apps/web/src/features/map/hooks/use-map-summary.ts`
- Create: `apps/web/src/features/map/hooks/use-park-availability.ts`
- Create: `apps/web/src/features/map/hooks/use-filtered-parks.ts`

- [ ] **Step 1: Write the failing test for the pure derivations**

`apps/web/src/features/map/lib/filter-derivations.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { MapPark } from "@campbrain/core";
import { EMPTY_TAXONOMY } from "./site-taxonomy";
import type { ParkAvailabilitySummary } from "./types";
import {
  computeActiveFilterCount, buildAvailByPark, computeFilteredParks, buildListRows,
} from "./filter-derivations";

function park(over: Partial<MapPark>): MapPark {
  return {
    provider: "california-parks",
    parkName: "Park",
    parkPageId: "1",
    latitude: 37,
    longitude: -122,
    campgroundCount: 1,
    siteCount: 10,
    campgrounds: [{ name: "Loop A", siteCount: 10 }],
    ...over,
  };
}

describe("computeActiveFilterCount", () => {
  it("counts taxonomy + minNights + resolved distance", () => {
    const n = computeActiveFilterCount(
      { access: ["drive_in"], kinds: ["tent"], hide: [] },
      2,
      { lat: 1, lon: 2, name: "x" },
      50,
    );
    expect(n).toBe(4); // 1 access + 1 kind + 1 minNights + 1 distance
  });
  it("is 0 at defaults", () => {
    expect(computeActiveFilterCount(EMPTY_TAXONOMY, null, null, null)).toBe(0);
  });
});

describe("buildAvailByPark", () => {
  it("keys ParkAvailabilityCount[] by parkPageId", () => {
    const m = buildAvailByPark([
      { parkPageId: "1", siteCount: 3, walkUpCount: 0, soonestDate: "2026-07-01" },
      { parkPageId: "2", siteCount: 0, walkUpCount: 2, soonestDate: null },
    ]);
    expect(m.get("1")).toEqual({ siteCount: 3, walkUpCount: 0, soonestDate: "2026-07-01" });
    expect(m.get("2")?.walkUpCount).toBe(2);
  });
  it("returns null for null input", () => {
    expect(buildAvailByPark(null)).toBeNull();
  });
});

describe("computeFilteredParks", () => {
  const parks = [park({ parkPageId: "1", latitude: 37, longitude: -122 }), park({ parkPageId: "2", latitude: 34, longitude: -118 })];
  it("returns all parks when no location + no availability", () => {
    expect(computeFilteredParks(parks, null, null, null).map((p) => p.parkPageId)).toEqual(["1", "2"]);
  });
  it("hard-filters by distance", () => {
    const out = computeFilteredParks(parks, { lat: 37, lon: -122, name: "x" }, 50, null);
    expect(out.map((p) => p.parkPageId)).toEqual(["1"]); // park 2 is ~350mi away
  });
  it("filters to parks with bookable availability", () => {
    const avail = new Map<string, ParkAvailabilitySummary>([
      ["1", { siteCount: 3, walkUpCount: 0, soonestDate: null }],
      ["2", { siteCount: 0, walkUpCount: 5, soonestDate: null }],
    ]);
    expect(computeFilteredParks(parks, null, null, avail).map((p) => p.parkPageId)).toEqual(["1"]);
  });
});

describe("buildListRows", () => {
  const parks = [park({ parkPageId: "1", latitude: 37, longitude: -122 })];
  it("includes walk-up-only parks (siteCount 0, walkUpCount > 0)", () => {
    const avail = new Map<string, ParkAvailabilitySummary>([["1", { siteCount: 0, walkUpCount: 4, soonestDate: null }]]);
    const rows = buildListRows(parks, avail, { lat: 37, lon: -122, name: "x" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.walkUpCount).toBe(4);
    expect(rows[0]!.distanceMi).toBeCloseTo(0, 1);
  });
  it("excludes parks with no availability at all", () => {
    const avail = new Map<string, ParkAvailabilitySummary>([["1", { siteCount: 0, walkUpCount: 0, soonestDate: null }]]);
    expect(buildListRows(parks, avail, null)).toEqual([]);
  });
  it("returns [] when availByPark is null", () => {
    expect(buildListRows(parks, null, null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun --filter @campbrain/web test filter-derivations
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `filter-derivations.ts`**

Port from `MapClient.tsx:704-771` (filtered parks, availByPark, listRows) and `:793-796` (activeFilterCount), collapsing `facilityPageIds` → `parkPageId` per adaptation 4/5:

`apps/web/src/features/map/lib/filter-derivations.ts`:
```ts
import type { MapPark } from "@campbrain/core";
import { haversine } from "./map-utils";
import { getParkType } from "./map-pins";
import type { ParkListRow } from "./park-list";
import type { ParkAvailabilitySummary, ResolvedLocation, MinNights } from "./types";
import type { TaxonomyState } from "./site-taxonomy";

export interface ParkCount {
  parkPageId: string;
  siteCount: number;
  walkUpCount: number;
  soonestDate: string | null;
}

export function computeActiveFilterCount(
  taxonomy: TaxonomyState,
  minNights: MinNights,
  resolvedLocation: ResolvedLocation | null,
  distanceMiles: number | null,
): number {
  return (
    taxonomy.access.length +
    taxonomy.kinds.length +
    taxonomy.hide.length +
    (minNights !== null ? 1 : 0) +
    (resolvedLocation && distanceMiles !== null ? 1 : 0)
  );
}

export function buildAvailByPark(parks: ParkCount[] | null): Map<string, ParkAvailabilitySummary> | null {
  if (!parks) return null;
  return new Map(
    parks.map((p) => [p.parkPageId, { siteCount: p.siteCount, walkUpCount: p.walkUpCount, soonestDate: p.soonestDate ?? null }]),
  );
}

function withinDistance(p: MapPark, loc: ResolvedLocation, miles: number): boolean {
  if (!p.latitude || !p.longitude) return false;
  return haversine(loc.lat, loc.lon, p.latitude, p.longitude) <= miles;
}

/** Parks that pass the distance hard-filter AND have bookable availability (siteCount > 0). */
export function computeFilteredParks(
  parks: MapPark[],
  resolvedLocation: ResolvedLocation | null,
  distanceMiles: number | null,
  availByPark: Map<string, ParkAvailabilitySummary> | null,
): MapPark[] {
  let result = parks;
  if (resolvedLocation && distanceMiles !== null) {
    result = result.filter((p) => withinDistance(p, resolvedLocation, distanceMiles));
  }
  if (availByPark !== null) {
    result = result.filter((p) => (availByPark.get(p.parkPageId)?.siteCount ?? 0) > 0);
  }
  return result;
}

/** Distance-filtered parks with any availability (bookable OR walk-up), shaped for the drawer. */
export function buildListRows(
  displayedParks: MapPark[],
  availByPark: Map<string, ParkAvailabilitySummary> | null,
  resolvedLocation: ResolvedLocation | null,
): ParkListRow[] {
  if (!availByPark) return [];
  return displayedParks.flatMap((p) => {
    const a = availByPark.get(p.parkPageId);
    if (!a || (a.siteCount === 0 && a.walkUpCount === 0)) return [];
    return [{
      parkPageId: p.parkPageId,
      parkName: p.parkName,
      isFederal: getParkType(p.provider) === "federal",
      siteCount: a.siteCount,
      walkUpCount: a.walkUpCount,
      distanceMi: resolvedLocation && p.latitude && p.longitude
        ? haversine(resolvedLocation.lat, resolvedLocation.lon, p.latitude, p.longitude)
        : null,
      soonestDate: a.soonestDate,
    }];
  });
}
```

- [ ] **Step 4: Run the derivations test to verify it passes**

```bash
bun --filter @campbrain/web test filter-derivations
```
Expected: PASS.

- [ ] **Step 5: Implement `use-map-filters.ts` (state + handlers)**

Port the state + handlers from `MapClient.tsx:599-862`. This is a stateful hook (no unit test — exercised visually). It owns all filter state and exposes setters + derived values. The summary-sentence parts are computed here from the helpers.

`apps/web/src/features/map/hooks/use-map-filters.ts`:
```ts
import { useState, useEffect, useCallback } from "react";
import { EMPTY_TAXONOMY, isTaxonomyDefault } from "../lib/site-taxonomy";
import type { TaxonomyState, SiteAccess } from "../lib/site-taxonomy";
import { upcomingWeekendRange } from "../lib/upcoming-weekend";
import { todayIso, addDaysIso, formatDate } from "../lib/map-utils";
import { computeActiveFilterCount } from "../lib/filter-derivations";
import type { Preset, MinNights, ResolvedLocation } from "../lib/types";

const ACCESS_LABEL: Record<SiteAccess, string> = {
  drive_in: "drive-in",
  hike_in: "hike-in",
  boat_in: "boat-in",
};

export interface MapFilters {
  taxonomy: TaxonomyState;
  setTaxonomy: (t: TaxonomyState) => void;
  minNights: MinNights;
  setMinNights: (n: MinNights) => void;
  preset: Preset;
  applyPreset: (p: Preset) => void;
  weekendsOnly: boolean;
  setWeekendsOnly: (v: boolean | ((prev: boolean) => boolean)) => void;
  availFrom: string;
  availTo: string;
  setDates: (from: string, to: string) => void;
  locationQuery: string;
  setLocationQuery: (q: string) => void;
  resolvedLocation: ResolvedLocation | null;
  setResolvedLocation: (l: ResolvedLocation | null) => void;
  distanceMiles: number | null;
  setDistanceMiles: (d: number | null) => void;
  geocoding: boolean;
  geocodeError: string | null;
  setGeocodeError: (e: string | null) => void;
  handleGeocode: () => Promise<void>;
  handleCurrentLocation: () => void;
  reset: () => void;
  activeFilterCount: number;
  isDefaultState: boolean;
  summaryParts: string[];
  summaryDateClause: string;
  summaryNearClause: string;
}

export function useMapFilters(): MapFilters {
  const [taxonomy, setTaxonomy] = useState<TaxonomyState>(EMPTY_TAXONOMY);
  const [minNights, setMinNights] = useState<MinNights>(null);
  const [preset, setPreset] = useState<Preset>("this_weekend");
  const [weekendsOnly, setWeekendsOnly] = useState(true);
  const [availFrom, setAvailFrom] = useState("");
  const [availTo, setAvailTo] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [resolvedLocation, setResolvedLocation] = useState<ResolvedLocation | null>(null);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  const applyPreset = useCallback((p: Preset) => {
    setPreset(p);
    if (p === "this_weekend") {
      const { from, to } = upcomingWeekendRange(new Date());
      setAvailFrom(from);
      setAvailTo(to);
      setWeekendsOnly(true);
    } else if (p === "next_2_weeks") {
      setAvailFrom(todayIso());
      setAvailTo(addDaysIso(todayIso(), 14));
    } else if (p === "next_month") {
      setAvailFrom(todayIso());
      setAvailTo(addDaysIso(todayIso(), 30));
    } else {
      setAvailFrom(todayIso());
      setAvailTo("");
    }
  }, []);

  // Default to the upcoming weekend on first mount (legacy :655-659).
  useEffect(() => {
    const { from, to } = upcomingWeekendRange(new Date());
    setAvailFrom(from);
    setAvailTo(to);
  }, []);

  const derivePreset = useCallback((from: string, to: string): Preset | null => {
    const wk = upcomingWeekendRange(new Date());
    if (from === wk.from && to === wk.to) return "this_weekend";
    const today = todayIso();
    if (from === today && to === addDaysIso(today, 14)) return "next_2_weeks";
    if (from === today && to === addDaysIso(today, 30)) return "next_month";
    if (from === today && to === "") return "anytime";
    return null;
  }, []);

  const setDates = useCallback((from: string, to: string) => {
    setAvailFrom(from);
    setAvailTo(to);
    const derived = derivePreset(from, to);
    if (derived) setPreset(derived);
  }, [derivePreset]);

  const handleGeocode = useCallback(async () => {
    const q = locationQuery.trim();
    if (!q) return;
    setGeocoding(true);
    setGeocodeError(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`;
      const res = await fetch(url, { headers: { "User-Agent": "CampBrain/1.0 (personal camping assistant)" } });
      const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (!data[0]) {
        setGeocodeError("Location not found — try a city name");
        return;
      }
      setResolvedLocation({
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
        name: data[0].display_name.split(",").slice(0, 2).join(",").trim(),
      });
    } catch {
      setGeocodeError("Geocoding failed");
    } finally {
      setGeocoding(false);
    }
  }, [locationQuery]);

  const handleCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeocodeError("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setResolvedLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: "My location" });
        setLocationQuery("My location");
        setGeocodeError(null);
      },
      () => setGeocodeError("Location access denied"),
    );
  }, []);

  const reset = useCallback(() => {
    setTaxonomy(EMPTY_TAXONOMY);
    setMinNights(null);
    setWeekendsOnly(true);
    setLocationQuery("");
    setResolvedLocation(null);
    setDistanceMiles(null);
    setGeocodeError(null);
    applyPreset("this_weekend");
  }, [applyPreset]);

  const isDefaultState =
    preset === "this_weekend" && weekendsOnly && minNights === null &&
    isTaxonomyDefault(taxonomy) && resolvedLocation === null;

  const activeFilterCount = computeActiveFilterCount(taxonomy, minNights, resolvedLocation, distanceMiles);

  const summaryParts: string[] = [];
  if (minNights) summaryParts.push(`${minNights}-night`);
  if (taxonomy.access.length === 1) summaryParts.push(ACCESS_LABEL[taxonomy.access[0]!]);
  if (weekendsOnly) summaryParts.push("weekend");
  summaryParts.push("stay");
  const summaryDateClause = availTo ? ` ${formatDate(availFrom)} – ${formatDate(availTo)}` : " anytime";
  const summaryNearClause = resolvedLocation && distanceMiles ? ` within ${distanceMiles} mi of ${resolvedLocation.name}` : "";

  return {
    taxonomy, setTaxonomy, minNights, setMinNights, preset, applyPreset,
    weekendsOnly, setWeekendsOnly, availFrom, availTo, setDates,
    locationQuery, setLocationQuery, resolvedLocation, setResolvedLocation,
    distanceMiles, setDistanceMiles, geocoding, geocodeError, setGeocodeError,
    handleGeocode, handleCurrentLocation, reset,
    activeFilterCount, isDefaultState, summaryParts, summaryDateClause, summaryNearClause,
  };
}
```

- [ ] **Step 6: Implement `use-map-summary.ts` (tRPC summary + debounce)**

Replaces the legacy 400ms summary effect (`:673-692`) with a debounced filter snapshot feeding a `useQuery`. `availByPark` is derived from the response via `buildAvailByPark`.

`apps/web/src/features/map/hooks/use-map-summary.ts`:
```ts
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/trpc";
import { buildAvailByPark } from "../lib/filter-derivations";
import type { TaxonomyState } from "../lib/site-taxonomy";
import type { MinNights, ParkAvailabilitySummary } from "../lib/types";

interface SummaryArgs {
  availFrom: string;
  availTo: string;
  taxonomy: TaxonomyState;
  weekendsOnly: boolean;
  minNights: MinNights;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function useMapSummary(args: SummaryArgs): {
  availByPark: Map<string, ParkAvailabilitySummary> | null;
  loading: boolean;
} {
  // Stable JSON snapshot so the debounce + queryKey only change on real edits.
  const snapshot = useMemo(
    () => JSON.stringify({
      from: args.availFrom || undefined,
      to: args.availTo || undefined,
      weekendsOnly: args.weekendsOnly,
      access: args.taxonomy.access,
      kinds: args.taxonomy.kinds,
      hide: args.taxonomy.hide,
      minNights: args.minNights ?? undefined,
    }),
    [args.availFrom, args.availTo, args.weekendsOnly, args.taxonomy, args.minNights],
  );
  const debouncedSnapshot = useDebounced(snapshot, 400);

  const query = useQuery({
    queryKey: ["map", "summary", debouncedSnapshot],
    queryFn: () => api.map.summary.query(JSON.parse(debouncedSnapshot)),
  });

  const availByPark = useMemo(
    () => buildAvailByPark(query.data?.parks ?? null),
    [query.data],
  );

  return { availByPark, loading: query.isFetching };
}
```

- [ ] **Step 7: Implement `use-park-availability.ts` (tRPC availability)**

Replaces `useParkAvailability` (`:201-251`). TanStack Query replaces the hand-rolled cache. NOTE: do NOT pass `minNights`/`weekendsOnly` to `api.map.availability` (the 1d-1 input does not accept them — adaptation 1).

`apps/web/src/features/map/hooks/use-park-availability.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/trpc";
import type { ParkAvailabilityResponse } from "@campbrain/core";
import type { TaxonomyState } from "../lib/site-taxonomy";

interface Args {
  parkPageId: string | null;
  provider?: string;
  from: string;
  to: string;
  taxonomy: TaxonomyState;
}

export function useParkAvailability(args: Args): {
  data: ParkAvailabilityResponse | null;
  loading: boolean;
  error: boolean;
} {
  const { parkPageId, provider, from, to, taxonomy } = args;
  const input = {
    parkPageId: parkPageId ?? "",
    provider,
    from: from || undefined,
    to: to || undefined,
    access: taxonomy.access,
    kinds: taxonomy.kinds,
    hide: taxonomy.hide,
  };
  const query = useQuery({
    queryKey: ["map", "availability", input],
    queryFn: () => api.map.availability.query(input),
    enabled: parkPageId !== null,
  });
  return { data: query.data ?? null, loading: query.isLoading, error: query.isError };
}
```

- [ ] **Step 8: Implement `use-filtered-parks.ts`**

Wraps the pure derivations from `filter-derivations.ts` into memoized values consumed by `MapView` + `ResultsDrawer`.

`apps/web/src/features/map/hooks/use-filtered-parks.ts`:
```ts
import { useMemo } from "react";
import type { MapPark } from "@campbrain/core";
import { computeFilteredParks, buildListRows } from "../lib/filter-derivations";
import type { ParkListRow } from "../lib/park-list";
import type { ParkAvailabilitySummary, ResolvedLocation } from "../lib/types";

interface Args {
  parks: MapPark[];
  resolvedLocation: ResolvedLocation | null;
  distanceMiles: number | null;
  availByPark: Map<string, ParkAvailabilitySummary> | null;
}

export function useFilteredParks(args: Args): {
  displayedParks: MapPark[];
  matchCount: number;
  listRows: ParkListRow[];
} {
  const { parks, resolvedLocation, distanceMiles, availByPark } = args;

  // displayedParks = distance-filtered, with coords (pins). Availability greys pins
  // out in MapView; it does NOT remove them, so do not pass availByPark here.
  const displayedParks = useMemo(() => {
    const withCoords = parks.filter((p) => p.latitude && p.longitude);
    return computeFilteredParks(withCoords, resolvedLocation, distanceMiles, null);
  }, [parks, resolvedLocation, distanceMiles]);

  // matchCount = parks with bookable availability (for the summary sentence).
  const matchCount = useMemo(
    () => computeFilteredParks(parks, resolvedLocation, distanceMiles, availByPark).length,
    [parks, resolvedLocation, distanceMiles, availByPark],
  );

  const listRows = useMemo(
    () => buildListRows(displayedParks, availByPark, resolvedLocation),
    [displayedParks, availByPark, resolvedLocation],
  );

  return { displayedParks, matchCount, listRows };
}
```

- [ ] **Step 9: Typecheck the hooks**

```bash
bun --filter @campbrain/web typecheck
```
Expected: PASS (the hooks reference only already-created modules + `@campbrain/core` types + `@/lib/trpc`).

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/features/map/lib/filter-derivations.ts apps/web/src/features/map/lib/filter-derivations.test.ts apps/web/src/features/map/hooks
git commit -m "feat(web): map filter derivations + filter/summary/availability/parks hooks"
```

---

## Task 7: Leaflet layer (map.css + MarkerClusterGroup + MapLegend + MapView)

**Sources:** `web/app/map/LeafletMap.tsx` (MapView body), `web/app/map/MarkerClusterGroup.tsx`, `web/app/map/MapLegend.tsx`, `web/app/map/pin-icons.ts`.

**Key adaptations:**
- Adaptation 2: drop `'use client'`; import `leaflet`/`react-leaflet` directly.
- The pin/cluster HTML (`map-pins.ts`) references CSS custom properties that do NOT exist in `apps/web` (verified: `apps/web/src/index.css` has shadcn's `--accent` as near-white, and no `--walkup`/`--green`/`--surface`/`--surface-2`/`--surface-sunken`/`--border`/`--text`/`--muted` in the legacy sense). **Define them as scoped variables in `map.css`** with the legacy values (read `web/app/globals.css` `:root` for the source values — accent green `#3ecf8e`-family, walkup orange, etc.). Scope them under the map root so they don't leak into shadcn components.
- The Vite marker-icon fix: import the three Leaflet PNGs as URLs and `L.Icon.Default.mergeOptions` (needed even though pins use `divIcon`, because `CircleMarker`/default markers can still pull the broken icon path under Vite).
- `availability` summary type is `Map<string, ParkAvailabilitySummary>` (from our shared types).

**Files:**
- Create: `apps/web/src/features/map/map.css`
- Create: `apps/web/src/features/map/components/MarkerClusterGroup.tsx`
- Create: `apps/web/src/features/map/components/MapLegend.tsx`
- Create: `apps/web/src/features/map/components/pin-icons.ts`
- Create: `apps/web/src/features/map/components/MapView.tsx`

- [ ] **Step 1: Create `map.css`** with the Leaflet import FIRST + scoped pin tokens

These are the exact legacy `:root` values from `web/app/globals.css:5-22` (verified). The pin/cluster HTML built by `map-pins.ts` references these custom properties; they are scoped to `.cb-map-root` so they don't leak into the app-wide shadcn token set.

`apps/web/src/features/map/map.css`:
```css
@import "leaflet/dist/leaflet.css";
@import "leaflet.markercluster/dist/MarkerCluster.css";

/* Scoped legacy design tokens for the imperatively-built Leaflet pin/cluster HTML.
   These divIcons reference var(--accent)/var(--walkup)/etc., which the app-wide
   shadcn token set does not define — declare them on the map root only.
   Values copied verbatim from web/app/globals.css:5-22. */
.cb-map-root {
  --surface: #ffffff;
  --surface-2: #fbfaf6;
  --surface-sunken: #f6f3ec;
  --border: #e7e1d4;
  --text: #2f3a2e;
  --muted: #5c6657;
  --accent: #3a6b4f;
  --accent-soft: #e3efe6;
  --green: #3a6b4f;
  --walkup: #b8860b;
}

/* Leaflet renders divIcon HTML outside React; suppress its default white box. */
.cb-map-root .leaflet-div-icon { background: transparent; border: none; }
```

> These values are final (verified against `web/app/globals.css:5-22`). `map-pins.ts` also references `var(--surface-2)` in the "none" pin fill and `color-mix(in srgb, var(--accent) 60%, black)` for the selection ring — both resolve from the tokens above.

- [ ] **Step 2: Port `pin-icons.ts`**

Verbatim from `web/app/map/pin-icons.ts:1-27`, changing only the import path: `from "../lib/map-pins"`.

`apps/web/src/features/map/components/pin-icons.ts`:
```ts
import L from "leaflet";
import { buildPinHtml, PIN_W, PIN_H, PIN_ANCHOR, PIN_POPUP_ANCHOR, type PinOptions } from "../lib/map-pins";

const cache = new Map<string, L.DivIcon>();

export function makePinIcon(opts: PinOptions): L.DivIcon {
  const key = `${opts.parkType}|${opts.availability}|${opts.count ?? 0}|${opts.selected ? 1 : 0}|${opts.label ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const icon = L.divIcon({
    html: buildPinHtml(opts),
    className: "",
    iconSize: [PIN_W, PIN_H],
    iconAnchor: PIN_ANCHOR,
    popupAnchor: PIN_POPUP_ANCHOR,
  });
  cache.set(key, icon);
  return icon;
}
```

- [ ] **Step 3: Port `MarkerClusterGroup.tsx`**

Verbatim from `web/app/map/MarkerClusterGroup.tsx:1-39`, dropping `'use client'`, changing the import to `from "../lib/map-pins"`, and dropping the `MarkerCluster.css` import (it is now in `map.css`).

`apps/web/src/features/map/components/MarkerClusterGroup.tsx`:
```ts
import { createPathComponent, type LeafletContextInterface } from "@react-leaflet/core";
import L from "leaflet";
import "leaflet.markercluster";
import type { ReactNode } from "react";
import { buildClusterHtml, CLUSTER_SIZE } from "../lib/map-pins";

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
      const matching = cluster.getAllChildMarkers().filter((m) => {
        const icon = m.options.icon;
        return icon instanceof L.DivIcon && String(icon.options.html ?? "").includes("cb-pin--match");
      }).length;
      return L.divIcon({
        html: buildClusterHtml(cluster.getChildCount(), matching),
        className: "",
        iconSize: [CLUSTER_SIZE, CLUSTER_SIZE],
        iconAnchor: [CLUSTER_SIZE / 2, CLUSTER_SIZE / 2],
      });
    },
  });
  return { instance, context: { ...context, layerContainer: instance } };
}

const MarkerClusterGroup = createPathComponent<L.MarkerClusterGroup, Props>(createCluster);

export default MarkerClusterGroup;
```

> If TS complains that `@react-leaflet/core` is not installed, it ships inside `react-leaflet` — import works because react-leaflet re-exports it; if the module path errors, add `@react-leaflet/core` explicitly: `bun add @react-leaflet/core` in `apps/web`.

- [ ] **Step 4: Port `MapLegend.tsx`** (Tailwind for the wrapper, `dangerouslySetInnerHTML` for swatches)

Port from `web/app/map/MapLegend.tsx:1-63`. Adaptation 3: the open/closed boxes use inline styles in the legacy; convert the wrapper chrome to Tailwind, keep `buildLegendSwatchHtml` swatches via `dangerouslySetInnerHTML`. Keep the `onMouseEnter/Leave` open behavior.

`apps/web/src/features/map/components/MapLegend.tsx`:
```tsx
import { useState } from "react";
import { PIN_LEGEND, buildLegendSwatchHtml } from "../lib/map-pins";

export default function MapLegend({ dateFilterActive }: { dateFilterActive: boolean }) {
  const [open, setOpen] = useState(false);
  const entries = PIN_LEGEND.filter((e) => !e.onlyWhenFiltered || dateFilterActive);

  return (
    <div
      className="absolute bottom-6 left-4 z-[1000]"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {open ? (
        <div className="rounded-xl border bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
          {entries.map((entry) => (
            <div key={entry.kind} className="mb-1 flex items-center gap-2 last:mb-0">
              <span className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: buildLegendSwatchHtml(entry.kind) }} />
              <span className="whitespace-nowrap text-[11px] text-neutral-800">{entry.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-2xl border bg-white/95 px-3 py-1 text-[11px] font-semibold text-neutral-800 shadow-sm"
        >
          ☰ Key
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement `MapView.tsx`**

Port from `web/app/map/LeafletMap.tsx:1-156`. Adaptations: drop `'use client'`; add the marker-icon Vite fix at module top; wrap the container in a `cb-map-root` div (so the scoped tokens apply); type `availability` as `Map<string, ParkAvailabilitySummary> | null`; pin-lighting logic is unchanged (`:114-129`).

`apps/web/src/features/map/components/MapView.tsx`:
```tsx
import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Tooltip, CircleMarker, Popup, ZoomControl, useMap } from "react-leaflet";
import L from "leaflet";
import type { MapPark } from "@campbrain/core";
import { getParkType, type PinAvailability } from "../lib/map-pins";
import { makePinIcon } from "./pin-icons";
import MapLegend from "./MapLegend";
import MarkerClusterGroup from "./MarkerClusterGroup";
import type { ParkAvailabilitySummary, ResolvedLocation } from "../lib/types";
import "../map.css";

// Vite marker-icon fix: bundle the PNGs and point Leaflet's default icon at them.
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

const CA_BOUNDS: L.LatLngBoundsExpression = [[32.3, -124.6], [42.1, -114.0]];

function FlyTo({ park }: { park: MapPark | null }) {
  const map = useMap();
  const savedView = useRef<{ center: L.LatLng; zoom: number } | null>(null);
  useEffect(() => {
    if (park?.latitude && park?.longitude) {
      if (!savedView.current) savedView.current = { center: map.getCenter(), zoom: map.getZoom() };
      map.flyTo([park.latitude, park.longitude], 12, { duration: 0.8 });
    } else if (savedView.current) {
      map.flyTo(savedView.current.center, savedView.current.zoom, { duration: 0.8 });
      savedView.current = null;
    }
  }, [map, park]);
  return null;
}

function FocusOnLocation({ focusLocation, distanceMiles }: { focusLocation: ResolvedLocation | null; distanceMiles: number | null }) {
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

interface Props {
  parks: MapPark[];
  selectedPark: MapPark | null;
  onSelectPark: (park: MapPark) => void;
  focusLocation?: ResolvedLocation | null;
  distanceMiles?: number | null;
  availability?: Map<string, ParkAvailabilitySummary> | null;
}

export default function MapView({ parks, selectedPark, onSelectPark, focusLocation, distanceMiles, availability = null }: Props) {
  const withCoords = parks.filter((p) => p.latitude && p.longitude);

  // markercluster doesn't recompute cluster icons when child icons change → remount on availability change.
  const clusterVersion = useRef(0);
  const clusterKey = useMemo(() => String(++clusterVersion.current), [availability]);

  return (
    <div className="cb-map-root relative h-full w-full">
      <MapContainer bounds={CA_BOUNDS} zoomControl={false} style={{ height: "100%", width: "100%" }}>
        <ZoomControl position="bottomright" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
        <FlyTo park={selectedPark} />
        <FocusOnLocation focusLocation={focusLocation ?? null} distanceMiles={distanceMiles ?? null} />
        {focusLocation && (
          <CircleMarker center={[focusLocation.lat, focusLocation.lon]} radius={8} color="#b3402f" fillColor="#b3402f" fillOpacity={0.8}>
            <Popup>Search location</Popup>
          </CircleMarker>
        )}
        <MarkerClusterGroup key={clusterKey}>
          {withCoords.map((park) => {
            const isSelected = selectedPark?.parkPageId === park.parkPageId;
            const summary = availability?.get(park.parkPageId);
            const state: PinAvailability = !availability
              ? "match"
              : (summary?.siteCount ?? 0) > 0
                ? "match"
                : (summary?.walkUpCount ?? 0) > 0
                  ? "walk-up"
                  : "none";
            const count = !availability
              ? undefined
              : state === "match"
                ? summary?.siteCount
                : state === "walk-up"
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
                <Tooltip direction="top" offset={[0, -50]}>
                  <strong>{park.parkName}</strong>
                  <br />
                  {parkType === "state" ? "CA State Park" : "Federal · Recreation.gov"}
                  {availability && state === "match" ? ` · ${count} site${count === 1 ? "" : "s"} open` : ""}
                  {availability && state === "walk-up" ? " · walk-up only" : ""}
                  {availability && state === "none" ? " · no availability" : ""}
                </Tooltip>
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

- [ ] **Step 6: Typecheck**

```bash
bun --filter @campbrain/web typecheck
```
Expected: PASS. (If `marker-icon-2x.png` import errors, add `apps/web/src/vite-env.d.ts` with `/// <reference types="vite/client" />` — but it is created by the Vite scaffold; verify it exists first with `ls apps/web/src/vite-env.d.ts`.)

- [ ] **Step 7: Visual verification (preview)**

Start dev servers: `bun --filter @campbrain/api dev` (terminal A) and `bun --filter @campbrain/web dev` (terminal B). This task's `MapView` isn't wired to `/` yet (that's Task 11), so verify by temporarily rendering it OR defer the visual check to Task 11. Minimum gate here: typecheck + build pass.

```bash
bun --filter @campbrain/web build
```
Expected: PASS (Leaflet + map.css bundle without errors).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/map/map.css apps/web/src/features/map/components/MarkerClusterGroup.tsx apps/web/src/features/map/components/MapLegend.tsx apps/web/src/features/map/components/pin-icons.ts apps/web/src/features/map/components/MapView.tsx
git commit -m "feat(web): leaflet map view, clusters, legend, pin icons + scoped map.css"
```

---

## Task 8: filter UI (DateRangePicker, SiteFilterPanel, ParkFinder, FilterBar)

**Sources:** `web/app/map/DateRangePicker.tsx`, `web/app/components/SiteFilterPanel.tsx`, `MapClient.tsx:1169-1205` (ParkFinder), `MapClient.tsx:879-1097` (filter bar JSX) + `:864-876` (PRESETS/MIN_STAY_OPTIONS) + `:1157-1163` (RowLabel).

**Key adaptations:** adaptation 3 throughout — all `.btn`/`.form-input`/etc. → shadcn `<Button variant>` + Tailwind. The DateRangePicker uses the shadcn `Calendar` (react-day-picker) inside a shadcn `Popover` instead of the legacy custom popover.

**Files:**
- Create: `apps/web/src/features/map/components/DateRangePicker.tsx`
- Create: `apps/web/src/features/map/components/SiteFilterPanel.tsx`
- Create: `apps/web/src/features/map/components/ParkFinder.tsx`
- Create: `apps/web/src/features/map/components/FilterBar.tsx`

- [ ] **Step 1: Implement `DateRangePicker.tsx`**

**Responsibility:** range date picker. **Props:** `{ from: string; to: string; mobile?: boolean; onChange: (from: string, to: string) => void }`. **Adaptation:** legacy `web/app/map/DateRangePicker.tsx` wraps `<DayPicker mode="range">` in a custom popover (`:84-96`); replace with shadcn `<Calendar mode="range" numberOfMonths={mobile ? 1 : 2}>` inside `<Popover>`. Preserve the legacy `onSelect` semantics (`:64-77`): when a complete range is already selected, a click starts a fresh range with `triggerDate` as the new `from`; otherwise set `from`/`to` from `range`, and close the popover when both endpoints are chosen on desktop. Use `parseIso`/`toIso`/`label` helpers from the legacy file (`:8-27`) verbatim (they are pure). The button shows `📅 {label(from, to)}` and uses `variant={from ? "secondary" : "ghost"}`. ISO conversions must use `new Date(y, m-1, d)` (local).

```tsx
import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";

function parseIso(iso: string): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}
function toIso(d: Date | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function label(from: string, to: string): string {
  const fmt = (iso: string) => parseIso(iso)!.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (!from) return "Pick dates…";
  return to ? `${fmt(from)} – ${fmt(to)}` : `${fmt(from)} →`;
}

export default function DateRangePicker({
  from, to, onChange, mobile = false,
}: { from: string; to: string; onChange: (from: string, to: string) => void; mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selected: DateRange | undefined = from ? { from: parseIso(from), to: parseIso(to) } : undefined;

  const calendar = (
    <Calendar
      mode="range"
      numberOfMonths={mobile ? 1 : 2}
      selected={selected}
      disabled={{ before: today }}
      onSelect={(range: DateRange | undefined, triggerDate: Date) => {
        if (from && to) {
          onChange(toIso(triggerDate), "");
          return;
        }
        onChange(toIso(range?.from), toIso(range?.to));
        if (range?.from && range?.to && range.from.getTime() !== range.to.getTime() && !mobile) {
          setOpen(false);
        }
      }}
    />
  );

  if (mobile) return <div className="rounded-md border bg-white p-2">{calendar}</div>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant={from ? "secondary" : "ghost"}>📅 {label(from, to)}</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">{calendar}</PopoverContent>
    </Popover>
  );
}
```

> If the shadcn `Calendar`'s `onSelect` types don't expose `triggerDate`, cast: `onSelect={((range, trigger) => {...}) as never}` is NOT acceptable — instead type the handler params explicitly as shown; react-day-picker's range `onSelect` signature is `(range, selectedDay, ...)`. Verify against the generated `calendar.tsx` and adjust the param name if needed.

- [ ] **Step 2: Implement `SiteFilterPanel.tsx`**

**Responsibility:** the three taxonomy pill groups. **Props:** `{ state: TaxonomyState; onChange: (next: TaxonomyState) => void; groups?: Array<"access"|"kinds"|"hide">; dense?: boolean }`. **Adaptation:** port `web/app/components/SiteFilterPanel.tsx:1-115`; convert `.btn`/`.btn-primary`/`.btn-slate`/`.btn-ghost` pills to shadcn `<Button size="sm">` with `variant` chosen by active/hide state (`active && hide` → `secondary` + eye-off icon; `active && !hide` → `default`; inactive → `ghost`). Keep the `toggle<T>` helper (`:16-18`) and the `EyeOffIcon` (replace the inline SVG with lucide `EyeOff`). Labels/spacing become Tailwind.

```tsx
import { EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCESS_GROUP, KIND_GROUP, HIDE_GROUP } from "../lib/site-taxonomy";
import type { TaxonomyState, SiteAccess, SiteKind, HideTarget } from "../lib/site-taxonomy";

interface Props {
  state: TaxonomyState;
  onChange: (next: TaxonomyState) => void;
  groups?: Array<"access" | "kinds" | "hide">;
  dense?: boolean;
}
function toggle<T extends string>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
function Pill({ label, active, hide, onClick }: { label: string; active: boolean; hide: boolean; onClick: () => void }) {
  const variant = active ? (hide ? "secondary" : "default") : "ghost";
  return (
    <Button type="button" size="sm" variant={variant} onClick={onClick} className={active ? "font-bold" : ""}>
      {active && hide ? <EyeOff className="size-3" /> : null}{label}
    </Button>
  );
}
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export default function SiteFilterPanel({ state, onChange, groups = ["access", "kinds", "hide"] }: Props) {
  return (
    <div className="flex flex-wrap gap-3.5">
      {groups.includes("access") && (
        <Group label={ACCESS_GROUP.label}>
          {ACCESS_GROUP.options.map((o) => (
            <Pill key={o.id} label={o.label} active={state.access.includes(o.id)} hide={false}
              onClick={() => onChange({ ...state, access: toggle<SiteAccess>(state.access, o.id) })} />
          ))}
        </Group>
      )}
      {groups.includes("kinds") && (
        <Group label={KIND_GROUP.label}>
          {KIND_GROUP.options.map((o) => (
            <Pill key={o.id} label={o.label} active={state.kinds.includes(o.id)} hide={false}
              onClick={() => onChange({ ...state, kinds: toggle<SiteKind>(state.kinds, o.id) })} />
          ))}
        </Group>
      )}
      {groups.includes("hide") && (
        <Group label={HIDE_GROUP.label}>
          {HIDE_GROUP.options.map((o) => (
            <Pill key={o.id} label={o.label} active={state.hide.includes(o.id)} hide
              onClick={() => onChange({ ...state, hide: toggle<HideTarget>(state.hide, o.id) })} />
          ))}
        </Group>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Implement `ParkFinder.tsx`**

**Responsibility:** typeahead that selects a park. **Props:** `{ parks: MapPark[]; onSelect: (park: MapPark) => void }`. **Adaptation:** port `MapClient.tsx:1169-1205`; `.form-input` → shadcn input styling (or a plain `<input>` with Tailwind), `.park-finder-results` dropdown → an absolutely-positioned Tailwind `<ul>`. Matching logic (`:1171-1177`) is unchanged: case-insensitive `includes`, cap 8.

```tsx
import { useMemo, useState } from "react";
import type { MapPark } from "@campbrain/core";

export default function ParkFinder({ parks, onSelect }: { parks: MapPark[]; onSelect: (park: MapPark) => void }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return parks.filter((p) => p.parkName.toLowerCase().includes(q)).slice(0, 8);
  }, [query, parks]);

  return (
    <div className="relative w-56 shrink-0">
      <input
        className="w-full rounded-md border bg-white px-2.5 py-1.5 text-xs"
        placeholder="Find a park…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-[1200] mt-1 overflow-hidden rounded-md border bg-white shadow-lg">
          {matches.map((p) => (
            <li key={p.parkPageId} className="border-t first:border-t-0">
              <button
                type="button"
                onClick={() => { onSelect(p); setQuery(""); }}
                className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-neutral-100"
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

- [ ] **Step 4: Implement `FilterBar.tsx`**

**Responsibility:** the whole top filter bar — header row (menu/toggle/summary-sentence/reset/ParkFinder) + Rows 1 (When: presets, DateRangePicker, weekends-only pill), 2 (Min stay + Near: geocode form, distance pills), 3 (SiteFilterPanel). **Props:** all from the `useMapFilters()` return + `{ parks: MapPark[]; sortedParks: MapPark[]; matchCount: number; total: number; loading: boolean; isMobile: boolean; filtersOpen: boolean; onToggleFilters: () => void; onSelectPark: (p: MapPark) => void; onOpenNav: () => void }`. **Adaptation:** port the JSX from `MapClient.tsx:879-1097`; replace every `.btn`/`.btn-sm`/`.btn-primary`/`.btn-ghost`/`.form-input` with shadcn `<Button>`/Tailwind. Preset list + min-stay options come from `:864-876`. The weekends-only pill is locked (`disabled`) when `preset === "this_weekend"` (`:969-985`). Distance pills are disabled until `resolvedLocation` resolves (`:1051-1074`). `RowLabel` (`:1157-1163`) becomes a small Tailwind `<span>`.

Define the props interface, then render the structure:
```tsx
import { Button } from "@/components/ui/button";
import type { MapPark } from "@campbrain/core";
import type { MapFilters } from "../hooks/use-map-filters";
import DateRangePicker from "./DateRangePicker";
import SiteFilterPanel from "./SiteFilterPanel";
import ParkFinder from "./ParkFinder";
import type { Preset, MinNights } from "../lib/types";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "this_weekend", label: "This weekend" },
  { id: "next_2_weeks", label: "Next 2 weeks" },
  { id: "next_month", label: "Next month" },
  { id: "anytime", label: "Anytime" },
];
const MIN_STAY_OPTIONS: { value: MinNights; label: string }[] = [
  { value: null, label: "Any" }, { value: 1, label: "1 night" }, { value: 2, label: "2 nights" }, { value: 3, label: "3 nights" },
];
const DISTANCES: Array<number | null> = [null, 25, 50, 100, 200];

function RowLabel({ children }: { children: string }) {
  return <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{children}</span>;
}

interface Props {
  filters: MapFilters;
  parks: MapPark[];
  sortedParks: MapPark[];
  matchCount: number;
  total: number;
  loading: boolean;
  isMobile: boolean;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onSelectPark: (p: MapPark) => void;
  onOpenNav: () => void;
}

export default function FilterBar(props: Props) {
  const { filters: f } = props;
  // Header row: hamburger (mobile, when collapsed) + Filters toggle + summary sentence + Reset + ParkFinder.
  // Row 1: PRESETS buttons (variant active ? "default" : "ghost"), DateRangePicker, weekends-only pill (disabled when preset === "this_weekend").
  // Row 2: Min stay buttons (MIN_STAY_OPTIONS) + Near form (input + Search submit + "Use my location") + distance pills (disabled until resolvedLocation).
  // Row 3: <SiteFilterPanel state={f.taxonomy} onChange={f.setTaxonomy} dense />.
  // Mobile: a full-width "Show {matchCount} parks" button closing the sheet.
  // See MapClient.tsx:879-1097 for exact structure; wire every control to the matching f.* setter.
  return (
    <div className={`absolute left-4 right-4 top-4 z-[1000] flex flex-col gap-2 rounded-lg border bg-white/80 p-3 shadow-lg backdrop-blur md:right-[332px] ${props.isMobile && props.filtersOpen ? "fixed inset-0 z-[2500] overflow-y-auto rounded-none" : ""}`}>
      {/* ...port the four rows here per the comment + legacy lines... */}
      <ParkFinder parks={props.sortedParks} onSelect={props.onSelectPark} />
      <DateRangePicker from={f.availFrom} to={f.availTo} mobile={props.isMobile} onChange={f.setDates} />
      <SiteFilterPanel state={f.taxonomy} onChange={f.setTaxonomy} dense />
    </div>
  );
}
```

> The executor MUST flesh out the four rows fully (do not ship the skeleton above as-is) by porting each control from `MapClient.tsx:883-1095`, mapping each `onClick`/`disabled`/`value` to the corresponding `f.*` field. The skeleton names the exact pieces to place.

- [ ] **Step 5: Typecheck**

```bash
bun --filter @campbrain/web typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/map/components/DateRangePicker.tsx apps/web/src/features/map/components/SiteFilterPanel.tsx apps/web/src/features/map/components/ParkFinder.tsx apps/web/src/features/map/components/FilterBar.tsx
git commit -m "feat(web): map filter bar, date picker, site filters, park finder"
```

> Full visual verification of the filter bar happens in Task 11 (it needs `MapPage` composition + live data). Gate here is typecheck.

---

## Task 9: `components/ParkDetail.tsx`

**Source:** `web/app/map/MapClient.tsx:399-591` (`DetailPanel`) + the sub-components `SiteChips` (`:43-70`), `BookLink` (`:73-86`), `TierLine` (`:89-109`), `WalkUpLine` (`:112-123`), `DateRow` (`:257-301`), `WeekendRow` (`:307-393`).

**Responsibility:** the detail panel. Consumes `useParkAvailability` (Task 6) + `selectWeekendTiers`/`intersectConsecutiveDates` (Task 5). Renders weekend-tier rows OR dates rows + walk-up badges + Book links (`injectBookingDates`), with all loading/error/empty states.

**Props:** `{ park: MapPark; onClose: () => void; taxonomy: TaxonomyState; minNights: MinNights; weekendsOnly: boolean; availFrom: string; availTo: string }`.

**Key adaptations:**
- adaptation 1: `useParkAvailability` already wraps tRPC; pass `{ parkPageId, provider, from: availFrom, to: availTo, taxonomy }` (NO minNights/weekendsOnly to the query — they are applied client-side here).
- adaptation 3: `.map-detail-panel`/`.map-detail-header`/`.btn`/`.site-chip`/`.badge`/`.empty` → Tailwind. The site-chip styling (`web/app/globals.css:294-314`) becomes Tailwind classes on a `<span>`.
- The `processedDates` memo becomes `intersectConsecutiveDates(data.nextAvailableDates, minNights)`.
- `WeekendRow` uses `selectWeekendTiers(cg, minNights)` per campground to decide which `TierLine`s render, and the row-level visibility (`:315-329`) is computed by OR-ing the flags across campgrounds.
- `ProviderBadge` (legacy `:478`) collapses to a static "CA State Park" label (CA-only).
- `relativeTime`/`relativeDate`/`formatDate` come from `lib/map-utils`.

**Files:**
- Create: `apps/web/src/features/map/components/ParkDetail.tsx`

- [ ] **Step 1: Implement `ParkDetail.tsx`**

Port the structure from `MapClient.tsx:399-591`, wiring the extracted pure helpers. Define the inner presentational pieces (`SiteChips`, `BookLink`, `TierLine`, `WalkUpLine`, `DateRow`, `WeekendRow`) inside this file (or a sibling) — they are small and panel-specific. For `WeekendRow`, render a `TierLine` per `true` flag from `selectWeekendTiers(cg, minNights)`, mapping flags to the legacy tier rows (`:382-386`):
  - `line3` → `<TierLine label="Fri–Mon · 3 nights" sites={cg.sites3Night} url={cg.bookingUrl} arrival={fri} nights={3} highlight />`
  - `line2Fri` → `label="Fri–Sun · 2 nights"`, `sites={cg.sites2NightFri}`, `arrival={fri}`, `nights={2}`
  - `line2Sat` → `label="Sat–Mon · 2 nights"`, `sites={cg.sites2NightSat}`, `arrival={sat}`, `nights={2}`
  - `line1Fri` → `label="Fri · 1 night"`, `sites={cg.sites1NightFri}`, `arrival={fri}`, `nights={1}`
  - `line1Sat` → `label="Sat · 1 night"`, `sites={cg.sites1NightSat}`, `arrival={sat}`, `nights={1}`
  - then `<WalkUpLine sites={cg.walkUpSites} />`.
- `BookLink` uses `injectBookingDates(url, arrival, nights)` (from `lib/booking-url`) on its `href`.
- The row/empty-state logic mirrors `:469-586`: `noWeekendDays = weekendsOnly && availFrom && availTo && !rangeHasWeekendDay(availFrom, availTo)`; `taxonomyChanged = !isTaxonomyDefault(taxonomy)`; weekend branch renders `WeekendRow`s, dates branch renders `intersectConsecutiveDates(...).map(DateRow)`.
- `bookNights = Math.max(minNights ?? 1, 1)` for `DateRow`'s Book link (`:466`).
- Panel container: `<div className="absolute right-4 top-4 bottom-4 z-[1000] w-[300px] overflow-y-auto rounded-lg border bg-white p-[18px] shadow-lg ...">` (desktop) — on mobile a rising bottom sheet (`fixed inset-x-0 bottom-0 max-h-[88%] rounded-t-2xl`), matching `web/app/globals.css:407-414`. The mobile backdrop is rendered by `MapPage` (Task 11), not here.

```tsx
import { useMemo } from "react";
import type { MapPark, AvailableDateEntry, WeekendEntry, WeekendCampground } from "@campbrain/core";
import { useParkAvailability } from "../hooks/use-park-availability";
import { selectWeekendTiers, intersectConsecutiveDates } from "../lib/stay-tiers";
import { injectBookingDates } from "../lib/booking-url";
import { formatSiteName } from "../lib/site-display";
import { formatDate, relativeDate, relativeTime, rangeHasWeekendDay } from "../lib/map-utils";
import { isTaxonomyDefault, type TaxonomyState } from "../lib/site-taxonomy";
import type { MinNights } from "../lib/types";

interface Props {
  park: MapPark;
  onClose: () => void;
  taxonomy: TaxonomyState;
  minNights: MinNights;
  weekendsOnly: boolean;
  availFrom: string;
  availTo: string;
}

export default function ParkDetail({ park, onClose, taxonomy, minNights, weekendsOnly, availFrom, availTo }: Props) {
  const { data, loading, error } = useParkAvailability({
    parkPageId: park.parkPageId, provider: park.provider, from: availFrom, to: availTo, taxonomy,
  });
  const processedDates = useMemo(
    () => (data ? intersectConsecutiveDates(data.nextAvailableDates, minNights) : []),
    [data, minNights],
  );
  const processedWeekends: WeekendEntry[] = data?.nextAvailableWeekends ?? [];
  const bookNights = Math.max(minNights ?? 1, 1);
  const noWeekendDays = weekendsOnly && !!availFrom && !!availTo && !rangeHasWeekendDay(availFrom, availTo);
  const taxonomyChanged = !isTaxonomyDefault(taxonomy);

  // ... render header (park.parkName, "CA State Park", campgroundCount · siteCount, close button),
  //     "Cache as of {relativeTime(data.asOf)}", and the loading/error/empty/weekend/dates branches
  //     exactly per MapClient.tsx:472-588, using <DateRow>, <WeekendRow>, formatDate/relativeDate.
  return null; // replace with the full ported JSX
}
```

> The executor MUST replace the `return null` skeleton with the full ported panel JSX + the inner `SiteChips`/`BookLink`/`TierLine`/`WalkUpLine`/`DateRow`/`WeekendRow` components, mapping the legacy `.site-chip`/`.badge`/`.empty`/`var(--green)`/`var(--muted)` styling to Tailwind utility classes. Do not ship the skeleton.

- [ ] **Step 2: Typecheck**

```bash
bun --filter @campbrain/web typecheck
```
Expected: PASS.

- [ ] **Step 3: Visual verification (deferred to Task 11)**

The panel needs `MapPage` to provide a `selectedPark`. Gate here is typecheck; full verification (panel shows real weekend tiers + Book links with correct injected dates) is in Task 11.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/map/components/ParkDetail.tsx
git commit -m "feat(web): park detail panel with weekend tiers + dates + book links"
```

---

## Task 10: `components/ResultsDrawer.tsx` + `hooks/use-is-mobile.ts`

**Sources:** `web/app/map/ResultsList.tsx:1-135`, `web/app/map/useIsMobile.ts:1-15`.

**Responsibility:** the results list (sortable park rows) + the desktop toggle + the mobile bottom sheet with peek/half/full detents.

**Props:** `{ rows: ParkListRow[]; sort: ParkListSort; onSortChange: (s: ParkListSort) => void; hasLocation: boolean; selectedParkId: string | null; onSelectRow: (parkPageId: string) => void; open: boolean; mobile?: boolean; detent?: SheetDetent; onCycleDetent?: () => void }`.

**Adaptations:** adaptation 3 — `.map-results-drawer`/`.map-results-row`/`.map-results-glyph`/`.btn` → Tailwind; the mobile detent transforms (`web/app/globals.css:394-405`) become conditional Tailwind classes keyed on `detent`. Sort buttons → shadcn `<Button size="sm" variant={sort === key ? "default" : "ghost"}>`. The `RowGlyph` SVG (`:23-31`) is kept (uses `GLYPHS` from `lib/map-pins`). `sortParkRows` from `lib/park-list`. `formatShortDate` (`:16-21`) is the same as `formatDate` from `lib/map-utils` — reuse it.

**Files:**
- Create: `apps/web/src/features/map/hooks/use-is-mobile.ts`
- Create: `apps/web/src/features/map/components/ResultsDrawer.tsx`

- [ ] **Step 1: Port `use-is-mobile.ts`**

Verbatim from `web/app/map/useIsMobile.ts:1-15`, dropping `'use client'`:
```ts
import { useEffect, useState } from "react";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}
```

- [ ] **Step 2: Implement `ResultsDrawer.tsx`**

Port `web/app/map/ResultsList.tsx:33-135`. Keep the `useEffect` that scrolls the selected row into view (`:59-63`), the `SORTS` array (`:9-14`), `sortParkRows` usage, the `walkUpOnly` row variant (`:98`, `:113-119`), and the mobile grip (`:71-73`). Convert chrome to Tailwind; the mobile detent positioning becomes:
  - base mobile: `fixed inset-x-0 top-0 h-full rounded-t-2xl transition-transform`
  - `detent-peek`: `translate-y-[calc(100%-140px)]`; `detent-half`: `translate-y-[48%]`; `detent-full`: `translate-y-[56px]`
  - desktop: `absolute left-4 top-[124px] bottom-3 w-[290px]`; closed: `-translate-x-[115%] opacity-0 pointer-events-none`.

```tsx
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { GLYPHS } from "../lib/map-pins";
import { sortParkRows, type ParkListRow, type ParkListSort } from "../lib/park-list";
import { formatDate } from "../lib/map-utils";
import type { SheetDetent } from "../lib/sheet-detent";

const SORTS: { key: ParkListSort; label: string }[] = [
  { key: "sites", label: "Most sites" },
  { key: "distance", label: "Nearest" },
  { key: "soonest", label: "Soonest" },
  { key: "name", label: "A–Z" },
];

function RowGlyph({ isFederal, walkUpOnly }: { isFederal: boolean; walkUpOnly: boolean }) {
  return (
    <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${walkUpOnly ? "bg-amber-500" : "bg-emerald-600"}`}>
      <svg width="14" height="14" viewBox="3 3 19 17" aria-hidden="true">
        <path d={GLYPHS[isFederal ? "federal" : "state"]} fill="#fff" />
      </svg>
    </span>
  );
}

interface Props {
  rows: ParkListRow[];
  sort: ParkListSort;
  onSortChange: (s: ParkListSort) => void;
  hasLocation: boolean;
  selectedParkId: string | null;
  onSelectRow: (parkPageId: string) => void;
  open: boolean;
  mobile?: boolean;
  detent?: SheetDetent;
  onCycleDetent?: () => void;
}

export default function ResultsDrawer(props: Props) {
  const { rows, sort, onSortChange, hasLocation, selectedParkId, onSelectRow, open, mobile = false, detent = "peek", onCycleDetent } = props;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !selectedParkId || !listRef.current) return;
    listRef.current.querySelector(`[data-park-id="${CSS.escape(selectedParkId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, selectedParkId]);
  const sorted = sortParkRows(rows, sort);
  // ... render the drawer container (desktop/mobile classes per the detent map above),
  //     the mobile grip (onClick={onCycleDetent}), the sort-pill header, and the row list
  //     exactly per ResultsList.tsx:69-134 (walkUpOnly row variant, distance/soonest suffixes).
  return null; // replace with full ported JSX
}
```

> Replace the `return null` skeleton with the full ported drawer JSX.

- [ ] **Step 3: Typecheck**

```bash
bun --filter @campbrain/web typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/map/hooks/use-is-mobile.ts apps/web/src/features/map/components/ResultsDrawer.tsx
git commit -m "feat(web): results drawer + sort pills + mobile sheet detent"
```

---

## Task 11: `MapPage.tsx` + route wiring (composition + full visual verification)

**Source:** the `MapClient` render body (`web/app/map/MapClient.tsx:878-1155`) for the layout composition, and `web/app/map/page.tsx` for the catalog source (now replaced by `api.map.catalog`).

**Responsibility:** the composition root. Runs `api.map.catalog` on mount; owns `selectedPark`, `filtersOpen`, `listOpen`, `listSortChoice`, `detent`, `navMenuOpen`; wires `useMapFilters` + `useMapSummary` + `useFilteredParks`; lays out `FilterBar`, `MapView`, `ResultsDrawer`, `ParkDetail`.

**Adaptations:** adaptation 2 — `LeafletMap` via `dynamic` becomes `MapView` directly (optionally `React.lazy(() => import("./components/MapView"))` wrapped in `<Suspense>`). `initialParks` prop → catalog `useQuery`. The mobile `NavMenu` (legacy `:1152`) — `apps/web` has a `NavBar`; the mobile nav menu is out of scope for the map (the app NavBar handles nav). Drop `navMenuOpen`/`NavMenu` (the hamburger in the legacy filter bar opened an in-map nav drawer; since `apps/web`'s `__root` renders a persistent `NavBar`, omit the in-map hamburger). `sortedParks`/`allParksWithCoords` derive from catalog data.

**Files:**
- Create: `apps/web/src/features/map/MapPage.tsx`
- Modify: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/routes/__root.tsx`

- [ ] **Step 1: Implement `MapPage.tsx`**

```tsx
import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/trpc";
import type { MapPark } from "@campbrain/core";
import { useMapFilters } from "./hooks/use-map-filters";
import { useMapSummary } from "./hooks/use-map-summary";
import { useFilteredParks } from "./hooks/use-filtered-parks";
import { useIsMobile } from "./hooks/use-is-mobile";
import { cycleDetent, type SheetDetent } from "./lib/sheet-detent";
import type { ParkListSort } from "./lib/park-list";
import FilterBar from "./components/FilterBar";
import ResultsDrawer from "./components/ResultsDrawer";
import ParkDetail from "./components/ParkDetail";

const MapView = lazy(() => import("./components/MapView"));

export default function MapPage() {
  const catalog = useQuery({ queryKey: ["map", "catalog"], queryFn: () => api.map.catalog.query() });
  const parks: MapPark[] = catalog.data?.parks ?? [];

  const f = useMapFilters();
  const [selectedPark, setSelectedPark] = useState<MapPark | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [listSortChoice, setListSortChoice] = useState<ParkListSort | null>(null);
  const [detent, setDetent] = useState<SheetDetent>("peek");
  const isMobile = useIsMobile();

  const { availByPark, loading } = useMapSummary({
    availFrom: f.availFrom, availTo: f.availTo, taxonomy: f.taxonomy, weekendsOnly: f.weekendsOnly, minNights: f.minNights,
  });
  const { displayedParks, matchCount, listRows } = useFilteredParks({
    parks, resolvedLocation: f.resolvedLocation, distanceMiles: f.distanceMiles, availByPark,
  });

  const sortedParks = useMemo(() => [...parks].sort((a, b) => a.parkName.localeCompare(b.parkName)), [parks]);
  const listSort: ParkListSort = listSortChoice ?? (f.resolvedLocation ? "distance" : "sites");

  const handleSelectRow = useCallback((id: string) => {
    const park = parks.find((p) => p.parkPageId === id);
    if (park) setSelectedPark(park);
  }, [parks]);

  return (
    <div className="relative h-[calc(100vh-var(--nav-h,56px))] w-full overflow-hidden">
      <FilterBar
        filters={f} parks={parks} sortedParks={sortedParks}
        matchCount={matchCount} total={parks.length} loading={loading}
        isMobile={isMobile} filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
        onSelectPark={setSelectedPark}
        onOpenNav={() => {}}
      />
      <div className="absolute inset-0">
        <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">Loading map…</div>}>
          <MapView
            parks={displayedParks}
            selectedPark={selectedPark}
            onSelectPark={setSelectedPark}
            focusLocation={f.resolvedLocation}
            distanceMiles={f.distanceMiles}
            availability={availByPark}
          />
        </Suspense>
        {!isMobile && (
          <button
            type="button"
            className="absolute left-4 top-[82px] z-[960] rounded-md border bg-white px-3 py-1 text-sm shadow"
            onClick={() => setListOpen((o) => !o)}
            aria-expanded={listOpen}
          >
            ☰ {listRows.length} park{listRows.length !== 1 ? "s" : ""}
          </button>
        )}
        <ResultsDrawer
          rows={listRows} sort={listSort} onSortChange={setListSortChoice}
          hasLocation={f.resolvedLocation !== null}
          selectedParkId={selectedPark?.parkPageId ?? null}
          onSelectRow={handleSelectRow}
          open={isMobile ? true : listOpen}
          mobile={isMobile} detent={detent}
          onCycleDetent={() => setDetent((d) => cycleDetent(d))}
        />
      </div>
      {selectedPark && (
        <>
          {isMobile && <div className="fixed inset-0 z-[1100] bg-black/30" onClick={() => setSelectedPark(null)} />}
          <ParkDetail
            park={selectedPark}
            onClose={() => setSelectedPark(null)}
            taxonomy={f.taxonomy}
            minNights={f.minNights}
            weekendsOnly={f.weekendsOnly}
            availFrom={f.availFrom}
            availTo={f.availTo}
          />
        </>
      )}
    </div>
  );
}
```

> NOTE on `listSortChoice`/`setListSortChoice` typing: `onSortChange` expects `(s: ParkListSort) => void`; `setListSortChoice` accepts `ParkListSort | null`. Pass `setListSortChoice` directly — assigning a `ParkListSort` is valid. If TS narrows, wrap: `onSortChange={(s) => setListSortChoice(s)}`.

- [ ] **Step 2: Wire the route**

`apps/web/src/routes/index.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import MapPage from "@/features/map/MapPage";

export const Route = createFileRoute("/")({
  component: MapPage,
});
```

- [ ] **Step 3: Make the index route full-bleed (override `__root` p-4)**

`apps/web/src/routes/__root.tsx` — read `useRouterState` location; drop the `p-4` for `"/"`:
```tsx
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { NavBar } from "@/components/nav-bar";

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isMap = pathname === "/";
  return (
    <div className="min-h-screen">
      <NavBar />
      <main className={isMap ? "" : "p-4"}>
        <Outlet />
      </main>
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
```

> Do NOT touch the explore/saved/alerts route files — they keep `p-4` because `isMap` is false for them.

- [ ] **Step 4: Typecheck + build**

```bash
bun --filter @campbrain/web typecheck && bun --filter @campbrain/web build
```
Expected: both PASS.

- [ ] **Step 5: Full visual verification (preview)**

Start servers — terminal A: `bun --filter @campbrain/api dev`; terminal B: `bun --filter @campbrain/web dev` (Vite on :5173). Open the app and use the `preview_*` tools against `http://localhost:5173/`. Verify, in order:
  1. **Pins load** — ~88 CA park pins render on a CA-bounded Carto Voyager map; clustering at low zoom shows donut clusters.
  2. **Default state** — "This weekend" preset active, weekends-only locked on, summary sentence reads "N of 88 parks have a weekend stay {date range}".
  3. **Pin-lighting** — blue pins = bookable, orange = walk-up only, grey = no availability (the local DB is populated, so real lighting shows). Toggle a HIDE filter (e.g. hide walk-up) → pins re-light after the debounce.
  4. **Park panel** — click a blue pin → detail panel opens on the right, shows "Cache as of …", weekend-tier rows (Fri–Mon / Fri–Sun / Sat–Mon) with site chips + **Book** links. Hover a Book link → URL contains the correct `date=` (the tier's arrival) + `night=` (3/2/1).
  5. **Min stay** — set Min stay = 2 → 1-night tiers disappear; the dates view (toggle weekends-only off) only shows dates anchoring a 2-night chain.
  6. **Distance** — type a city in Near, Search → green checkmark + map flies; pick 50mi → pins outside 50mi disappear. "Use my location" prompts geolocation.
  7. **Results drawer** — desktop toggle shows the list; sort pills (Most sites / Nearest / Soonest / A–Z) reorder; clicking a row selects the park (panel + flyTo).
  8. **Mobile** (narrow the viewport < 640px) — filter bar collapses; results drawer becomes a bottom sheet; tapping the grip cycles peek → half → full; the detail panel rises over a backdrop.
  9. **No console errors / no hydration warnings** (Vite SPA has no hydration, but check for Leaflet/React errors).

Capture a screenshot of the loaded map with the panel open as proof.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/map/MapPage.tsx apps/web/src/routes/index.tsx apps/web/src/routes/__root.tsx
git commit -m "feat(web): compose map page at / + full-bleed index route"
```

---

## Task 12: full-repo verification + cleanup

**Files:** none new (verification + any final fixes surfaced).

- [ ] **Step 1: Repo-wide typecheck**

```bash
bun run typecheck
```
Expected: all workspace packages PASS (8/8 or however many `turbo` reports). Fix any cross-package type drift before continuing.

- [ ] **Step 2: Repo-wide tests**

```bash
bun run test
```
Expected: all green, including the new map helper tests (`map-utils`, `site-taxonomy`, `map-pins`, `pure-helpers`, `stay-tiers`, `filter-derivations`) and the existing `apps/web` `nav-bar.test.tsx`.

- [ ] **Step 3: Repo-wide build**

```bash
bun run build
```
Expected: PASS, including the `apps/web` Vite bundle with the Leaflet chunk.

- [ ] **Step 4: Final visual proof**

With both dev servers running, take one more `preview_*` screenshot of `/` showing pins + an open park panel with Book links. This is the portfolio-showcase artifact.

> **Availability-data dependency (note for prod, not a blocker locally):** the production map shows catalog pins regardless, but availability panels + pin-lighting depend on the Phase-1c scanner populating Neon (it needs a manual GitHub-secret setup). Locally the DB is already populated (~3.2M availability rows from prior scans), so the preview shows real data. In a fresh prod env, pins render but every park will show "no availability in the cached windows" until the scanner runs.

- [ ] **Step 5: Commit any final cleanup**

```bash
git add -A
git commit -m "chore(web): phase 1d-2 map page verification + cleanup"
```

---

## Self-Review

**1. Spec coverage** (each design-spec section → task):

| Spec section | Covered by |
|---|---|
| Goal — port to `apps/web` consuming `api.map.*` | Tasks 6–11 (hooks wrap tRPC), Task 11 (route at `/`) |
| Decision 1 — faithful full port (all 4 filter rows, weekend-tier panel, geocode+haversine, clustering, drawer, mobile sheet) | Task 8 (filter rows), Task 9 (weekend panel), Task 6/`map-utils` (geocode+haversine), Task 7 (clustering), Task 10 (drawer+sheet) |
| Decision 2 — Tailwind/shadcn for UI; scoped CSS only for Leaflet pins | adaptation 3 (all component tasks) + Task 7 (`map.css` scoped tokens) |
| Decision 3 — decompose the monolith | the entire `features/map/` tree (Tasks 1–11) |
| Scope: full map at `/`, full-bleed | Task 11 (index route + `__root` override) |
| Scope: `features/map/` module | Tasks 1–11 |
| Scope: Leaflet stack + marker-icon fix + leaflet.css first | Task 0 (deps) + Task 7 (`map.css` `@import` first, `mergeOptions` fix) |
| Scope: data via vanilla tRPC + TanStack Query | Task 6 (`use-map-summary`, `use-park-availability`, catalog in Task 11) |
| Scope: unit tests for pure helpers + extracted filter logic | Tasks 1–6 (TDD) |
| Deferred: save/alert, URL hydration, rec.gov, Storybook | excluded everywhere (adaptation 4 drops rec.gov; no save/alert/URL/Storybook tasks) |
| File layout (the tree) | reproduced in "File structure" + realized across Tasks 1–11 |
| Helper-reuse check vs `@campbrain/core` | "Helper-reuse note" (response types imported, not redeclared; date math matches core) |
| Data flow — catalog/summary/availability + replacements (debounce, query cache) | Task 6 (debounced snapshot in `use-map-summary`; TanStack cache replaces hand-rolled cache) |
| Pin-lighting preserved | Task 7 `MapView` (`:114-129` logic ported verbatim) |
| minNights client-side (weekends tiers + dates intersection) | Task 5 (`stay-tiers`) + Task 9 (consumed in panel) |
| CA-only adaptations (drop facilityIds, availByPark, reduced MapPark, "CA State Park" label) | adaptations 4/5 + Task 6 (`buildAvailByPark`) + Task 9 (static label) |
| Styling — shadcn Calendar date picker, Carto tiles, CA bounds, no SSR | Task 8 (shadcn Calendar) + Task 7 (Carto/CA bounds, direct import) |
| Testing & verification — Vitest helpers + `preview_*` visual | Tasks 1–6 (Vitest), Tasks 7–11 (`preview_*`), Task 12 (full gate) |
| Risk — availability data dependency note | Task 12 Step 4 note |
| Risk — markercluster types | Task 0 (`@types/leaflet.markercluster`) + Task 7 (`@react-leaflet/core` fallback note) |

No spec section is unmapped.

**2. Placeholder scan:** Pure-helper tasks (1–6) ship full test + implementation code. Component tasks (8–10) intentionally provide a typed skeleton + an explicit "replace the `return null`/skeleton with the full ported JSX from `<file>:<lines>`" instruction plus the exact tier/empty-state mappings — this is a deliberate port directive, not a vague placeholder, because reproducing ~600 lines of presentational JSX verbatim would be lower-fidelity than citing the source. The one literal TODO is in `map.css` (Task 7 Step 1), which is an explicit, bounded instruction ("copy the exact `:root` hex values from `web/app/globals.css`") with the reason stated — the executor must read that file during implementation. No "add error handling", "handle edge cases", or "write tests for the above" placeholders exist.

**3. Type consistency:** `ParkAvailabilitySummary`, `Preset`, `MinNights`, `ResolvedLocation` are defined once in `lib/types.ts` (Task 1) and imported everywhere. `TaxonomyState`/`SiteAccess`/`SiteKind`/`HideTarget` defined in `lib/site-taxonomy.ts` (Task 2). `ParkListRow`/`ParkListSort` in `lib/park-list.ts`, `SheetDetent` in `lib/sheet-detent.ts` (Task 4). `WeekendTierFlags`, `selectWeekendTiers`, `intersectConsecutiveDates` in `lib/stay-tiers.ts` (Task 5). `buildAvailByPark`/`computeFilteredParks`/`buildListRows`/`computeActiveFilterCount`/`ParkCount` in `lib/filter-derivations.ts` (Task 6). `MapFilters` returned by `useMapFilters` (Task 6) is consumed by `FilterBar` (Task 8) and `MapPage` (Task 11) under the same name. `availByPark` is the consistent name across Tasks 6–11 (never `availByFacility`). `MapPark`/`ParkAvailabilityResponse`/`AvailableDateEntry`/`WeekendEntry`/`WeekendCampground`/`AvailableDateCampground` are always imported from `@campbrain/core`, never redeclared. `makePinIcon`/`buildPinHtml`/`buildClusterHtml`/`getParkType`/`GLYPHS`/`CLUSTER_SIZE` names match between `lib/map-pins.ts` (Task 3), `pin-icons.ts`, `MarkerClusterGroup.tsx`, `MapView.tsx`, `ResultsDrawer.tsx` (Tasks 7, 10). No signature drift found.
