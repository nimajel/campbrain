# CampBrain Hosted Launch — Phase 1d-1 (Map tRPC router + transforms + allowlist gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This is a fresh-session plan — it is fully self-contained; you do not need prior conversation context.**

**Goal:** Expose CampBrain's map data over a **tRPC `map` router** (`catalog`, `availability`, `summary`) backed by the Phase-1b `@campbrain/db` read layer, by porting the pure response-shaping transforms (currently inline in the legacy Next.js route) into a tested `@campbrain/core` module — and **wire the Phase-0 allowlist gate into the auth flow** + set the app title. This is the **backend half** of Phase 1d (the live-map milestone); the Vite Leaflet map page that consumes this router is Phase **1d-2**.

**Architecture:** The availability response shaping (date pivot, weekend-tier expansion, walk-up split, taxonomy filtering) moves out of the legacy route handler into pure, unit-tested functions in `@campbrain/core` (`availability/map-transforms.ts`) — they operate on `AvailabilityWindowEntry[]` (from `@campbrain/db`'s `getEntriesForParks`) + `classifySite` (already in core), so they're Workers-safe and reusable. A `map` tRPC sub-router in `apps/api` wires three `publicProcedure`s (the map is public per spec) to the `@campbrain/db` reads + these transforms; tRPC's type inference flows the response shapes to the frontend automatically. The allowlist is enforced at **sign-in** via a BetterAuth `databaseHooks.session.create.before` hook (non-allowlisted users complete Google OAuth but get no session → redirected to `/request-access`); public map browse needs no session.

**Tech Stack:** Bun · TypeScript (strict) · tRPC v11 · Hono (Cloudflare Workers) · Zod · BetterAuth · `@campbrain/core` · `@campbrain/db` · `@campbrain/types` · Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-hosted-launch-design.md` (API layer + Map IA + Production hardening). Phases 1a/1b/1c are shipped on `hosted-launch`.

---

## Scope

**In 1d-1 (this plan):**
- `@campbrain/core/src/availability/map-transforms.ts` — ported pure transforms + the map response types, unit-tested.
- `@campbrain/types` — map procedure input schemas (zod).
- `apps/api` — the `map` tRPC router (catalog/availability/summary) + allowlist enforcement at sign-in.
- `apps/web/index.html` — the app `<title>`.

**Deferred to 1d-2 (frontend, separate plan):** the Vite Leaflet map page (port of `web/app/map/MapClient` + `LeafletMap` + sub-components + `web/lib/*` pure helpers + leaflet deps), full-bleed map route at `/`, the geocode/distance/clustering/results-drawer UI, the weekend-tier rendering, client-side `minNights` filtering.

**Deferred to Phase 2:** save/alert tRPC mutations + their `allowlistedProcedure` gate + frontend route guards on `/saved`/`/alerts`; Rec.gov multi-facility (`facilityIds`) grouping.

**Deliberate shape reductions (CA-only, documented):** the `MapPark` catalog shape is reduced to what the map needs (`provider`, `parkName`, `parkPageId`, `latitude`, `longitude`, `campgroundCount`, `siteCount`, `campgrounds:[{name,siteCount}]`) — derivable from `getCatalogParks` without extending the DB query. Dropped vs legacy: per-campground `sites[]`/`siteTypes`/`bookingUrl`/`lastDiscoveredAt`, park `orgName`/`discoveryStatus`/`lastUpdatedAt`, and `facilityPageIds` multi-facility (rec.gov). Per-campground booking detail comes from the `availability` response, not catalog. `map.availability` does NOT apply `minNights` (the frontend does — matches the legacy route).

---

## Port source (read before starting)

The transforms are ported (behavior-preserving) from the legacy Next.js route **`web/app/api/map/availability/route.ts`** (and the catalog reshape from `web/app/api/map/catalog/route.ts`). Open those alongside this plan to verify fidelity. The response shapes the legacy frontend consumes (`MapPark`, `ParkAvailabilityResponse`, `AvailableDateEntry`, `WeekendEntry`) are defined in those route files' exported types — reproduce them in `@campbrain/core` so 1d-2 can consume them via tRPC inference.

Key inputs already available:
- `@campbrain/db`: `getCatalogParks(db)`, `getEntriesForParks(db, parkPageIds, provider?)`, `getParkAvailabilityCounts(db, opts)` (Phase 1b).
- `@campbrain/core`: `classifySite(name, cgName, recGovType?)`, `isWalkUpSite`, `AvailabilityWindowEntry`, `CampgroundWindow`, `SiteAccess`, `SiteKind` (Phases 1a).
- `@campbrain/types`: `SavedSearchFiltersSchema` (has the exact `access`/`kinds`/`hide`/`minNights` zod enums) + the `isoDate` regex pattern.
- `apps/api`: `apps/api/src/trpc/router.ts` (`router`, `publicProcedure`, `appRouter` with only `health`), `apps/api/src/trpc/context.ts` (`TrpcContext` = `{ db, auth, session }`), `apps/api/src/auth.ts` (`createAuth(db, env)` → `betterAuth({...})`, no hooks yet), `apps/api/src/allowlist.ts` (`isAllowlisted(db, email)`).

**Strict tsconfig** (all packages): `strict`, `verbatimModuleSyntax` (type-only imports use `import type`), `isolatedModules`, `noUncheckedIndexedAccess`, `moduleResolution: Bundler`. `@campbrain/core` must stay Workers-pure (no `node:`/`fs`/`path`/`postgres`). Local Postgres for integration tests: `docker compose -f docker-compose.dev.yml up -d` then `bun --filter @campbrain/db migrate`; the catalog is seeded via `bun --filter @campbrain/db seed:catalog` (Phase 1b). Tests guard with `skipIf(!dbReachable())`.

---

## File structure

```
packages/core/
  src/availability/map-transforms.ts        NEW: response types + pure transforms + buildParkAvailability + toMapPark
  src/availability/map-transforms.test.ts   NEW: unit tests
  src/index.ts                              MODIFY: export map-transforms
packages/types/
  src/map.ts                                NEW: MapAvailabilityInputSchema + MapSummaryInputSchema (+ types)
  src/index.ts                              MODIFY: export ./map
  test/map.test.ts                          NEW
apps/api/
  src/trpc/routers/map.ts                   NEW: mapRouter (catalog/availability/summary)
  src/trpc/router.ts                        MODIFY: compose map into appRouter
  src/auth.ts                               MODIFY: databaseHooks.session.create.before (allowlist gate) + onAPIError
  test/map-router.test.ts                   NEW: createCaller integration test (local PG)
  test/allowlist.test.ts                    MODIFY/CONFIRM: isAllowlisted test
apps/web/
  index.html                               MODIFY: <title>CampBrain</title>
```

---

## Task 1: Map transform foundations in `@campbrain/core`

Port the response **types** + the low-level **pure helpers** from `web/app/api/map/availability/route.ts`. These are framework-agnostic and operate on `AvailabilityWindowEntry` + `classifySite`.

**Files:** Create `packages/core/src/availability/map-transforms.ts`, `packages/core/src/availability/map-transforms.test.ts`; Modify `packages/core/src/index.ts`.

- [ ] **Step 1: Write the types + helpers** in `packages/core/src/availability/map-transforms.ts`

```ts
import type { AvailabilityWindowEntry } from "./types";
import { classifySite, type SiteAccess, type SiteKind } from "../catalog/site-classifier";

export type HideTarget = "group" | "equestrian" | "walk_up";

export interface MapAvailabilityFilters {
  from?: string | null;
  to?: string | null;
  access?: SiteAccess[];
  kinds?: SiteKind[];
  hide?: HideTarget[];
}

export interface AvailableDateCampground {
  name: string;
  bookingUrl?: string;
  nightlyFee: number | null;
  availableSiteCount: number;
  sites: string[];        // bookable, sorted
  walkUpSites: string[];  // walk-up/first-come, sorted
}
export interface AvailableDateEntry {
  date: string;       // YYYY-MM-DD
  dayLabel: string;   // "Fri, Jun 6"
  isWeekend: boolean; // DOW is Fri(5) or Sat(6)
  campgrounds: AvailableDateCampground[];
}
export interface WeekendCampground {
  name: string;
  bookingUrl?: string;
  nightlyFee: number | null;
  sites3Night: string[];
  sites2NightFri: string[];
  sites2NightSat: string[];
  sites1NightFri: string[];
  sites1NightSat: string[];
  walkUpSites: string[];
}
export interface WeekendEntry {
  label: string;        // "Fri, Jun 6–Sun, Jun 8"
  fridayDate: string;
  saturdayDate: string;
  sundayDate: string;
  campgrounds: WeekendCampground[];
}
export interface ParkAvailabilityResponse {
  parkPageId: string;
  parkName: string;
  asOf: string | null;
  nextAvailableDates: AvailableDateEntry[];
  nextAvailableWeekends: WeekendEntry[];
  earliestAvailableDate: string | null;
}

// --- date utils (local-time to avoid UTC-midnight shift) ---
export function parseDateLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}
export function addDays(iso: string, n: number): string {
  const d = parseDateLocal(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
export function dowLabel(iso: string): string {
  return parseDateLocal(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
export function isWeekendArrival(iso: string): boolean {
  const dow = parseDateLocal(iso).getDay();
  return dow === 5 || dow === 6;
}
export function isInRange(iso: string, from: string, to: string | null | undefined): boolean {
  return iso >= from && (!to || iso <= to);
}

// --- taxonomy predicate (closes over the filter arrays) ---
export function makeTaxonomyPredicate(f: MapAvailabilityFilters): (siteName: string, cgName: string) => boolean {
  const access = f.access ?? [];
  const kinds = f.kinds ?? [];
  const hide = f.hide ?? [];
  return (siteName, cgName) => {
    const info = classifySite(siteName, cgName);
    if (info.isDayUse) return false;
    if (access.length > 0 && !access.includes(info.access)) return false;
    if (kinds.length > 0 && (info.siteKind === null || !kinds.includes(info.siteKind))) return false;
    if (hide.includes("group") && info.isGroup) return false;
    if (hide.includes("equestrian") && info.isEquestrian) return false;
    if (hide.includes("walk_up") && info.isWalkUp) return false;
    return true;
  };
}

export type DateSiteMap = Map<string, Map<string, { sites: string[]; bookingUrl?: string; nightlyFee: number | null }>>;

/** Pivot park→cg→site→dates into date→cg→sites[], applying `passes` per site and
 *  deduping site names across overlapping scan windows. Only 'available' dates. */
export function buildDateSiteMap(
  entries: AvailabilityWindowEntry[],
  passes: (siteName: string, cgName: string) => boolean,
): DateSiteMap {
  const dateMap: DateSiteMap = new Map();
  for (const entry of entries) {
    for (const cg of entry.campgrounds) {
      for (const site of cg.sites) {
        if (!passes(site.name, cg.name)) continue;
        for (const [date, status] of Object.entries(site.dates)) {
          if (status !== "available") continue;
          if (!dateMap.has(date)) dateMap.set(date, new Map());
          const cgMap = dateMap.get(date)!;
          if (!cgMap.has(cg.name)) {
            cgMap.set(cg.name, { sites: [], bookingUrl: cg.bookingUrl, nightlyFee: cg.nightlyFee ?? null });
          }
          const cgSites = cgMap.get(cg.name)!.sites;
          if (!cgSites.includes(site.name)) cgSites.push(site.name);
        }
      }
    }
  }
  return dateMap;
}

/** Sites available on ALL of `dates` for `cgName` (intersection). */
export function sitesAvailableForDates(dateMap: DateSiteMap, cgName: string, dates: string[]): string[] {
  if (dates.length === 0) return [];
  const setsPerDate = dates.map((d) => {
    const cgMap = dateMap.get(d);
    if (!cgMap || !cgMap.has(cgName)) return new Set<string>();
    return new Set(cgMap.get(cgName)!.sites);
  });
  const first = setsPerDate[0]!;
  return [...first].filter((s) => setsPerDate.every((set) => set.has(s)));
}

/** Split site names into bookable vs walk-up (first-come), each sorted. */
export function splitWalkUp(
  names: string[],
  cgName: string,
  isWalkUp: (name: string, cgName: string) => boolean,
): { bookable: string[]; walkUp: string[] } {
  const bookable: string[] = [];
  const walkUp: string[] = [];
  for (const name of names) (isWalkUp(name, cgName) ? walkUp : bookable).push(name);
  return { bookable: bookable.sort(), walkUp: walkUp.sort() };
}
```
> These are verbatim ports from `web/app/api/map/availability/route.ts` (the inline `parseDateLocal`/`addDays`/`dowLabel`/`isWeekendArrival`/`isInRange`/`buildDateSiteMap`/`sitesAvailableForDates`/`splitWalkUp` + the `passesTaxonomy` closure → `makeTaxonomyPredicate` factory). Read that file and confirm each matches. `noUncheckedIndexedAccess`: the `[y,m,d]` destructure + `!` and the `setsPerDate[0]!` mirror the source's safe assertions.

- [ ] **Step 2: Write unit tests** `packages/core/src/availability/map-transforms.test.ts` (pure, no DB)

Cover: `buildDateSiteMap` dedupes a site across two overlapping windows + drops `unavailable`/filtered sites; `sitesAvailableForDates` returns the intersection (a site available on Fri+Sat but not Sun is in [fri,sat] not [fri,sat,sun]); `splitWalkUp` routes a `Hike/Bike` site to walkUp and a normal site to bookable, both sorted; `makeTaxonomyPredicate` drops day-use, filters by access/kinds (NULL-kind excluded when kinds set), and hides group/equestrian/walk_up; `addDays`/`isWeekendArrival`/`isInRange` basics.

```ts
import { describe, it, expect } from "vitest";
import type { AvailabilityWindowEntry } from "./types";
import { buildDateSiteMap, sitesAvailableForDates, splitWalkUp, makeTaxonomyPredicate, addDays, isWeekendArrival, isInRange } from "./map-transforms";

const passAll = () => true;
function entry(cg: string, sites: { name: string; dates: Record<string, "available" | "unavailable"> }[], windowStart = "2026-08-14", bookingUrl = "http://b", nightlyFee = 35): AvailabilityWindowEntry {
  return { parkPageId: "p", parkName: "P", windowStart, windowEnd: addDays(windowStart, 7), scannedAt: "2026-06-22T00:00:00Z", sourceUrl: "x", campgrounds: [{ id: "cg", name: cg, bookingUrl, nightlyFee, sites }] };
}

describe("buildDateSiteMap", () => {
  it("dedupes a site across overlapping windows and keeps only available", () => {
    const e1 = entry("Loop A", [{ name: "S1", dates: { "2026-08-14": "available", "2026-08-15": "unavailable" } }], "2026-08-14");
    const e2 = entry("Loop A", [{ name: "S1", dates: { "2026-08-14": "available" } }], "2026-08-13"); // overlaps 08-14
    const m = buildDateSiteMap([e1, e2], passAll);
    expect([...m.keys()].sort()).toEqual(["2026-08-14"]);
    expect(m.get("2026-08-14")!.get("Loop A")!.sites).toEqual(["S1"]); // deduped
  });
});

describe("sitesAvailableForDates", () => {
  it("returns sites available on ALL requested dates", () => {
    const e = entry("Loop A", [
      { name: "S1", dates: { "2026-08-14": "available", "2026-08-15": "available", "2026-08-16": "available" } },
      { name: "S2", dates: { "2026-08-14": "available", "2026-08-15": "available" } }, // not 16
    ]);
    const m = buildDateSiteMap([e], passAll);
    expect(sitesAvailableForDates(m, "Loop A", ["2026-08-14", "2026-08-15", "2026-08-16"]).sort()).toEqual(["S1"]);
    expect(sitesAvailableForDates(m, "Loop A", ["2026-08-14", "2026-08-15"]).sort()).toEqual(["S1", "S2"]);
  });
});

describe("splitWalkUp", () => {
  const isWalkUp = (name: string, cg: string) => classifyWalk(name, cg);
  function classifyWalk(name: string) { return /hike\s*[/&]?\s*bike/i.test(name); }
  it("routes hike/bike to walkUp, others to bookable, sorted", () => {
    const r = splitWalkUp(["Site 2", "Hike/Bike 1", "Site 1"], "CG", (n) => classifyWalk(n));
    expect(r.bookable).toEqual(["Site 1", "Site 2"]);
    expect(r.walkUp).toEqual(["Hike/Bike 1"]);
  });
});

describe("makeTaxonomyPredicate", () => {
  it("filters by access and hides walk_up", () => {
    const p = makeTaxonomyPredicate({ access: ["hike_in"], hide: ["walk_up"] });
    // A hike/bike site is hike_in access AND is_walk_up → hidden by hide:walk_up
    expect(p("Hike/Bike 1", "CG")).toBe(false);
  });
});

describe("date utils", () => {
  it("addDays + isWeekendArrival + isInRange", () => {
    expect(addDays("2026-08-14", 2)).toBe("2026-08-16");
    expect(isWeekendArrival("2026-08-14")).toBe(true);  // Friday
    expect(isWeekendArrival("2026-08-17")).toBe(false); // Monday
    expect(isInRange("2026-08-15", "2026-08-14", "2026-08-16")).toBe(true);
    expect(isInRange("2026-08-13", "2026-08-14", null)).toBe(false);
  });
});
```
> Verify the asserted classifications against the real `classifySite` (the `Hike/Bike` walk-up regex is `/\bhike\s*[/&]?\s*bike\b/i`). Use real site names that the classifier actually classifies (e.g. `"Hike/Bike 1"` → walk_up). For `makeTaxonomyPredicate` use names whose `classifySite` result you've confirmed.

- [ ] **Step 3: Barrel** — append `export * from "./availability/map-transforms";` to `packages/core/src/index.ts`. Watch for export collisions (e.g. `HideTarget` may already be exported by `@campbrain/db`'s filters, but that's a different package — within `@campbrain/core` confirm `HideTarget`/`SiteAccess` names don't collide; if `SiteAccess`/`SiteKind` re-export collides with `catalog/site-classifier`'s, import them as types only and don't re-export — resolve with explicit `export type` and report).

- [ ] **Step 4: Verify** — `bun --filter @campbrain/core test` (new tests pass) + `bun --filter @campbrain/core typecheck` exit 0 + Workers-purity `git grep -nE "from \"node:|\bfs\b|\bpath\b|postgres" -- packages/core/src/availability/map-transforms.ts || echo clean`.

- [ ] **Step 5: Commit**
```bash
git add packages/core
git commit -m "feat(core): map transform helpers + response types"
```

---

## Task 2: `weekendFridaysFromAvailableDates` + `buildParkAvailability`

The assembler that turns `AvailabilityWindowEntry[]` + filters into a `ParkAvailabilityResponse` (the shape the map's per-park panel consumes). Ports the `GET` handler body of `web/app/api/map/availability/route.ts`.

**Files:** Modify `packages/core/src/availability/map-transforms.ts` (+ its test).

- [ ] **Step 1: Add `weekendFridaysFromAvailableDates` + `buildParkAvailability`** to `map-transforms.ts`

```ts
import { isWalkUpSite } from "../catalog/site-classifier"; // add to imports

/** Derive weekend anchor Fridays from the set of available dates (Fri/Sat/Sun all map to their Friday). */
export function weekendFridaysFromAvailableDates(availableDates: string[], today: string, maxCount: number): string[] {
  const fridaySet = new Set<string>();
  for (const iso of availableDates) {
    if (iso < today) continue;
    const dow = parseDateLocal(iso).getDay(); // 0=Sun,5=Fri,6=Sat
    if (dow !== 5 && dow !== 6 && dow !== 0) continue;
    const d = parseDateLocal(iso);
    if (dow === 6) d.setDate(d.getDate() - 1);
    else if (dow === 0) d.setDate(d.getDate() - 2);
    fridaySet.add(d.toISOString().slice(0, 10));
  }
  return [...fridaySet].sort().slice(0, maxCount);
}

/** Assemble the per-park availability response (dates + weekend tiers). Ports the GET handler
 *  of web/app/api/map/availability/route.ts. `from`/`to` bound the displayed window; results
 *  exclude past dates. minNights is NOT applied here (the frontend does it). */
export function buildParkAvailability(
  entries: AvailabilityWindowEntry[],
  filters: MapAvailabilityFilters,
  responseId: string,
  now: Date = new Date(),
): ParkAvailabilityResponse {
  if (entries.length === 0) {
    return { parkPageId: responseId, parkName: "", asOf: null, nextAvailableDates: [], nextAvailableWeekends: [], earliestAvailableDate: null };
  }
  const parkName = entries[0]!.parkName;
  const asOf = entries.reduce<string | null>((max, e) => (max === null || e.scannedAt > max ? e.scannedAt : max), null);

  const passes = makeTaxonomyPredicate(filters);
  const isWalkUpForSplit = (name: string, cgName: string) => isWalkUpSite(name, cgName);
  const dateMap = buildDateSiteMap(entries, passes);

  const allAvailableDates = [...dateMap.keys()].sort();
  const earliestAvailableDate = allAvailableDates[0] ?? null;

  const today = todayIso(now);
  const rangeStart = filters.from && filters.from > today ? filters.from : today;
  const to = filters.to ?? null;

  // nextAvailableDates: every in-range future available date, with bookable/walk-up split per cg
  const nextAvailableDates: AvailableDateEntry[] = [];
  for (const date of allAvailableDates) {
    if (date < rangeStart || (to && date > to)) continue;
    const cgMap = dateMap.get(date)!;
    const campgrounds: AvailableDateCampground[] = [];
    for (const [cgName, cg] of cgMap) {
      const { bookable, walkUp } = splitWalkUp(cg.sites, cgName, isWalkUpForSplit);
      if (bookable.length === 0 && walkUp.length === 0) continue;
      campgrounds.push({ name: cgName, bookingUrl: cg.bookingUrl, nightlyFee: cg.nightlyFee, availableSiteCount: bookable.length, sites: bookable, walkUpSites: walkUp });
    }
    if (campgrounds.length === 0) continue;
    campgrounds.sort((a, b) => a.name.localeCompare(b.name));
    nextAvailableDates.push({ date, dayLabel: dowLabel(date), isWeekend: isWeekendArrival(date), campgrounds });
  }

  // nextAvailableWeekends: per anchor Friday, the 5 tiers + walk-up per cg
  const cgNames = new Set<string>();
  for (const cgMap of dateMap.values()) for (const name of cgMap.keys()) cgNames.add(name);

  const nextAvailableWeekends: WeekendEntry[] = [];
  for (const fri of weekendFridaysFromAvailableDates(allAvailableDates, today, Infinity)) {
    const sat = addDays(fri, 1);
    const sun = addDays(fri, 2);
    const allowFri = isInRange(fri, rangeStart, to);
    const allowSat = isInRange(sat, rangeStart, to);
    const campgrounds: WeekendCampground[] = [];
    for (const cgName of cgNames) {
      const sites3Night = allowFri ? splitWalkUp(sitesAvailableForDates(dateMap, cgName, [fri, sat, sun]), cgName, isWalkUpForSplit).bookable : [];
      const sites2NightFri = allowFri ? splitWalkUp(sitesAvailableForDates(dateMap, cgName, [fri, sat]), cgName, isWalkUpForSplit).bookable : [];
      const sites2NightSat = allowSat ? splitWalkUp(sitesAvailableForDates(dateMap, cgName, [sat, sun]), cgName, isWalkUpForSplit).bookable : [];
      const friSplit = allowFri ? splitWalkUp([...(dateMap.get(fri)?.get(cgName)?.sites ?? [])], cgName, isWalkUpForSplit) : { bookable: [], walkUp: [] };
      const satSplit = allowSat ? splitWalkUp([...(dateMap.get(sat)?.get(cgName)?.sites ?? [])], cgName, isWalkUpForSplit) : { bookable: [], walkUp: [] };
      const walkUpSites = [...new Set([...friSplit.walkUp, ...satSplit.walkUp])].sort();
      if (friSplit.bookable.length === 0 && satSplit.bookable.length === 0 && walkUpSites.length === 0) continue;
      const cg = cgMap_lookupBooking(dateMap, cgName, [fri, sat, sun]);
      campgrounds.push({ name: cgName, bookingUrl: cg.bookingUrl, nightlyFee: cg.nightlyFee, sites3Night, sites2NightFri, sites2NightSat, sites1NightFri: friSplit.bookable, sites1NightSat: satSplit.bookable, walkUpSites });
    }
    if (campgrounds.length === 0) continue;
    campgrounds.sort((a, b) => a.name.localeCompare(b.name));
    nextAvailableWeekends.push({ label: `${dowLabel(fri)}–${dowLabel(sun)}`, fridayDate: fri, saturdayDate: sat, sundayDate: sun, campgrounds });
  }

  return { parkPageId: responseId, parkName, asOf, nextAvailableDates, nextAvailableWeekends, earliestAvailableDate };
}

/** Find a campground's bookingUrl/nightlyFee from the first of the given dates that has it. */
function cgMap_lookupBooking(dateMap: DateSiteMap, cgName: string, dates: string[]): { bookingUrl?: string; nightlyFee: number | null } {
  for (const d of dates) {
    const cg = dateMap.get(d)?.get(cgName);
    if (cg) return { bookingUrl: cg.bookingUrl, nightlyFee: cg.nightlyFee };
  }
  return { bookingUrl: undefined, nightlyFee: null };
}
```
> Read the GET handler in `web/app/api/map/availability/route.ts` and reconcile: the weekend tier expansion (allowFri/allowSat gating, the 5 tiers, the walk-up union, the "exclude cg if no 1-night/walk-up" filter) must match. The `cgMap_lookupBooking` helper recovers the per-cg bookingUrl/fee (the legacy reads it off the date entries). Adjust to match the legacy's exact bookingUrl/fee sourcing if it differs.

- [ ] **Step 2: Add unit tests** to `map-transforms.test.ts`

Build a synthetic `AvailabilityWindowEntry[]` for one park, one campground, with: a Friday + Saturday + Sunday all available for "S1", a Friday-only "S2", and a `Hike/Bike 1` walk-up available Friday. Call `buildParkAvailability(entries, {}, "p", new Date("2026-08-01T00:00:00Z"))` and assert:
- `asOf` = the entries' scannedAt; `earliestAvailableDate` = the earliest available date.
- `nextAvailableDates` includes the Friday with cg campgrounds: S1+S2 in `sites`, `Hike/Bike 1` in `walkUpSites`, `availableSiteCount === 2`.
- `nextAvailableWeekends` has the weekend whose `sites3Night` = ["S1"] (S1 spans Fri+Sat+Sun), `sites2NightFri` = ["S1"], `sites1NightFri` includes ["S1","S2"], `walkUpSites` = ["Hike/Bike 1"].
- A `to` filter excluding the Friday yields no weekend (allowFri false).
- The empty-entries case returns the empty response with `parkName: ""`.

Use a fixed `now` (`new Date("2026-08-01...")`) and 2026-08-14 (a Friday) so DOW math is deterministic. Verify 2026-08-14 is a Friday (it is) and the tier expectations against the actual function output (run it, then lock the values).

- [ ] **Step 3: Barrel already covers it** (Task 1 added `export *`). Run `bun --filter @campbrain/core typecheck`.

- [ ] **Step 4: Verify** — `bun --filter @campbrain/core test` (all pass) + typecheck + Workers-purity grep clean.

- [ ] **Step 5: Commit**
```bash
git add packages/core
git commit -m "feat(core): buildParkAvailability + weekend-tier assembly"
```

---

## Task 3: `toMapPark` catalog transform + `MapPark` type

**Files:** Modify `packages/core/src/availability/map-transforms.ts` (+ test). (Co-located: it's a small pure transform over `getCatalogParks` output.)

- [ ] **Step 1: Add the `MapPark` type + `toMapPark`** to `map-transforms.ts`

```ts
import type { CatalogPark } from "@campbrain/db"; // type-only; @campbrain/core does NOT depend on @campbrain/db at runtime
```
WAIT — `@campbrain/core` must NOT depend on `@campbrain/db` (layering: db depends on core, not vice-versa). So do NOT import `CatalogPark` from `@campbrain/db`. Instead, define the input shape `toMapPark` needs as a local interface (structurally matching `CatalogPark`), so the router (which has both deps) can pass `getCatalogParks` rows in:
```ts
export interface CatalogParkInput {
  providerId: string;
  parkPageId: string;
  parkName: string;
  latitude: number | null;
  longitude: number | null;
  campgrounds: { name: string; siteCount: number }[];
}
export interface MapPark {
  provider: string;
  parkName: string;
  parkPageId: string;
  latitude: number | null;
  longitude: number | null;
  campgroundCount: number;
  siteCount: number;
  campgrounds: { name: string; siteCount: number }[];
}
export function toMapPark(p: CatalogParkInput): MapPark {
  return {
    provider: p.providerId,
    parkName: p.parkName,
    parkPageId: p.parkPageId,
    latitude: p.latitude,
    longitude: p.longitude,
    campgroundCount: p.campgrounds.length,
    siteCount: p.campgrounds.reduce((sum, c) => sum + c.siteCount, 0),
    campgrounds: p.campgrounds,
  };
}
```
(`CatalogParkInput` is structurally identical to `@campbrain/db`'s `CatalogPark`, so the router passes `getCatalogParks(db)` rows directly with no adapter. This keeps the core→db layering one-directional.)

- [ ] **Step 2: Unit test** — `toMapPark({providerId:'california-parks', parkPageId:'468', parkName:'X', latitude:38, longitude:-122, campgrounds:[{name:'A',siteCount:3},{name:'B',siteCount:2}]})` → `{provider:'california-parks', campgroundCount:2, siteCount:5, ...}`.

- [ ] **Step 3: Verify** — `bun --filter @campbrain/core test` + typecheck.

- [ ] **Step 4: Commit**
```bash
git add packages/core
git commit -m "feat(core): toMapPark catalog transform"
```

---

## Task 4: Map procedure input schemas in `@campbrain/types`

Reuse the saved-search filter enums for the map procedure inputs (one source of truth for the access/kinds/hide/minNights values).

**Files:** Create `packages/types/src/map.ts`, `packages/types/test/map.test.ts`; Modify `packages/types/src/index.ts`.

- [ ] **Step 1: Read `packages/types/src/saved-search.ts`** to find the exact field schemas (`access`/`kinds`/`hide`/`minNights` enums) and the `isoDate` pattern. Reuse them (import the individual `z.enum(...)` definitions if exported, or re-declare matching them).

- [ ] **Step 2: Write `packages/types/src/map.ts`**
```ts
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const accessSchema = z.array(z.enum(["drive_in", "hike_in", "boat_in"])).default([]);
const kindsSchema = z.array(z.enum(["tent", "hookup", "cabin"])).default([]);
const hideSchema = z.array(z.enum(["group", "equestrian", "walk_up"])).default([]);
const minNightsSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]).optional();

export const MapAvailabilityInputSchema = z.object({
  parkPageId: z.string(),
  provider: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  access: accessSchema,
  kinds: kindsSchema,
  hide: hideSchema,
});
export type MapAvailabilityInput = z.infer<typeof MapAvailabilityInputSchema>;

export const MapSummaryInputSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  weekendsOnly: z.boolean().default(false),
  access: accessSchema,
  kinds: kindsSchema,
  hide: hideSchema,
  minNights: minNightsSchema,
});
export type MapSummaryInput = z.infer<typeof MapSummaryInputSchema>;
```
> If `saved-search.ts` exports reusable field schemas, import and reuse them instead of re-declaring (DRY) — but matching the exact enum values is what matters. `map.availability` has NO `minNights` (the frontend applies it). `map.catalog` takes no input.

- [ ] **Step 3: Barrel** — append `export * from "./map";` to `packages/types/src/index.ts`.

- [ ] **Step 4: Test** `packages/types/test/map.test.ts` — `MapAvailabilityInputSchema.parse({ parkPageId: "468" })` defaults access/kinds/hide to `[]`; rejects a bad access value; `MapSummaryInputSchema` accepts `minNights: 2` + `weekendsOnly` defaults false; rejects `minNights: 4`.

- [ ] **Step 5: Verify** — `bun --filter @campbrain/types test` + `bun --filter @campbrain/types typecheck`.

- [ ] **Step 6: Commit**
```bash
git add packages/types
git commit -m "feat(types): map procedure input schemas"
```

---

## Task 5: The `map` tRPC router

**Files:** Create `apps/api/src/trpc/routers/map.ts`, `apps/api/test/map-router.test.ts`; Modify `apps/api/src/trpc/router.ts`, `apps/api/package.json` (add `@campbrain/core` dep if missing).

- [ ] **Step 1: Confirm deps** — `apps/api/package.json` must depend on `@campbrain/core`, `@campbrain/db`, `@campbrain/types` (`workspace:*`). Add `@campbrain/core` if absent; run `bun install`.

- [ ] **Step 2: Write `apps/api/src/trpc/routers/map.ts`**
```ts
import { router, publicProcedure } from "../router";
import { MapAvailabilityInputSchema, MapSummaryInputSchema } from "@campbrain/types";
import { getCatalogParks, getEntriesForParks, getParkAvailabilityCounts } from "@campbrain/db";
import { toMapPark, buildParkAvailability } from "@campbrain/core";

export const mapRouter = router({
  catalog: publicProcedure.query(async ({ ctx }) => {
    const parks = await getCatalogParks(ctx.db);
    return { parks: parks.map(toMapPark) };
  }),

  availability: publicProcedure.input(MapAvailabilityInputSchema).query(async ({ ctx, input }) => {
    const entries = await getEntriesForParks(ctx.db, [input.parkPageId], input.provider);
    return buildParkAvailability(entries, { from: input.from, to: input.to, access: input.access, kinds: input.kinds, hide: input.hide }, input.parkPageId);
  }),

  summary: publicProcedure.input(MapSummaryInputSchema).query(async ({ ctx, input }) => {
    const parks = await getParkAvailabilityCounts(ctx.db, input);
    return { parks };
  }),
});
```
> `ctx.db` is the per-request Neon Drizzle handle (satisfies `QueryDb`/`TransactionalDb`). `publicProcedure` = no auth (the map is public). The return types flow to the frontend via tRPC inference.

- [ ] **Step 3: Compose into `apps/api/src/trpc/router.ts`** — import `mapRouter`, add `map: mapRouter` to `appRouter`:
```ts
import { mapRouter } from "./routers/map";
export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  map: mapRouter,
});
```
Run `bun --filter @campbrain/api typecheck` (the `AppRouter` type now includes `map`).

- [ ] **Step 4: Integration test** `apps/api/test/map-router.test.ts` — use `appRouter.createCaller(ctx)` with a real local-PG db + a stub session. The catalog must be seeded (run `bun --filter @campbrain/db seed:catalog` against local PG first, or the test seeds a fixture park). Build the caller context:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { appRouter } from "../src/trpc/router";

const URL = process.env.DATABASE_URL ?? "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";
async function dbReachable() { try { const s = postgres(URL, { max: 1, onnotice: () => {}, connect_timeout: 2 }); await s`SELECT 1`; await s.end(); return true; } catch { return false; } }

describe("map router (integration)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let caller: ReturnType<typeof appRouter.createCaller> | null = null;
  beforeAll(() => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    const db = drizzle(client, { schema });
    caller = appRouter.createCaller({ db: db as never, auth: {} as never, session: null });
  });
  afterAll(async () => { if (client) await client.end(); });

  it.skipIf(!hasDb)("catalog returns mapped parks", async () => {
    const { parks } = await caller!.map.catalog();
    expect(Array.isArray(parks)).toBe(true);
    if (parks.length > 0) {
      const p = parks[0]!;
      expect(p).toHaveProperty("provider");
      expect(p).toHaveProperty("siteCount");
      expect(typeof p.campgroundCount).toBe("number");
    }
  });

  it.skipIf(!hasDb)("availability returns a ParkAvailabilityResponse shape for a park", async () => {
    const { parks } = await caller!.map.catalog();
    const parkId = parks[0]?.parkPageId ?? "468";
    const res = await caller!.map.availability({ parkPageId: parkId, access: [], kinds: [], hide: [] });
    expect(res).toHaveProperty("nextAvailableDates");
    expect(res).toHaveProperty("nextAvailableWeekends");
    expect(res.parkPageId).toBe(parkId);
  });

  it.skipIf(!hasDb)("summary returns { parks } counts", async () => {
    const { parks } = await caller!.map.summary({ access: [], kinds: [], hide: [], weekendsOnly: false });
    expect(Array.isArray(parks)).toBe(true);
  });
});
```
> `createCaller(ctx)` bypasses HTTP — it calls procedures directly with a constructed context. The `db as never`/`auth as never` casts are fine for the test (the procedures only use `ctx.db`). Catalog will be non-empty if `seed:catalog` ran; availability may be empty until the 1c scanner has run (the test asserts the SHAPE, not data presence). Note in your report whether the local DB had seeded catalog + any availability.

- [ ] **Step 5: Verify** — `bun --filter @campbrain/api test` (router tests run/pass) + `bun --filter @campbrain/api typecheck` exit 0.

- [ ] **Step 6: Commit**
```bash
git add apps/api
git commit -m "feat(api): map tRPC router (catalog/availability/summary)"
```

---

## Task 6: Allowlist enforcement at sign-in

Wire the Phase-0 `isAllowlisted` into BetterAuth so only invited emails get a session; non-allowlisted users are redirected to `/request-access`. The public map needs no session, so this only gates login (for the Phase-2 save/alert features).

**Files:** Modify `apps/api/src/auth.ts`; Create/confirm `apps/api/test/allowlist.test.ts`.

- [ ] **Step 1: Read `apps/api/src/auth.ts`** — confirm `createAuth(db, env)` returns `betterAuth({...})` and closes over `db`. Read `apps/api/src/allowlist.ts` for `isAllowlisted(db, email)`.

- [ ] **Step 2: Add the allowlist gate** to the `betterAuth({...})` config in `createAuth`:
```ts
import { isAllowlisted } from "./allowlist";
// ...
return betterAuth({
  // ...existing config (database, secret, baseURL, trustedOrigins, socialProviders, advanced)...
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          // `db` is closed over from createAuth's param. Look up the user's email.
          const userRows = await db.select().from(schema.user).where(eq(schema.user.id, session.userId));
          const email = userRows[0]?.email;
          if (!email || !(await isAllowlisted(db, email))) {
            return false; // do not create the session → user gets no cookie
          }
          return; // allow (undefined = proceed)
        },
      },
    },
  },
  onAPIError: { errorURL: "/request-access" },
});
```
> Read the BetterAuth `databaseHooks.session.create.before` contract in this codebase's installed version to confirm the hook arg shape (it receives the session being created; `session.userId` references the just-upserted user). If the hook arg already includes the user/email, use that instead of the extra query. `schema.user` + `eq` come from `@campbrain/db`/`drizzle-orm` — import them (the auth file already imports the drizzle schema for the adapter; reuse it). `onAPIError.errorURL` redirects a rejected sign-in to the existing `/request-access` page. Confirm the exact BetterAuth option names against the installed version — if `databaseHooks`/`onAPIError` differ, adapt to the available hook (the research identified `databaseHooks.session.create.before` as the enforcement point; verify in node_modules/better-auth types).

- [ ] **Step 3: Test `isAllowlisted`** `apps/api/test/allowlist.test.ts` (create if missing, else extend) — against local PG: insert an email into `access_allowlist`, assert `isAllowlisted(db, email) === true` (case-insensitive: test `Email@X.com` matches a seeded `email@x.com`), and a non-seeded email → `false`. skipIf(!dbReachable). Clean up the inserted row.
> The BetterAuth hook itself (the OAuth flow) is verified end-to-end at deploy (manual: a non-allowlisted Google account → bounced to `/request-access`); unit-testing the full OAuth hook needs a BetterAuth harness out of scope here. Testing `isAllowlisted` (the decision logic) is the unit gate. Note this split in your report.

- [ ] **Step 4: Verify** — `bun --filter @campbrain/api test` + `bun --filter @campbrain/api typecheck` exit 0. Confirm the Worker still builds: `cd apps/api && bunx wrangler deploy --dry-run --outdir /tmp/cb-1d1 2>&1 | tail -5` (the auth change shouldn't break the bundle).

- [ ] **Step 5: Commit**
```bash
git add apps/api
git commit -m "feat(api): enforce allowlist at sign-in (BetterAuth session hook)"
```

---

## Task 7: App title + full-repo verification

**Files:** Modify `apps/web/index.html`.

- [ ] **Step 1: Set the app title** — in `apps/web/index.html`, change `<title>web</title>` to `<title>CampBrain</title>`.

- [ ] **Step 2: Full-repo gates** (local PG up + migrated + catalog seeded):
```bash
bun install
bun run typecheck
bun run test
bun run build
```
Expected: all packages green — `@campbrain/core` (map-transforms tests), `@campbrain/types` (map schema tests), `@campbrain/api` (map router + allowlist tests), plus the existing suites. Paste the per-package summary + total. Confirm `apps/web` builds (the title change + no other web change).

- [ ] **Step 3: Confirm the new public API surface** — `bun --filter @campbrain/api typecheck` and confirm `AppRouter` exposes `map.catalog`/`map.availability`/`map.summary` (the types that 1d-2's frontend will infer). Optionally print the inferred shape by importing `AppRouter` in a scratch typecheck.

- [ ] **Step 4: Commit**
```bash
git add apps/web
git commit -m "feat(web): set app title to CampBrain"
```

---

## Self-Review

**Spec coverage (1d-1 = the backend half of the spec's Map IA + API layer + the deferred allowlist gate):**
- tRPC `map` router (catalog, availability, summary) → Task 5. ✅
- Route-layer transforms ported to a tested, Workers-safe module → Tasks 1–3. ✅
- Map input schemas (shared zod) → Task 4. ✅
- Allowlist wired into the auth flow (the Phase-0 deferral) → Task 6. ✅
- App `<title>` → Task 7. ✅
- The Vite map page (consuming this router) → **Phase 1d-2** (scoped out). ✅
- Save/alert `allowlistedProcedure` + frontend route guards → **Phase 2** (scoped out). ✅
- Rec.gov `facilityIds` multi-facility → deferred (CA-only `parkPageId`). ✅

**Placeholder scan:** No "TBD/TODO". Transforms are given in full (ported from the cited route, which the executor reads to verify fidelity); the buildParkAvailability assembler is given in full with a note to reconcile the weekend-tier loop against the legacy handler; tests have real assertions with a note to lock weekend-tier expected values against actual output.

**Type/name consistency:** `MapAvailabilityFilters`/`AvailableDateEntry`/`WeekendEntry`/`ParkAvailabilityResponse`/`MapPark`/`CatalogParkInput` (core) used consistently; `MapAvailabilityInputSchema`/`MapSummaryInputSchema` (types) consumed by the router (Task 5) matching the procedure inputs; `toMapPark`/`buildParkAvailability` signatures match their call sites. `@campbrain/core` does NOT import `@campbrain/db` (layering preserved — `toMapPark` takes a local `CatalogParkInput` structurally equal to `CatalogPark`).

**Risk notes for the executor:**
1. **`buildParkAvailability` (Task 2) is the highest-fidelity port.** Open `web/app/api/map/availability/route.ts` and diff the weekend-tier expansion (the allowFri/allowSat gating, the 5 tiers, the walk-up union, the cg-exclusion filter) + the `nextAvailableDates` per-date build against the plan code. Lock the unit-test expected values against the function's ACTUAL output (run it, then assert). The legacy is the source of truth for any discrepancy.
2. **BetterAuth hook (Task 6):** the exact `databaseHooks.session.create.before` arg shape + `onAPIError` option name depend on the installed BetterAuth version — verify against `node_modules/better-auth` types before relying on the plan's snippet; adapt to the available hook that fires on every sign-in and can block session creation. The end-to-end OAuth gate is a deploy-time manual check; the unit gate is `isAllowlisted`.
3. **`createCaller` test (Task 5):** asserts response SHAPE, not data — availability data requires the 1c scanner to have run; catalog requires `seed:catalog`. The test skips without a local DB; CI provides Postgres + runs migrate (confirm CI also seeds catalog or the catalog test asserts only the array type).
4. **Layering:** keep `@campbrain/core` free of `@campbrain/db` imports (use `CatalogParkInput`); the router (which has both deps) bridges them.

---

## Execution Handoff

This plan is intended to be executed in a **fresh session** (per the user's choice). Recommended: **subagent-driven-development** (fresh subagent per task, spec + code-quality review between tasks). The plan is self-contained — the executing session should read the cited legacy route files (`web/app/api/map/availability/route.ts`, `catalog/route.ts`) to verify port fidelity, and have local Postgres up (`docker compose -f docker-compose.dev.yml up -d`, `bun --filter @campbrain/db migrate`, `bun --filter @campbrain/db seed:catalog`) for the integration tests.

After 1d-1 lands, the next step is the **1d-2 plan** (the Vite Leaflet map page that consumes `api.map.*`) — the visible live-map milestone. After 1d-2, Phase 1 is complete and `hosted-launch` can merge to `main` per the spec's P2 plan.
