# CampBrain Hosted Launch — Phase 1b (DB Read Layer + Catalog Seed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CampBrain's CA-parks **availability and park catalog queryable from Neon via typed, Workers-safe functions** in `packages/db`, so the Phase-1c scanner can write and the Phase-1d map/tRPC layer can read. This ports the DB-coupled read functions out of the legacy `src/cache/availability-cache.ts` and adds a catalog seed (`data/catalog/california-parks.json` → Neon).

**Architecture:** Read functions accept a Drizzle DB handle and run SQL via `db.execute(sql\`…\`)`, normalized through a tiny `rows()` helper that bridges the **neon-serverless** return shape (`{ rows }`, used in the Worker) and the **postgres-js** return shape (array, used in local tests). The legacy SQL is ported largely verbatim, converting `getSql()` + `sql.unsafe(text, [$1,$2])` positional params into drizzle `sql` template interpolation; the dynamic filter builder is rewritten to produce drizzle `SQL[]` fragments. The catalog is seeded into Neon (parks gain `latitude`/`longitude` columns) by a Node seed script reusing `@campbrain/core`'s `classifySite`. Pure helpers (`firstMatchingArrival`, `classifySite`, `SiteAccess`/`SiteKind`) are imported from `@campbrain/core` (ported in Phase 1a).

**Tech Stack:** Bun · TypeScript (strict) · Drizzle ORM (neon-serverless in prod, postgres-js in migrate/tests) · `@neondatabase/serverless` · `postgres` · Vitest · dayjs · `@campbrain/core`.

**Spec:** `docs/superpowers/specs/2026-06-17-hosted-launch-design.md` (Phase 1 section). **Phase 1a is shipped** (the `@campbrain/core` domain port + saved-search DTOs in `@campbrain/types`).

---

## Phase 1 decomposition (this is sub-plan 1b of 4)

- **1a — Domain core port (SHIPPED):** `@campbrain/core` pure logic + saved-search DTOs.
- **1b — DB read layer + catalog seed (THIS PLAN):** typed read functions in `@campbrain/db` + `latitude`/`longitude` on `parks` + a catalog seed script. Exit: availability + catalog queryable from Neon via typed functions; pure helpers unit-tested; SQL queries integration-tested against local Postgres.
- **1c — Scanner (Cron + Queues + R2):** ports the DB-**write** path (`upsertEntry`, `findStaleWindows`, `evictExpired`, `refreshMaterializedView`/`rebuildMaterializedView`, `getCacheStats`) into a CF Cron + Queue consumer that fetches+parses (via `@campbrain/core`) and upserts to Neon (via `@campbrain/db`). Exit: real availability flowing into Neon on a schedule.
- **1d — Map surface + allowlist enforcement:** tRPC `map` router consuming `@campbrain/db`'s read functions; the Vite map page (Leaflet + filters + weekend tiers); the route-layer transforms (`buildDateSiteMap`, weekend-tier expansion, walk-up split — currently inline in `web/app/api/map/availability/route.ts`); allowlist enforcement; app `<title>`. Exit: live map at the staging URL.

**Deliberately NOT in Phase 1b** (deferred, with reasons):
- **DB write path** — `upsertEntry`, `findStaleWindows`, `evictExpired`, `refreshMaterializedView`, `rebuildMaterializedView`, `getCacheStats` → **Phase 1c** (scanner). (The MV itself + `refreshAvailableStays` already exist in `packages/db/src/mv.ts`.)
- **Route-layer transforms** — `buildDateSiteMap`, `sitesAvailableForDates`, `splitWalkUp`, `weekendFridaysFromAvailableDates` live inline in `web/app/api/map/availability/route.ts` (pure, but coupled to the map response shape) → **Phase 1d** (map surface), which will rebuild them on top of `getEntriesForParks`.
- **`listAvailableStays`** (MV-backed 1N/2N precompute) — no consumer in the map slice (the new `/search` uses `searchAvailableStays`, not the MV). Defer until a surface needs it; the MV + `refreshAvailableStays` already exist.
- **Recreation.gov** — CA-parks only for now.

**Included but map-adjacent (used by `/explore`, which is Phase 2):** `searchAvailableStays` + `findNextAvailableDates` (Task 7). They are part of the cohesive availability read layer and cheap to port alongside; ported now so the read package is complete and tested in one pass. The **map** (1d) consumes only `getCatalogParks`, `getEntriesForParks`, and `getParkAvailabilityCounts`.

---

## Port conventions (read once before starting)

This is mostly a **port** of working SQL from `src/cache/availability-cache.ts` into `packages/db`. For each function:

1. **Behavior is the source of truth** — open the cited `src/cache/availability-cache.ts` lines and preserve the SQL semantics and the JS post-processing exactly.
2. **Execution conversion:** the legacy uses `const sql = getSql()` (a `postgres` client) with either tagged templates (`` sql`…${x}…` ``) or `` sql.unsafe(text, [params]) `` (positional `$1,$2`). In `packages/db`, functions instead take a `QueryDb` handle and call `rows<RowType>(db, sql\`…${x}…\`)` (drizzle-orm `sql` tag). Convert positional `$N` placeholders to inline `${param}` interpolation (drizzle parameterizes safely). Convert dynamic clause concatenation to drizzle `SQL[]` fragments joined with `sql.join(fragments, sql\` AND \`)`.
3. **Imports:** `AvailabilityWindowEntry`, `CampgroundWindow`, `AvailableStay`, `SiteAccess`, `SiteKind`, `firstMatchingArrival`, `classifySite` come from `@campbrain/core` (NOT from `../cache/types` / `../catalog/site-classifier`). Drop all `.js` import extensions.
4. **Workers-safety:** the read functions and everything they import (the `rows()` helper, `@campbrain/core`, drizzle-orm) must be free of `node:`/`fs`/`path`/`postgres` (the `postgres` npm client is **not** Workers-safe). The seed script and the test helper MAY use `postgres`/`postgres-js` because they run only in Node — but they must NOT be re-exported from `packages/db/src/index.ts` (the barrel the Worker imports).
5. **Strict tsconfig** (`tsconfig.base.json`): `strict`, `verbatimModuleSyntax` (use `import type` for types), `isolatedModules`, `noUncheckedIndexedAccess` (the ported `firstMatchingArrival` already lives in core; the SQL row mapping must narrow `row[i]`), `moduleResolution: Bundler`.

---

## File structure (`packages/db`)

```
packages/db/
  package.json            + dependency "@campbrain/core": "workspace:*"; + script "seed:catalog"
  src/
    schema.ts             MODIFY: add latitude/longitude to parks
    client.ts             (unchanged) createDb (neon), closeDb, type Db
    mv.ts                 (unchanged) MV_CREATE_SQL, refreshAvailableStays
    index.ts              MODIFY: re-export the new query modules (NOT seed-catalog / test helpers)
    seed-catalog.ts       NEW: data/catalog/california-parks.json → Neon (providers/parks+latlon/campgrounds/sites)
    queries/
      exec.ts             NEW: QueryDb type + rows() result normalizer
      filters.ts          NEW: SiteAccess/SiteKind (re-export from core), HideTarget, AvailabilityClauseOptions, pgEnumArray, buildAvailabilityClauses
      entries.ts          NEW: EntryRow, buildEntriesFromRows, getEntriesForParks, getEntriesForPark
      summary.ts          NEW: ParkAvailabilityCount, getParkAvailabilityCounts
      search.ts           NEW: SearchCampground/SearchParkResult/NextAvailableResult, searchAvailableStays, findNextAvailableDates
      catalog.ts          NEW: CatalogPark type, getCatalogParks (parks + lat/lon + campgrounds + site counts)
  migrations/
    0002_*.sql            NEW (generated): ALTER TABLE parks ADD latitude/longitude
  test/
    helpers.ts            NEW: createTestDb() (postgres-js drizzle → local PG), dbReachable(), fixture insert/cleanup helpers
    exec.test.ts          NEW: rows() normalizer (integration)
    filters.test.ts       NEW: pgEnumArray + buildAvailabilityClauses (pure unit)
    entries.test.ts       NEW: buildEntriesFromRows (pure unit) + getEntriesForParks (integration)
    summary.test.ts       NEW: getParkAvailabilityCounts (integration)
    search.test.ts        NEW: searchAvailableStays + findNextAvailableDates (integration)
    catalog.test.ts       NEW: getCatalogParks (integration)
    seed-catalog.test.ts  NEW: seed script smoke (integration)
```

**Integration tests** hit a real local Postgres (the existing `test/schema.test.ts` pattern). They must **skip gracefully** when no DB is reachable so CI without a Postgres service stays green; pure unit tests always run. See Task 1 Step 4.

---

## Task 1: deps + `rows()` exec normalizer + test DB helper

**Files:**
- Modify: `packages/db/package.json` (add `@campbrain/core` dep)
- Create: `packages/db/src/queries/exec.ts`
- Create: `packages/db/test/helpers.ts`
- Create: `packages/db/test/exec.test.ts`

- [ ] **Step 1: Add the core dependency**

In `packages/db/package.json`, add to `dependencies`:
```json
"@campbrain/core": "workspace:*"
```
(Keep the existing `drizzle-orm`, `@neondatabase/serverless`, `postgres` deps.)

- [ ] **Step 2: Create the exec normalizer** `packages/db/src/queries/exec.ts`

The Worker runs `drizzle-orm/neon-serverless`, whose `db.execute(sql)` returns a pg-style `{ rows }` object. Local tests run `drizzle-orm/postgres-js`, whose `db.execute(sql)` returns an array (a `postgres` RowList, which `Array.isArray` reports as `true`). `rows()` normalizes both and is the ONLY place that knows the difference.

```ts
import type { SQL } from "drizzle-orm";

/** Minimal DB surface the read functions need. Satisfied by both the neon-serverless
 *  Drizzle handle (prod/Worker) and the postgres-js Drizzle handle (local tests). */
export interface QueryDb {
  execute(query: SQL): Promise<unknown>;
}

/** Execute a SQL query and return its rows, normalizing the two adapter return shapes:
 *  neon-serverless → { rows: [...] }; postgres-js → [...] (array). */
export async function rows<T = Record<string, unknown>>(db: QueryDb, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  if (Array.isArray(result)) return result as T[];
  const maybe = (result as { rows?: unknown }).rows;
  return (Array.isArray(maybe) ? maybe : []) as T[];
}
```

- [ ] **Step 3: Create the test DB helper** `packages/db/test/helpers.ts`

Uses `drizzle-orm/postgres-js` (Node-only — fine in tests; never imported by `src/index.ts`). `createTestDb()` returns a handle assignable to `QueryDb`.

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/schema";

const LOCAL_URL = "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";

export function testDbUrl(): string {
  return process.env.DATABASE_URL ?? LOCAL_URL;
}

/** Raw postgres client (for fixture inserts/cleanup) + drizzle handle (for the read fns). */
export function createTestDb() {
  const client = postgres(testDbUrl(), { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, client };
}

/** True if the local/CI Postgres is reachable; used to skip integration tests in DB-less CI. */
export async function dbReachable(): Promise<boolean> {
  try {
    const client = postgres(testDbUrl(), { max: 1, onnotice: () => {}, connect_timeout: 2 });
    await client`SELECT 1`;
    await client.end();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Write the exec integration test** `packages/db/test/exec.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { rows } from "../src/queries/exec";
import { createTestDb, dbReachable } from "./helpers";

describe("rows() normalizer", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  beforeAll(() => { if (hasDb) env = createTestDb(); });
  afterAll(async () => { if (env) await env.client.end(); });

  it.skipIf(!hasDb)("returns a rows array from a SELECT", async () => {
    const r = await rows<{ n: number }>(env!.db, sql`SELECT 1 AS n`);
    expect(r).toEqual([{ n: 1 }]);
  });
});
```

This `describe(async () => { const hasDb = await dbReachable(); … it.skipIf(!hasDb) })` pattern is the template for every integration test below.

- [ ] **Step 5: Verify**

Run: `docker compose -f docker-compose.dev.yml up -d` then `bun --filter @campbrain/db migrate` (ensures local schema exists).
Run: `bun install`
Run: `bun --filter @campbrain/db test` → exec test PASSES (or skips if no DB).
Run: `bun --filter @campbrain/db typecheck` → exit 0.

- [ ] **Step 6: Commit**
```bash
git add packages/db bun.lock
git commit -m "feat(db): add @campbrain/core dep, rows() exec normalizer, test DB helper"
```

---

## Task 2: schema migration — add `latitude`/`longitude` to `parks`

The map needs per-park coordinates for pins; the legacy `parks` table has none (lat/lon lived only in the catalog JSON). Add nullable columns and generate a migration.

**Files:**
- Modify: `packages/db/src/schema.ts` (parks table)
- Create: `packages/db/migrations/0002_*.sql` (generated)
- Create: `packages/db/test/schema-parks.test.ts`

- [ ] **Step 1: Add columns to the Drizzle schema**

In `packages/db/src/schema.ts`, ensure `doublePrecision` is imported from `drizzle-orm/pg-core`, then extend the `parks` table:
```ts
export const parks = pgTable("parks", {
  providerId: text("provider_id").notNull().references(() => providers.providerId),
  parkPageId: text("park_page_id").notNull(),
  parkName: text("park_name").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
}, (t) => [primaryKey({ columns: [t.providerId, t.parkPageId] })]);
```

- [ ] **Step 2: Generate the migration**

Run: `bun --filter @campbrain/db generate`
Expected: a new `packages/db/migrations/0002_*.sql` containing `ALTER TABLE "parks" ADD COLUMN "latitude" double precision;` and the `longitude` column. Inspect it to confirm it ONLY adds the two columns (no destructive changes).

- [ ] **Step 3: Apply the migration to local PG**

Run: `bun --filter @campbrain/db migrate`
Expected: applies cleanly; the MV re-apply step at the end of `migrate.ts` is idempotent.

- [ ] **Step 4: Schema test** `packages/db/test/schema-parks.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { testDbUrl, dbReachable } from "./helpers";

describe("parks lat/lon columns", async () => {
  const hasDb = await dbReachable();
  let sql: ReturnType<typeof postgres> | null = null;
  beforeAll(() => { if (hasDb) sql = postgres(testDbUrl(), { max: 1, onnotice: () => {} }); });
  afterAll(async () => { if (sql) await sql.end(); });

  it.skipIf(!hasDb)("parks has latitude and longitude", async () => {
    const cols = await sql!`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'parks'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names).toEqual(expect.arrayContaining(["latitude", "longitude"]));
  });
});
```

- [ ] **Step 5: Verify** — `bun --filter @campbrain/db test` (green/skip) + `typecheck` exit 0.

- [ ] **Step 6: Commit**
```bash
git add packages/db
git commit -m "feat(db): add latitude/longitude to parks (migration 0002)"
```

---

## Task 3: filter types + clause builder (`filters.ts`)

Source: `src/cache/availability-cache.ts:376-446` (`SiteAccess`/`SiteKind`/`HideTarget`, `AvailabilityClauseOptions`, `pgEnumArray`, `ACCESS_VALUES`/`KIND_VALUES`, `buildAvailabilityClauses`). `SiteAccess`/`SiteKind` are already exported by `@campbrain/core` (re-export them); `HideTarget` is new here. `buildAvailabilityClauses` is rewritten to emit drizzle `SQL[]` fragments instead of string clauses + positional params.

**Files:**
- Create: `packages/db/src/queries/filters.ts`
- Create: `packages/db/test/filters.test.ts`

- [ ] **Step 1: Write `packages/db/src/queries/filters.ts`**

```ts
import { sql, type SQL } from "drizzle-orm";
import type { SiteAccess, SiteKind } from "@campbrain/core";

export type { SiteAccess, SiteKind };
export type HideTarget = "group" | "equestrian" | "walk_up";

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
  /** Base predicates (status/date/day-use/range/access/kind/group/equestrian). */
  conds: SQL[];
  /** Day-of-week predicate(s); kept separate so the min-stay path can omit them. */
  dowConds: SQL[];
  /** True when walk-up sites should be excluded from counts. */
  excludeWalkUp: boolean;
  minNights?: 1 | 2 | 3;
}

const ACCESS_VALUES = ["drive_in", "hike_in", "boat_in"] as const;
const KIND_VALUES = ["tent", "hookup", "cabin"] as const;

/** Validate an enum list against the allowed set; returns the validated subset or null. */
export function pgEnumArray(values: string[] | undefined, allowed: readonly string[]): string[] | null {
  if (!values || values.length === 0) return null;
  const safe = values.filter((v) => allowed.includes(v));
  return safe.length === 0 ? null : safe;
}

/** Build parameterized availability predicates for `availability a JOIN sites s`. */
export function buildAvailabilityClauses(opts: AvailabilityClauseOptions): AvailabilityClauseResult {
  const { from, to, access, kinds, hide = [], minNights, weekendsOnly = false } = opts;

  const conds: SQL[] = [
    sql`a.status = 'available'`,
    sql`a.date >= CURRENT_DATE`,
    sql`s.is_day_use = false`,
  ];
  if (from) conds.push(sql`a.date >= ${from}::date`);
  if (to) conds.push(sql`a.date <= ${to}::date`);

  const accessArr = pgEnumArray(access, ACCESS_VALUES);
  if (accessArr) conds.push(sql`s.access = ANY(${accessArr})`);

  const kindArr = pgEnumArray(kinds, KIND_VALUES);
  if (kindArr) conds.push(sql`s.site_kind = ANY(${kindArr})`);

  let excludeWalkUp = false;
  for (const h of hide) {
    if (h === "group") conds.push(sql`NOT s.is_group`);
    else if (h === "equestrian") conds.push(sql`NOT s.is_equestrian`);
    else if (h === "walk_up") excludeWalkUp = true;
  }

  const dowConds: SQL[] = [];
  if (weekendsOnly) dowConds.push(sql`EXTRACT(DOW FROM a.date)::int IN (5, 6)`);

  const result: AvailabilityClauseResult = { conds, dowConds, excludeWalkUp };
  if (minNights) result.minNights = minNights;
  return result;
}
```
> Behavior parity with `src/cache/availability-cache.ts:413-446`: same base predicates, same `from`/`to`, same access/kind `ANY(...)`, same `NOT s.is_group`/`NOT s.is_equestrian`, same `walk_up` → `excludeWalkUp`, same weekends-only DOW separation. The only change is fragment form (drizzle `SQL`) vs. string+positional-params.

- [ ] **Step 2: Write `packages/db/test/filters.test.ts`** (pure unit — no DB)

`buildAvailabilityClauses` returns opaque `SQL` objects, so assert on the **observable** properties (`excludeWalkUp`, `minNights`, fragment counts) and unit-test `pgEnumArray` directly (its validation is the injection-safety boundary).

```ts
import { describe, it, expect } from "vitest";
import { pgEnumArray, buildAvailabilityClauses } from "../src/queries/filters";

describe("pgEnumArray", () => {
  it("returns null for empty/undefined", () => {
    expect(pgEnumArray(undefined, ["a"])).toBeNull();
    expect(pgEnumArray([], ["a"])).toBeNull();
  });
  it("drops values not in the allowed set", () => {
    expect(pgEnumArray(["drive_in", "evil"], ["drive_in", "hike_in"])).toEqual(["drive_in"]);
  });
  it("returns null when nothing survives validation", () => {
    expect(pgEnumArray(["evil"], ["drive_in"])).toBeNull();
  });
});

describe("buildAvailabilityClauses", () => {
  it("includes the three base predicates by default", () => {
    const r = buildAvailabilityClauses({});
    expect(r.conds.length).toBe(3); // status, date>=today, not day-use
    expect(r.dowConds.length).toBe(0);
    expect(r.excludeWalkUp).toBe(false);
    expect(r.minNights).toBeUndefined();
  });
  it("adds from/to/access/kind predicates and the weekend DOW clause", () => {
    const r = buildAvailabilityClauses({
      from: "2026-07-01", to: "2026-07-31",
      access: ["hike_in"], kinds: ["tent"], weekendsOnly: true,
    });
    expect(r.conds.length).toBe(7); // 3 base + from + to + access + kind
    expect(r.dowConds.length).toBe(1);
  });
  it("sets excludeWalkUp for hide=walk_up and passes minNights through", () => {
    const r = buildAvailabilityClauses({ hide: ["walk_up"], minNights: 2 });
    expect(r.excludeWalkUp).toBe(true);
    expect(r.minNights).toBe(2);
    // group/equestrian add predicates; walk_up does not (it's a flag)
    expect(r.conds.length).toBe(3);
  });
});
```

- [ ] **Step 3: Verify** — `bun --filter @campbrain/db test` (filters tests PASS, always — pure) + `typecheck` exit 0.

- [ ] **Step 4: Commit**
```bash
git add packages/db
git commit -m "feat(db): port availability filter types + clause builder"
```

---

## Task 4: per-park availability entries (`entries.ts`)

Source: `src/cache/availability-cache.ts:237-374` (`EntryRow`, `ENTRY_SELECT`, `ENTRY_JOINS`, `buildEntriesFromRows`, `getEntriesForParks`, `getEntriesForPark`). `buildEntriesFromRows` is a pure mapper — port verbatim. `getEntriesForParks` converts `sql.unsafe(text, [parkPageIds, providerName])` (positional `$1`/`$2` + optional provider clause) into a drizzle `sql` template.

**Files:**
- Create: `packages/db/src/queries/entries.ts`
- Create: `packages/db/test/entries.test.ts`

- [ ] **Step 1: Write `packages/db/src/queries/entries.ts`**

```ts
import { sql } from "drizzle-orm";
import type { AvailabilityWindowEntry, CampgroundWindow } from "@campbrain/core";
import { rows, type QueryDb } from "./exec";

export type EntryRow = {
  park_page_id: string;
  park_name: string;
  window_start: string;
  window_end: string;
  scanned_at: string;
  source_url: string;
  cg_name: string | null;
  cg_id: string | null;
  nightly_fee: string | null;
  booking_url: string | null;
  site_id: number | null;
  site_name: string | null;
  avail_date: string | null;
  status: string | null;
};

/** Pure: assemble nested AvailabilityWindowEntry[] from flat join rows.
 *  Ported verbatim from src/cache/availability-cache.ts:271-321. */
export function buildEntriesFromRows(rowsIn: EntryRow[]): AvailabilityWindowEntry[] {
  const windowMap = new Map<string, AvailabilityWindowEntry>();
  const cgMap = new Map<string, CampgroundWindow>();
  const siteMap = new Map<string, { name: string; dates: Record<string, "available" | "unavailable" | "unknown"> }>();

  for (const row of rowsIn) {
    const windowKey = `${row.park_page_id}::${row.window_start}`;
    if (!windowMap.has(windowKey)) {
      windowMap.set(windowKey, {
        parkPageId: row.park_page_id,
        parkName: row.park_name,
        windowStart: row.window_start,
        windowEnd: row.window_end,
        scannedAt: row.scanned_at,
        sourceUrl: row.source_url,
        campgrounds: [],
      });
    }
    if (row.cg_name === null) continue;

    const cgKey = `${windowKey}::${row.cg_name}`;
    if (!cgMap.has(cgKey)) {
      const cg: CampgroundWindow = { id: row.cg_id ?? row.cg_name, name: row.cg_name, sites: [] };
      if (row.nightly_fee !== null) cg.nightlyFee = Number(row.nightly_fee);
      if (row.booking_url !== null) cg.bookingUrl = row.booking_url;
      cgMap.set(cgKey, cg);
      windowMap.get(windowKey)!.campgrounds.push(cg);
    }
    if (row.site_name === null) continue;

    const siteKey = `${cgKey}::${row.site_name}`;
    if (!siteMap.has(siteKey)) {
      const site = { name: row.site_name, dates: {} as Record<string, "available" | "unavailable" | "unknown"> };
      siteMap.set(siteKey, site);
      cgMap.get(cgKey)!.sites.push(site);
    }
    if (row.avail_date !== null && row.status !== null) {
      siteMap.get(siteKey)!.dates[row.avail_date] = row.status as "available" | "unavailable" | "unknown";
    }
  }
  return Array.from(windowMap.values());
}

const ENTRY_QUERY_SELECT = sql`
  sw.park_page_id, p.park_name,
  sw.window_start::text AS window_start, sw.window_end::text AS window_end,
  sw.scanned_at::text AS scanned_at, sw.source_url,
  cg.campground_name AS cg_name, cg.campground_id AS cg_id,
  cg.nightly_fee, cg.booking_url,
  s.site_id, s.site_name,
  a.date::text AS avail_date, a.status`;

const ENTRY_QUERY_JOINS = sql`
  JOIN parks p ON p.provider_id = sw.provider_id AND p.park_page_id = sw.park_page_id
  LEFT JOIN campgrounds cg ON cg.provider_id = sw.provider_id AND cg.park_page_id = sw.park_page_id
  LEFT JOIN sites s ON s.provider_id = cg.provider_id AND s.park_page_id = cg.park_page_id AND s.campground_name = cg.campground_name
  LEFT JOIN availability a ON a.site_id = s.site_id AND a.date >= sw.window_start AND a.date <= sw.window_end AND a.status = 'available'`;

/** All non-expired windows for the given parks, with per-site per-date availability.
 *  Ported from src/cache/availability-cache.ts:352-367. */
export async function getEntriesForParks(
  db: QueryDb,
  parkPageIds: string[],
  providerName?: string,
): Promise<AvailabilityWindowEntry[]> {
  if (parkPageIds.length === 0) return [];
  const providerCond = providerName ? sql` AND sw.provider_id = ${providerName}` : sql``;
  const result = await rows<EntryRow>(
    db,
    sql`SELECT ${ENTRY_QUERY_SELECT} FROM scan_windows sw ${ENTRY_QUERY_JOINS}
        WHERE sw.park_page_id = ANY(${parkPageIds})${providerCond} AND sw.window_end >= CURRENT_DATE
        ORDER BY sw.window_start, cg.campground_name, s.site_name, a.date`,
  );
  return buildEntriesFromRows(result);
}

export async function getEntriesForPark(
  db: QueryDb,
  parkPageId: string,
  providerName?: string,
): Promise<AvailabilityWindowEntry[]> {
  return getEntriesForParks(db, [parkPageId], providerName);
}
```
> Conversion notes: `$1` (parkPageIds array) → `ANY(${parkPageIds})`; `$2` (provider) → an optional `sql` fragment; `sql.unsafe`+string constants → composed `sql` fragments. Semantics match the source: `park_page_id = ANY(...)`, optional provider, `window_end >= CURRENT_DATE`, same ORDER BY. (The legacy non-park-scoped `queryEntries`/`listFreshEntries`/`listAllEntries` with the `EXISTS(... available)` filter and TTL staleness are NOT ported — the map fetches per park; those scanner/admin readers belong to 1c if needed.)

- [ ] **Step 2: Write `packages/db/test/entries.test.ts`**

Two layers: a pure unit test for `buildEntriesFromRows` (always runs) and an integration test for `getEntriesForParks` (skips without DB). The integration test seeds a fixture under a dedicated `provider_id='test-1b'` so it never collides with real/seeded data, and cleans up afterward.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildEntriesFromRows, getEntriesForParks, type EntryRow } from "../src/queries/entries";
import { createTestDb, dbReachable } from "./helpers";

describe("buildEntriesFromRows (pure)", () => {
  it("nests park → campground → site → dates and ignores null fan-out rows", () => {
    const base = {
      park_page_id: "p1", park_name: "Park One",
      window_start: "2026-07-01", window_end: "2026-07-08",
      scanned_at: "2026-06-20T00:00:00Z", source_url: "http://x",
    };
    const rows: EntryRow[] = [
      { ...base, cg_name: "Loop A", cg_id: "loop-a", nightly_fee: "35.00", booking_url: "http://b",
        site_id: 1, site_name: "Site 1", avail_date: "2026-07-01", status: "available" },
      { ...base, cg_name: "Loop A", cg_id: "loop-a", nightly_fee: "35.00", booking_url: "http://b",
        site_id: 1, site_name: "Site 1", avail_date: "2026-07-02", status: "available" },
      { ...base, cg_name: null, cg_id: null, nightly_fee: null, booking_url: null,
        site_id: null, site_name: null, avail_date: null, status: null }, // empty window row
    ];
    const entries = buildEntriesFromRows(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.campgrounds[0]!.nightlyFee).toBe(35);
    expect(entries[0]!.campgrounds[0]!.sites[0]!.dates).toEqual({
      "2026-07-01": "available", "2026-07-02": "available",
    });
  });
});

describe("getEntriesForParks (integration)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  const PROVIDER = "test-1b";
  const PARK = "test-park-entries";

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    const sql = env.client;
    await sql`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER}, 'Test') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO parks (provider_id, park_page_id, park_name) VALUES (${PROVIDER}, ${PARK}, 'Test Park') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO scan_windows (provider_id, park_page_id, window_start, window_end, scanned_at, source_url)
      VALUES (${PROVIDER}, ${PARK}, '2999-01-01', '2999-01-08', NOW(), 'http://x') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id, nightly_fee, booking_url)
      VALUES (${PROVIDER}, ${PARK}, 'Loop A', 'loop-a', 35.00, 'http://b') ON CONFLICT DO NOTHING`;
    const [site] = await sql`INSERT INTO sites (provider_id, park_page_id, campground_name, site_name)
      VALUES (${PROVIDER}, ${PARK}, 'Loop A', 'Site 1')
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET site_name = EXCLUDED.site_name
      RETURNING site_id`;
    await sql`INSERT INTO availability (site_id, date, status) VALUES (${site!.site_id}, '2999-01-02', 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
  });

  afterAll(async () => {
    if (!env) return;
    const sql = env.client;
    await sql`DELETE FROM availability WHERE site_id IN (SELECT site_id FROM sites WHERE provider_id = ${PROVIDER})`;
    await sql`DELETE FROM sites WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM campgrounds WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM scan_windows WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM parks WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM providers WHERE provider_id = ${PROVIDER}`;
    await env.client.end();
  });

  it.skipIf(!hasDb)("returns the seeded park's window with the available date", async () => {
    const entries = await getEntriesForParks(env!.db, [PARK], PROVIDER);
    expect(entries).toHaveLength(1);
    const site = entries[0]!.campgrounds[0]!.sites[0]!;
    expect(site.name).toBe("Site 1");
    expect(site.dates["2999-01-02"]).toBe("available");
  });
});
```
> The `2999-…` future window dodges the `window_end >= CURRENT_DATE` filter permanently. Reuse this fixture/cleanup shape in later tasks (extract into `helpers.ts` if it grows — but inline is fine).

- [ ] **Step 3: Verify** — `bun --filter @campbrain/db test` (pure PASS; integration PASS or skip) + `typecheck` exit 0.

- [ ] **Step 4: Commit**
```bash
git add packages/db
git commit -m "feat(db): port per-park availability entries reader"
```

---

## Task 5: park availability counts (`summary.ts`)

Source: `src/cache/availability-cache.ts:500-583` (`ParkAvailabilityCount`, `getParkAvailabilityCounts`). Two paths: a no-minNights aggregate (`COUNT(DISTINCT … ) FILTER (…)`) and a minNights path that pulls per-site dates and applies `firstMatchingArrival` (from `@campbrain/core`) in JS. Powers the map pin-lighting summary.

**Files:**
- Create: `packages/db/src/queries/summary.ts`
- Create: `packages/db/test/summary.test.ts`

- [ ] **Step 1: Write `packages/db/src/queries/summary.ts`**

```ts
import { sql } from "drizzle-orm";
import { firstMatchingArrival } from "@campbrain/core";
import { rows, type QueryDb } from "./exec";
import { buildAvailabilityClauses, type AvailabilityClauseOptions } from "./filters";

export interface ParkAvailabilityCount {
  parkPageId: string;
  siteCount: number;
  walkUpCount: number;
  /** Earliest bookable date matching the filters; null when only walk-up sites match. */
  soonestDate: string | null;
}

/** Per-park bookable + walk-up counts in the date range, with filters + optional min-stay.
 *  Ported from src/cache/availability-cache.ts:514-583. */
export async function getParkAvailabilityCounts(
  db: QueryDb,
  opts: AvailabilityClauseOptions = {},
): Promise<ParkAvailabilityCount[]> {
  const { conds, dowConds, excludeWalkUp, minNights } = buildAvailabilityClauses(opts);

  if (!minNights) {
    const where = sql.join([...conds, ...dowConds], sql` AND `);
    const bookable = sql`COUNT(DISTINCT s.site_id) FILTER (WHERE NOT s.is_walk_up)`;
    const walkUp = excludeWalkUp ? sql`0` : sql`COUNT(DISTINCT s.site_id) FILTER (WHERE s.is_walk_up)`;
    const having = excludeWalkUp ? sql`(${bookable}) > 0` : sql`(${bookable}) > 0 OR (${walkUp}) > 0`;
    const result = await rows<{ park_page_id: string; site_count: number; walk_up_count: number; soonest_date: string | null }>(
      db,
      sql`SELECT s.park_page_id,
                 (${bookable})::int AS site_count,
                 (${walkUp})::int AS walk_up_count,
                 (MIN(a.date) FILTER (WHERE NOT s.is_walk_up))::text AS soonest_date
          FROM availability a
          JOIN sites s ON s.site_id = a.site_id
          WHERE ${where}
          GROUP BY s.park_page_id
          HAVING ${having}`,
    );
    return result.map((r) => ({
      parkPageId: r.park_page_id,
      siteCount: Number(r.site_count),
      walkUpCount: Number(r.walk_up_count),
      soonestDate: r.soonest_date ?? null,
    }));
  }

  // Min-stay path: WHERE omits the DOW clause (arrival DOW is checked in firstMatchingArrival).
  const where = sql.join(conds, sql` AND `);
  const dateRows = await rows<{ park_page_id: string; site_id: number; is_walk_up: boolean; date: string }>(
    db,
    sql`SELECT s.park_page_id, s.site_id, s.is_walk_up, a.date::text AS date
        FROM availability a
        JOIN sites s ON s.site_id = a.site_id
        WHERE ${where}
        ORDER BY s.park_page_id, s.site_id, a.date`,
  );

  const bySite = new Map<number, { parkPageId: string; isWalkUp: boolean; dates: string[] }>();
  for (const r of dateRows) {
    let e = bySite.get(r.site_id);
    if (!e) { e = { parkPageId: r.park_page_id, isWalkUp: r.is_walk_up, dates: [] }; bySite.set(r.site_id, e); }
    e.dates.push(r.date);
  }

  const stay = { minNights, from: opts.from ?? null, to: opts.to ?? null, weekendsOnly: opts.weekendsOnly ?? false };
  const perPark = new Map<string, { siteCount: number; walkUpCount: number; soonestDate: string | null }>();
  for (const { parkPageId, isWalkUp, dates } of bySite.values()) {
    const arrival = firstMatchingArrival(dates, stay);
    if (arrival === null) continue;
    let p = perPark.get(parkPageId);
    if (!p) { p = { siteCount: 0, walkUpCount: 0, soonestDate: null }; perPark.set(parkPageId, p); }
    if (isWalkUp) { if (!excludeWalkUp) p.walkUpCount++; }
    else {
      p.siteCount++;
      if (p.soonestDate === null || arrival < p.soonestDate) p.soonestDate = arrival;
    }
  }

  return [...perPark.entries()]
    .map(([parkPageId, c]) => ({ parkPageId, ...c }))
    .filter((c) => c.siteCount > 0 || c.walkUpCount > 0);
}
```
> Parity with the source: identical aggregate columns, `FILTER` clauses, the `HAVING (bookable)>0 [OR (walkUp)>0]` shape, and the minNights JS aggregation via `firstMatchingArrival`.

- [ ] **Step 2: Write `packages/db/test/summary.test.ts`** (integration)

Seed (under `provider_id='test-1b-sum'`) one park with: a bookable tent site available on two consecutive future dates, and a walk-up site available on one date. Reuse the fixture/cleanup shape from Task 4. Assert:
- no-filter: `siteCount === 1`, `walkUpCount === 1`, `soonestDate` = the bookable site's earliest date.
- `hide: ['walk_up']`: `walkUpCount === 0`.
- `minNights: 2`: the 2-consecutive-night bookable site still counts (`siteCount === 1`); a site with only a single isolated night would not.
- `access: ['boat_in']` (no such sites): empty result.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getParkAvailabilityCounts } from "../src/queries/summary";
import { createTestDb, dbReachable } from "./helpers";

describe("getParkAvailabilityCounts (integration)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  const PROVIDER = "test-1b-sum";
  const PARK = "sum-park";

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    const sql = env.client;
    await sql`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER}, 'Test') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO parks (provider_id, park_page_id, park_name) VALUES (${PROVIDER}, ${PARK}, 'Sum Park') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id) VALUES (${PROVIDER}, ${PARK}, 'CG', 'cg') ON CONFLICT DO NOTHING`;
    const [book] = await sql`INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, access, site_kind)
      VALUES (${PROVIDER}, ${PARK}, 'CG', 'Tent 1', 'drive_in', 'tent')
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET site_name = EXCLUDED.site_name RETURNING site_id`;
    const [walk] = await sql`INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, is_walk_up)
      VALUES (${PROVIDER}, ${PARK}, 'CG', 'Hike 1', true)
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET is_walk_up = EXCLUDED.is_walk_up RETURNING site_id`;
    await sql`INSERT INTO availability (site_id, date, status) VALUES
      (${book!.site_id}, '2999-02-01', 'available'),
      (${book!.site_id}, '2999-02-02', 'available'),
      (${walk!.site_id}, '2999-02-01', 'available')
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`;
  });

  afterAll(async () => {
    if (!env) return;
    const sql = env.client;
    await sql`DELETE FROM availability WHERE site_id IN (SELECT site_id FROM sites WHERE provider_id = ${PROVIDER})`;
    await sql`DELETE FROM sites WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM campgrounds WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM parks WHERE provider_id = ${PROVIDER}`;
    await sql`DELETE FROM providers WHERE provider_id = ${PROVIDER}`;
    await env.client.end();
  });

  const find = (arr: Awaited<ReturnType<typeof getParkAvailabilityCounts>>) => arr.find((p) => p.parkPageId === PARK);

  it.skipIf(!hasDb)("counts bookable + walk-up with soonest date", async () => {
    const p = find(await getParkAvailabilityCounts(env!.db, {}));
    expect(p).toBeTruthy();
    expect(p!.siteCount).toBe(1);
    expect(p!.walkUpCount).toBe(1);
    expect(p!.soonestDate).toBe("2999-02-01");
  });
  it.skipIf(!hasDb)("hides walk-up when requested", async () => {
    const p = find(await getParkAvailabilityCounts(env!.db, { hide: ["walk_up"] }));
    expect(p!.walkUpCount).toBe(0);
  });
  it.skipIf(!hasDb)("min-stay 2 keeps the 2-consecutive-night bookable site", async () => {
    const p = find(await getParkAvailabilityCounts(env!.db, { minNights: 2 }));
    expect(p!.siteCount).toBe(1);
  });
  it.skipIf(!hasDb)("access filter with no matches returns no park row", async () => {
    const p = find(await getParkAvailabilityCounts(env!.db, { access: ["boat_in"] }));
    expect(p).toBeUndefined();
  });
});
```

- [ ] **Step 3: Verify** — `bun --filter @campbrain/db test` + `typecheck`.

- [ ] **Step 4: Commit**
```bash
git add packages/db
git commit -m "feat(db): port park availability counts (summary)"
```

---

## Task 6: catalog reader (`catalog.ts`)

Source: `src/cache/availability-cache.ts:678-714` (`DbParkSummary`, `listParksFromDb`). Extend it to include `latitude`/`longitude` (the columns added in Task 2) so the map can place pins entirely from Neon.

**Files:**
- Create: `packages/db/src/queries/catalog.ts`
- Create: `packages/db/test/catalog.test.ts`

- [ ] **Step 1: Write `packages/db/src/queries/catalog.ts`**

```ts
import { sql } from "drizzle-orm";
import { rows, type QueryDb } from "./exec";

export interface CatalogPark {
  providerId: string;
  parkPageId: string;
  parkName: string;
  latitude: number | null;
  longitude: number | null;
  campgrounds: { name: string; siteCount: number }[];
}

/** All parks that have sites in the DB, with coordinates + per-campground site counts.
 *  Extends src/cache/availability-cache.ts:685-713 with lat/lon. */
export async function getCatalogParks(db: QueryDb): Promise<CatalogPark[]> {
  const result = await rows<{
    provider_id: string; park_page_id: string; park_name: string;
    latitude: number | null; longitude: number | null;
    campground_name: string; site_count: number;
  }>(
    db,
    sql`SELECT p.provider_id, p.park_page_id, p.park_name, p.latitude, p.longitude,
               s.campground_name, COUNT(s.site_id)::int AS site_count
        FROM parks p
        JOIN sites s ON s.provider_id = p.provider_id AND s.park_page_id = p.park_page_id
        GROUP BY p.provider_id, p.park_page_id, p.park_name, p.latitude, p.longitude, s.campground_name
        ORDER BY p.park_name, s.campground_name`,
  );

  const byPark = new Map<string, CatalogPark>();
  for (const row of result) {
    const key = `${row.provider_id}:${row.park_page_id}`;
    if (!byPark.has(key)) {
      byPark.set(key, {
        providerId: row.provider_id,
        parkPageId: row.park_page_id,
        parkName: row.park_name,
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        campgrounds: [],
      });
    }
    byPark.get(key)!.campgrounds.push({ name: row.campground_name, siteCount: Number(row.site_count) });
  }
  return Array.from(byPark.values());
}
```

- [ ] **Step 2: Write `packages/db/test/catalog.test.ts`** (integration)

Seed one park (under `provider_id='test-1b-cat'`) with lat/lon and two sites across two campgrounds; assert `getCatalogParks()` returns the park with coordinates and the two campgrounds with correct site counts. (Same fixture/cleanup shape as Task 4; set `latitude`/`longitude` on the `parks` insert.)

- [ ] **Step 3: Verify** — `bun --filter @campbrain/db test` + `typecheck`.

- [ ] **Step 4: Commit**
```bash
git add packages/db
git commit -m "feat(db): port catalog reader with lat/lon"
```

---

## Task 7: availability search + fallback (`search.ts`)

Source: `src/cache/availability-cache.ts:798-975` (`SearchCampground`, `SearchParkResult`, `searchAvailableStays`, `NextAvailableResult`, `findNextAvailableDates`). These power `/explore` (Phase 2) but belong to the availability read layer. Port the SQL (convert `$1/$2/$3` and the dynamic `IN (...)` placeholders to drizzle interpolation).

**Files:**
- Create: `packages/db/src/queries/search.ts`
- Create: `packages/db/test/search.test.ts`

- [ ] **Step 1: Write `packages/db/src/queries/search.ts`**

```ts
import { sql } from "drizzle-orm";
import dayjs from "dayjs";
import type { SiteAccess, SiteKind, HideTarget } from "./filters";
import { pgEnumArray } from "./filters";
import { rows, type QueryDb } from "./exec";

export type SearchCampground = {
  name: string;
  nightlyFee: number | null;
  bookingUrl: string | null;
  availableSites: string[];
  walkUpSites: string[];
};
export type SearchParkResult = {
  parkPageId: string;
  parkName: string;
  campgrounds: SearchCampground[];
};

/** Sites available on EVERY night in [from, to). Ported from availability-cache.ts:820-913. */
export async function searchAvailableStays(
  db: QueryDb,
  params: { from: string; to: string; access?: SiteAccess[]; kinds?: SiteKind[]; hide?: HideTarget[] },
): Promise<SearchParkResult[]> {
  const { from, to, access, kinds, hide = [] } = params;
  const nightCount = dayjs(to).diff(dayjs(from), "day");
  if (nightCount < 1) return [];

  const filters: import("drizzle-orm").SQL[] = [sql`s.is_day_use = false`];
  const accessArr = pgEnumArray(access, ["drive_in", "hike_in", "boat_in"]);
  if (accessArr) filters.push(sql`s.access = ANY(${accessArr})`);
  const kindArr = pgEnumArray(kinds, ["tent", "hookup", "cabin"]);
  if (kindArr) filters.push(sql`s.site_kind = ANY(${kindArr})`);
  if (hide.includes("group")) filters.push(sql`NOT s.is_group`);
  if (hide.includes("equestrian")) filters.push(sql`NOT s.is_equestrian`);
  if (hide.includes("walk_up")) filters.push(sql`NOT s.is_walk_up`);
  const filterWhere = sql.join(filters, sql` AND `);

  type Row = {
    park_page_id: string; park_name: string; campground_name: string;
    nightly_fee: string | null; booking_url: string | null; site_name: string; is_walk_up: boolean;
  };
  const result = await rows<Row>(
    db,
    sql`SELECT p.park_page_id, p.park_name, cg.campground_name, cg.nightly_fee::text, cg.booking_url, s.site_name, s.is_walk_up
        FROM sites s
        JOIN campgrounds cg ON cg.provider_id = s.provider_id AND cg.park_page_id = s.park_page_id AND cg.campground_name = s.campground_name
        JOIN parks p ON p.provider_id = s.provider_id AND p.park_page_id = s.park_page_id
        WHERE s.site_id IN (
          SELECT a.site_id FROM availability a
          WHERE a.date >= ${from}::date AND a.date < ${to}::date AND a.status = 'available'
          GROUP BY a.site_id HAVING COUNT(DISTINCT a.date) = ${nightCount}::int
        ) AND ${filterWhere}
        ORDER BY p.park_name, cg.campground_name, s.site_name`,
  );

  const parkMap = new Map<string, SearchParkResult>();
  for (const row of result) {
    if (!parkMap.has(row.park_page_id)) {
      parkMap.set(row.park_page_id, { parkPageId: row.park_page_id, parkName: row.park_name, campgrounds: [] });
    }
    const park = parkMap.get(row.park_page_id)!;
    let cg = park.campgrounds.find((c) => c.name === row.campground_name);
    if (!cg) {
      cg = { name: row.campground_name, nightlyFee: row.nightly_fee !== null ? Number(row.nightly_fee) : null,
             bookingUrl: row.booking_url, availableSites: [], walkUpSites: [] };
      park.campgrounds.push(cg);
    }
    if (row.is_walk_up) cg.walkUpSites.push(row.site_name);
    else cg.availableSites.push(row.site_name);
  }
  return [...parkMap.values()];
}

export type NextAvailableResult = { parkPageId: string; parkName: string; earliestDate: string };

/** Up to 5 parks' earliest bookable date within `withinDays`. Ported from availability-cache.ts:930-975. */
export async function findNextAvailableDates(
  db: QueryDb,
  params: { withinDays?: number; parkPageIds?: string[] },
): Promise<NextAvailableResult[]> {
  const { withinDays = 60, parkPageIds } = params;
  const endDate = dayjs().add(withinDays, "day").format("YYYY-MM-DD");

  const conds: import("drizzle-orm").SQL[] = [
    sql`a.status = 'available'`,
    sql`a.date >= CURRENT_DATE`,
    sql`a.date <= ${endDate}::date`,
    sql`NOT s.is_walk_up`,
    sql`s.is_day_use = false`,
  ];
  if (parkPageIds && parkPageIds.length > 0) conds.push(sql`s.park_page_id = ANY(${parkPageIds})`);
  const where = sql.join(conds, sql` AND `);

  const result = await rows<{ park_page_id: string; park_name: string; earliest_date: string }>(
    db,
    sql`SELECT s.park_page_id, p.park_name, MIN(a.date)::text AS earliest_date
        FROM availability a
        JOIN sites s ON s.site_id = a.site_id
        JOIN parks p ON p.provider_id = s.provider_id AND p.park_page_id = s.park_page_id
        WHERE ${where}
        GROUP BY s.park_page_id, p.park_name
        ORDER BY earliest_date
        LIMIT 5`,
  );
  return result.map((r) => ({ parkPageId: r.park_page_id, parkName: r.park_name, earliestDate: r.earliest_date }));
}
```
> Conversion notes: `$1/$2` dates → `${from}::date`/`${to}::date`; `$3` nightCount → `${nightCount}::int`; the legacy dynamic `park_page_id IN ($n,$n+1,…)` placeholder list → `park_page_id = ANY(${parkPageIds})` (equivalent, simpler). Behavior preserved: `< to` exclusive, `HAVING COUNT(DISTINCT a.date) = nightCount`, walk-up split, `LIMIT 5` fallback.

- [ ] **Step 2: Write `packages/db/test/search.test.ts`** (integration)

Seed (under `provider_id='test-1b-search'`) a site available on three consecutive future dates. Assert:
- `searchAvailableStays({ from, to })` for a 2-night range inside that span returns the park with the site in `availableSites`.
- a range requiring a night the site lacks returns no park (or no campground with that site).
- `findNextAvailableDates({})` includes the park with its earliest date. (Caveat: `findNextAvailableDates` is bounded to `CURRENT_DATE … +withinDays`, so use **near-future** dates here, e.g. `dayjs().add(3,'day')`, not the `2999` sentinel — and clean them up.)

- [ ] **Step 3: Verify** — `bun --filter @campbrain/db test` + `typecheck`.

- [ ] **Step 4: Commit**
```bash
git add packages/db
git commit -m "feat(db): port availability search + next-available fallback"
```

---

## Task 8: catalog seed script (`seed-catalog.ts`)

Reads `data/catalog/california-parks.json` (`{ provider, parks: [...] }`, 200 parks, 88 with campgrounds) and upserts `providers` → `parks` (with `lat`/`lon`) → `campgrounds` → `sites` (classified via `@campbrain/core`'s `classifySite`). Node-only script (uses the raw `postgres` client like `seed-allowlist.ts`); NOT imported by the Worker bundle.

**Files:**
- Create: `packages/db/src/seed-catalog.ts`
- Modify: `packages/db/package.json` (add `"seed:catalog"` script)
- Create: `packages/db/test/seed-catalog.test.ts`

- [ ] **Step 1: Write `packages/db/src/seed-catalog.ts`**

Key points: read the JSON with `fs` (resolve `data/catalog/california-parks.json` from the repo root — the script runs from repo root via bun); upsert in dependency order; dedupe campgrounds by `name` and sites by `(campground_name, site_name)`; call `classifySite(site.name, cg.name)` for the 6 classification columns. Insert `latitude`/`longitude` from the catalog entry's `lat`/`lon` (may be undefined → null). Use bulk inserts where practical (`sql(rows, ...cols)`), `ON CONFLICT … DO UPDATE` matching the legacy `upsertEntry` conflict keys.

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { classifySite } from "@campbrain/core";

type CatalogSite = { id: string; name: string };
type CatalogCampground = { id: string; name: string; bookingUrl?: string; nightlyFee?: number; sites: CatalogSite[] };
type CatalogPark = { parkName: string; parkPageId: string; campgrounds: CatalogCampground[]; lat?: number; lon?: number };
type ProviderCatalog = { provider: string; parks: CatalogPark[] };

const PROVIDER_ID = "california-parks";
const PROVIDER_NAME = "California State Parks";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const dataDir = process.env.CAMPBRAIN_DATA_DIR ?? join(process.cwd(), "data");
  const path = join(dataDir, "catalog", "california-parks.json");
  const catalog = JSON.parse(readFileSync(path, "utf-8")) as ProviderCatalog;

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER_ID}, ${PROVIDER_NAME}) ON CONFLICT (provider_id) DO NOTHING`;

    let parkCount = 0, cgCount = 0, siteCount = 0;
    for (const park of catalog.parks) {
      await sql`
        INSERT INTO parks (provider_id, park_page_id, park_name, latitude, longitude)
        VALUES (${PROVIDER_ID}, ${park.parkPageId}, ${park.parkName}, ${park.lat ?? null}, ${park.lon ?? null})
        ON CONFLICT (provider_id, park_page_id) DO UPDATE SET
          park_name = EXCLUDED.park_name, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude`;
      parkCount++;

      const cgByName = new Map<string, CatalogCampground>();
      for (const cg of park.campgrounds) cgByName.set(cg.name, cg);

      for (const cg of cgByName.values()) {
        await sql`
          INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id, nightly_fee, booking_url)
          VALUES (${PROVIDER_ID}, ${park.parkPageId}, ${cg.name}, ${cg.id}, ${cg.nightlyFee ?? null}, ${cg.bookingUrl ?? null})
          ON CONFLICT (provider_id, park_page_id, campground_name) DO UPDATE SET
            campground_id = EXCLUDED.campground_id, nightly_fee = EXCLUDED.nightly_fee, booking_url = EXCLUDED.booking_url`;
        cgCount++;

        const siteByName = new Map<string, CatalogSite>();
        for (const s of cg.sites) siteByName.set(s.name, s);
        for (const s of siteByName.values()) {
          const info = classifySite(s.name, cg.name);
          await sql`
            INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, access, site_kind, is_group, is_equestrian, is_walk_up, is_day_use)
            VALUES (${PROVIDER_ID}, ${park.parkPageId}, ${cg.name}, ${s.name},
                    ${info.access}, ${info.siteKind}, ${info.isGroup}, ${info.isEquestrian}, ${info.isWalkUp}, ${info.isDayUse})
            ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET
              access = EXCLUDED.access, site_kind = EXCLUDED.site_kind, is_group = EXCLUDED.is_group,
              is_equestrian = EXCLUDED.is_equestrian, is_walk_up = EXCLUDED.is_walk_up, is_day_use = EXCLUDED.is_day_use`;
          siteCount++;
        }
      }
    }
    console.log(`✅ seeded ${parkCount} parks, ${cgCount} campgrounds, ${siteCount} sites`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```
> Per-row inserts keep the script simple and readable; the catalog is ~6,700 sites, which seeds in well under a minute against Neon. Optimize to bulk inserts only if it proves too slow.

- [ ] **Step 2: Add the script** to `packages/db/package.json`:
```json
"seed:catalog": "bun run src/seed-catalog.ts"
```

- [ ] **Step 3: Write `packages/db/test/seed-catalog.test.ts`** (integration smoke)

The seed targets the real `california-parks` provider (not a test sentinel), so this test runs the seed against local PG and asserts representative outcomes, then leaves the data (it's the real catalog — useful for the other integration tests too). Guard with `dbReachable()`.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { testDbUrl, dbReachable } from "./helpers";

describe("seed-catalog (integration smoke)", async () => {
  const hasDb = await dbReachable();
  let sql: ReturnType<typeof postgres> | null = null;
  beforeAll(async () => {
    if (!hasDb) return;
    // Run the seed (idempotent). Spawn so it uses the script's own main().
    const proc = Bun.spawn(["bun", "run", "src/seed-catalog.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: testDbUrl() },
      stdout: "pipe", stderr: "pipe",
    });
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    sql = postgres(testDbUrl(), { max: 1, onnotice: () => {} });
  });
  afterAll(async () => { if (sql) await sql.end(); });

  it.skipIf(!hasDb)("loads the california-parks provider with parks and classified sites", async () => {
    const [{ count: parkCount }] = await sql!`SELECT COUNT(*)::int AS count FROM parks WHERE provider_id = 'california-parks'`;
    expect(Number(parkCount)).toBeGreaterThan(150); // ~200 parks
    const [{ count: latCount }] = await sql!`SELECT COUNT(*)::int AS count FROM parks WHERE provider_id = 'california-parks' AND latitude IS NOT NULL`;
    expect(Number(latCount)).toBeGreaterThan(0);
    const [{ count: siteCount }] = await sql!`SELECT COUNT(*)::int AS count FROM sites WHERE provider_id = 'california-parks'`;
    expect(Number(siteCount)).toBeGreaterThan(1000); // ~6,700 sites
  });
});
```
> The seed test runs the real script via `Bun.spawn` so the script's own `main()`/path resolution is exercised. If `Bun.spawn` proves awkward in the vitest runner, refactor `seed-catalog.ts` to export an async `seedCatalog(sql)` and call it directly from the test (and from `main()`), keeping `main()` as the CLI entry. Choose whichever the executor finds reliable; note which was used.

- [ ] **Step 4: Verify**

Run: `bun --filter @campbrain/db migrate` (schema current) then `bun --filter @campbrain/db test`.
Optionally run the seed manually: `DATABASE_URL=… bun --filter @campbrain/db seed:catalog` → prints the seeded counts.

- [ ] **Step 5: Commit**
```bash
git add packages/db
git commit -m "feat(db): catalog seed script (california-parks.json → Neon)"
```

---

## Task 9: barrel exports + full-repo verification

**Files:**
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Re-export the read layer** — append to `packages/db/src/index.ts`:
```ts
export * from "./queries/exec";
export * from "./queries/filters";
export * from "./queries/entries";
export * from "./queries/summary";
export * from "./queries/catalog";
export * from "./queries/search";
```
Do NOT export `./seed-catalog` (Node-only `postgres`/`fs`) or anything from `test/` — the Worker imports this barrel and must stay free of Node-only modules. Confirm `bun --filter @campbrain/db typecheck` stays clean (watch for export-name collisions, e.g. `SiteAccess`/`SiteKind` are re-exported from `filters` — they should not collide with any existing db export).

- [ ] **Step 2: Workers-safety assertion** — the read modules + their imports must be Node-free:
```bash
git grep -nE "from \"node:|require\(|\bfs\b|\bpath\b|\bpostgres\b" -- packages/db/src/queries packages/db/src/index.ts || echo clean
```
Expected: `clean`. (`seed-catalog.ts` legitimately imports `node:fs`/`node:path`/`postgres`, but it is not under `queries/` and is not in the barrel — confirm it is excluded from the Worker path.)

- [ ] **Step 3: Full-repo gates** — from repo root:
```bash
bun install
bun run typecheck
bun run test
```
Expected: all packages green. Integration tests run against local Docker PG if up (`docker compose -f docker-compose.dev.yml up -d` + `bun --filter @campbrain/db migrate` first), otherwise skip. Paste the per-package summary + the db test count (note how many integration tests ran vs. skipped).

- [ ] **Step 4: Commit**
```bash
git add packages/db
git commit -m "feat(db): export read layer; phase 1b db read layer complete"
```

---

## Self-Review

**Spec coverage (Phase 1b = the DB read layer + catalog seed from the spec's Phase 1):**
- Per-park availability (`getEntriesForParks`/`getEntriesForPark` + `buildEntriesFromRows`) → Task 4. ✅ (map `/availability`)
- Pin-lighting counts (`getParkAvailabilityCounts` + filter/clause builder) → Tasks 3, 5. ✅ (map `/availability/summary`)
- Catalog from Neon with coordinates (`getCatalogParks` + `parks.latitude/longitude` migration + seed script) → Tasks 2, 6, 8. ✅ (map `/catalog`)
- Availability search + fallback (`searchAvailableStays`, `findNextAvailableDates`) → Task 7. ✅ (explore `/search`, Phase 2 — ported now for a complete read layer)
- Workers-safe execution bridge (`rows()` + `QueryDb`) → Task 1. ✅
- Scanner write path (`upsertEntry`, `findStaleWindows`, eviction, MV refresh) → **deferred to 1c** (scoped out above). ✅
- Route-layer transforms (`buildDateSiteMap`, weekend tiers) + `listAvailableStays` (MV) → **deferred to 1d / until needed** (scoped out). ✅

**Placeholder scan:** No "TBD/TODO". New code (exec, filters, catalog, seed, test helpers, pure unit tests) is given in full; ported SQL functions are given in full drizzle form with source citations; the integration tests for Tasks 6 and 7 describe the exact fixture + assertions to write following the fully-worked Task 4/5 templates (reuse the shown fixture/cleanup shape).

**Type/name consistency:** `QueryDb`/`rows` (exec) consumed by every query module; `SiteAccess`/`SiteKind` from `@campbrain/core`, `HideTarget`/`AvailabilityClauseOptions` from `filters`; `firstMatchingArrival`/`classifySite`/`AvailabilityWindowEntry`/`CampgroundWindow` from `@campbrain/core`. Return types match the legacy shapes the map/explore routes consume (`AvailabilityWindowEntry[]`, `ParkAvailabilityCount[]`, `SearchParkResult[]`, `NextAvailableResult[]`, `CatalogPark[]`).

**Risk notes for the executor:**
1. **Adapter return shape (Task 1).** `rows()` is the single bridge between neon (`{rows}`) and postgres-js (array). The local tests exercise the postgres-js branch; the neon `{rows}` branch is covered by the normalizer and will be exercised end-to-end in 1d on the Worker. If `db.execute` for postgres-js does NOT return a plain array in your drizzle version, adjust `rows()` and the exec test together.
2. **`sql\`…\`` array binding (`ANY(${arr})`).** Confirm via the Task 5/7 integration tests that `s.access = ANY(${accessArr})` binds a JS string[] as a Postgres array. If the driver needs an explicit cast, use `ANY(${arr}::text[])`.
3. **`sql.join` for dynamic WHERE.** `buildAvailabilityClauses` returns `SQL[]`; the consumers compose with `sql.join(conds, sql\` AND \`)`. Never interpolate user strings via `sql.raw` — only validated enum arrays (`pgEnumArray`) and bound params.
4. **CI without Postgres.** Integration tests `skipIf(!dbReachable())`. Before merging, check `.github/workflows/ci.yml`: if it provides a Postgres service, wire `DATABASE_URL` + run migrate so the integration tests actually run in CI; if not, the pure unit tests (`buildEntriesFromRows`, `pgEnumArray`, `buildAvailabilityClauses`) are the CI gate and the integration tests are a local gate (note this in the final report).

---

## Execution Handoff

Recommended: **subagent-driven-development** (fresh subagent per task, spec + code-quality review between tasks) — same as Phase 0/1a.

After 1b lands, the next step is to **write the 1c plan** (Cron + Queues + R2 scanner: ports the DB write path on top of this read layer), then 1d (map surface + allowlist enforcement).
