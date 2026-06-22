# CampBrain Hosted Launch — Phase 1c (Scanner: scheduled Node job) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get **real CA-parks availability flowing into Neon on a schedule** — a polite proactive scanner that fetches+parses every park's 8-day windows and upserts the per-site/per-day grid + refreshes the materialized view, so the Phase-1d map/explore surfaces have live data.

**Architecture:** The scanner runs as a **scheduled GitHub Actions workflow** executing a Bun/Node script (`apps/scanner`), NOT on Cloudflare. This is a deliberate, researched choice: the Cloudflare Workers **free plan caps CPU at 10 ms per invocation across all trigger types** (incl. queue consumers + cron), and parsing a ~130 KB availability page with `cheerio` is pure CPU that exceeds that — so a Worker-based parser isn't viable for free. GitHub Actions runners are full Node environments (no subrequest/CPU limits; cheerio runs fine), free for the cadence we need, and the scanner reuses the existing `@campbrain/core` provider + the `@campbrain/db` write layer (ported here) against Neon. **The `apps/api` Cloudflare Worker stays read-only — no changes to it in this phase.** Each run scans **all** windows for all CA parks (politeness via concurrency 5 + 500 ms batch delay — the provider's existing defaults), then evicts expired rows and refreshes the MV.

**Tech Stack:** Bun · TypeScript (strict) · Drizzle ORM over `@neondatabase/serverless` (transactional writes) · dayjs · cheerio (Node) · `@campbrain/core` · `@campbrain/db` · GitHub Actions (schedule + workflow_dispatch) · Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-hosted-launch-design.md` (Scanner section). **Phases 1a + 1b are shipped** on `hosted-launch` (domain core in `@campbrain/core`; read layer + catalog seed in `@campbrain/db`).

**Deviation from spec (recorded):** the spec's scanner topology is "Cloudflare Cron Triggers + Queues + R2." Research during planning established that the free-tier 10 ms CPU limit makes the cheerio parser unreliable on a Worker (Queues itself is now free, but the parser CPU is the blocker). With cost-avoidance chosen, the scanner runs on **GitHub Actions** instead; debug HTML goes to a **workflow artifact** instead of R2. The read path (map/API) remains fully Cloudflare. The Cron+Queues+R2 design can be revisited if the project moves to Workers Paid ($5/mo, 30 s CPU).

---

## What this phase ports vs. defers

**Ports the DB write path into `@campbrain/db`** (the read path was Phase 1b):
- `upsertEntry(db, entry, providerId)` — the transactional per-window upsert (parks/scan_windows/availability-delete/campgrounds/sites/availability). The hard one (postgres.js `sql.begin` + `tx(rows,cols)` bulk → drizzle `db.transaction` + raw `tx.execute(sql\`\`)` with `sql.join` bulk VALUES).
- `refreshMaterializedView(db)` — with the `ispopulated` guard the legacy had (current `refreshAvailableStays` in `mv.ts` always uses `CONCURRENTLY` and will throw on a never-populated MV).
- `evictExpired(db, nowMs?)`.

**Adds** a small `onUnexpectedHtml` debug hook to `@campbrain/core`'s `proactiveScanWindow` (keeps core pure; the scanner injects a file-writing sink).

**Adds** `apps/scanner` (a new workspace) + a scheduled GitHub Actions workflow.

**Deliberately NOT in 1c:**
- `findStaleWindows` (TTL throttling) — not needed: each run scans all windows ("enqueue-all" cadence), politeness via concurrency+delay. Defer as a future optimization.
- `getCacheStats`, `rebuildMaterializedView` — dev/stats utilities, not needed by the scan loop. Defer.
- Rec.gov provider — CA-parks only.
- The alert scan (Cron C in the spec: saved-search matching + Resend email + `alert_hit_state`/`scan_runs`) — that's Phase 2.
- Any `apps/api` / wrangler / Queues / R2 / Durable Objects work — the Worker stays read-only.

---

## Port conventions (read once)

- DB writes go through a **Drizzle handle** (`Db` from `@campbrain/db`'s `createDb`, which uses `@neondatabase/serverless` Pool — transactional over WebSocket). Use `db.transaction(async (tx) => …)`; inside, use `tx.execute(sql\`…\`)` for statements and the existing **`rows(tx, sql\`…\`)`** helper (from `packages/db/src/queries/exec.ts`) for `RETURNING` reads. Build bulk `VALUES` with `sql.join(rows.map(r => sql\`(${…})\`), sql\`, \`)` — the same composition pattern Phase 1b used for `sqlTextArray`.
- `classifySite` and `runWithConcurrency`, `generateWindowStarts`/`windowEnd`, `CaliforniaParksProvider`, `AvailabilityWindowEntry`, `CampgroundCatalogEntry`, `ParkCatalogEntry` come from `@campbrain/core`.
- Strict tsconfig (`verbatimModuleSyntax`, `isolatedModules`, `noUncheckedIndexedAccess`, `moduleResolution: Bundler`): `import type` for types; narrow indexed access.
- Integration tests hit local Docker Postgres (`docker compose -f docker-compose.dev.yml up -d` + `bun --filter @campbrain/db migrate`), guarded by the existing `skipIf(!dbReachable())` helper (from `packages/db/test/helpers.ts`). CI provides a Postgres service so they gate CI.

---

## File structure

```
packages/db/
  src/queries/upsert.ts        NEW: upsertEntry(db, entry, providerId)
  src/queries/maintenance.ts   NEW: evictExpired(db, nowMs?)
  src/mv.ts                    MODIFY: add refreshMaterializedView(db) (ispopulated guard)
  src/index.ts                 MODIFY: re-export upsert + maintenance + refreshMaterializedView
  test/upsert.test.ts          NEW
  test/maintenance.test.ts     NEW (evict + mv refresh)

packages/core/
  src/providers/california-parks-provider.ts   MODIFY: optional onUnexpectedHtml hook
  src/providers/california-parks-provider.test.ts  MODIFY: cover the hook

apps/scanner/                  NEW workspace
  package.json                 name @campbrain/scanner; deps @campbrain/core, @campbrain/db, dayjs
  tsconfig.json
  src/run-proactive-scan.ts    testable orchestration: runProactiveScan(deps)
  src/main.ts                  CLI entry: wires real deps (createDb, catalog JSON, provider, debug sink)
  test/run-proactive-scan.test.ts  NEW (mock provider + local-PG db)

.github/workflows/
  scan.yml                     NEW: schedule + workflow_dispatch → runs the scanner
```

---

## Task 1: Port `upsertEntry` into `@campbrain/db`

Source of truth: `src/cache/availability-cache.ts:56-185`. Translate the postgres.js transaction to a Drizzle transaction. Behavior must match exactly (the integration test locks it).

**Files:** Create `packages/db/src/queries/upsert.ts`, `packages/db/test/upsert.test.ts`; Modify `packages/db/src/index.ts`.

- [ ] **Step 1: Write `packages/db/src/queries/upsert.ts`**

```ts
import { sql } from "drizzle-orm";
import { classifySite, type AvailabilityWindowEntry } from "@campbrain/core";
import { rows } from "./exec";
import type { Db } from "../client";

/** Upsert one park-window's full availability grid in a single transaction.
 *  Ported from src/cache/availability-cache.ts:56-185 (postgres.js → drizzle). */
export async function upsertEntry(
  db: Db,
  entry: AvailabilityWindowEntry,
  providerId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Upsert park
    await tx.execute(sql`
      INSERT INTO parks (provider_id, park_page_id, park_name)
      VALUES (${providerId}, ${entry.parkPageId}, ${entry.parkName})
      ON CONFLICT (provider_id, park_page_id) DO UPDATE SET park_name = EXCLUDED.park_name`);

    // 2. Upsert scan_window
    await tx.execute(sql`
      INSERT INTO scan_windows (provider_id, park_page_id, window_start, window_end, scanned_at, source_url)
      VALUES (${providerId}, ${entry.parkPageId}, ${entry.windowStart}::date, ${entry.windowEnd}::date,
              ${entry.scannedAt}::timestamptz, ${entry.sourceUrl})
      ON CONFLICT (provider_id, park_page_id, window_start) DO UPDATE SET
        window_end = EXCLUDED.window_end, scanned_at = EXCLUDED.scanned_at, source_url = EXCLUDED.source_url`);

    // 3. Delete old availability for this park's sites in this window's date range
    await tx.execute(sql`
      DELETE FROM availability
      WHERE site_id IN (SELECT site_id FROM sites WHERE provider_id = ${providerId} AND park_page_id = ${entry.parkPageId})
        AND date BETWEEN ${entry.windowStart}::date AND ${entry.windowEnd}::date`);

    // 4. No campgrounds → fully booked window; done.
    if (entry.campgrounds.length === 0) return;

    // 5. Bulk upsert campgrounds (dedupe by name)
    const cgByName = new Map<string, { id: string; name: string; nightlyFee?: number; bookingUrl?: string }>();
    for (const cg of entry.campgrounds) cgByName.set(cg.name, cg);
    const cgRows = [...cgByName.values()];
    const cgValues = sql.join(
      cgRows.map((c) => sql`(${providerId}, ${entry.parkPageId}, ${c.name}, ${c.id}, ${c.nightlyFee ?? null}, ${c.bookingUrl ?? null})`),
      sql`, `,
    );
    await tx.execute(sql`
      INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id, nightly_fee, booking_url)
      VALUES ${cgValues}
      ON CONFLICT (provider_id, park_page_id, campground_name) DO UPDATE SET
        campground_id = EXCLUDED.campground_id, nightly_fee = EXCLUDED.nightly_fee, booking_url = EXCLUDED.booking_url`);

    // 6. Bulk upsert sites (classify each) → RETURNING site_id
    type SiteUpsert = {
      cgName: string; siteName: string; access: string; siteKind: string | null;
      isGroup: boolean; isEquestrian: boolean; isWalkUp: boolean; isDayUse: boolean;
    };
    const siteByKey = new Map<string, SiteUpsert>();
    for (const cg of entry.campgrounds) {
      for (const site of cg.sites) {
        const info = classifySite(site.name, cg.name, site.recGovCampsiteType);
        siteByKey.set(`${cg.name}::${site.name}`, {
          cgName: cg.name, siteName: site.name,
          access: info.access, siteKind: info.siteKind,
          isGroup: info.isGroup, isEquestrian: info.isEquestrian, isWalkUp: info.isWalkUp, isDayUse: info.isDayUse,
        });
      }
    }
    const siteRows = [...siteByKey.values()];
    if (siteRows.length === 0) return;
    const siteValues = sql.join(
      siteRows.map((s) => sql`(${providerId}, ${entry.parkPageId}, ${s.cgName}, ${s.siteName}, ${s.access}, ${s.siteKind}, ${s.isGroup}, ${s.isEquestrian}, ${s.isWalkUp}, ${s.isDayUse})`),
      sql`, `,
    );
    const returned = await rows<{ site_id: number; campground_name: string; site_name: string }>(tx, sql`
      INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, access, site_kind, is_group, is_equestrian, is_walk_up, is_day_use)
      VALUES ${siteValues}
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET
        site_name = EXCLUDED.site_name, access = EXCLUDED.access, site_kind = EXCLUDED.site_kind,
        is_group = EXCLUDED.is_group, is_equestrian = EXCLUDED.is_equestrian, is_walk_up = EXCLUDED.is_walk_up, is_day_use = EXCLUDED.is_day_use
      RETURNING site_id, campground_name, site_name`);

    // 7. site_id lookup
    const siteIdMap = new Map<string, number>();
    for (const r of returned) siteIdMap.set(`${r.campground_name}::${r.site_name}`, r.site_id);

    // 8. Bulk insert availability (dedupe by site_id::date)
    const availByKey = new Map<string, { siteId: number; date: string; status: string }>();
    for (const cg of entry.campgrounds) {
      for (const site of cg.sites) {
        const siteId = siteIdMap.get(`${cg.name}::${site.name}`);
        if (siteId === undefined) continue;
        for (const [date, status] of Object.entries(site.dates)) {
          availByKey.set(`${siteId}::${date}`, { siteId, date, status });
        }
      }
    }
    const availRows = [...availByKey.values()];
    if (availRows.length === 0) return;
    const availValues = sql.join(
      availRows.map((a) => sql`(${a.siteId}, ${a.date}::date, ${a.status})`),
      sql`, `,
    );
    await tx.execute(sql`
      INSERT INTO availability (site_id, date, status)
      VALUES ${availValues}
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`);
  });
}
```
> Notes: `rows(tx, …)` reuses the Phase-1b normalizer (`tx` has `.execute`, satisfying `QueryDb`). The `::date`/`::timestamptz` casts are preserved from the legacy. `recGovCampsiteType` is read off `site` if present (it's optional on `SiteDailyAvailability`); for CA parks it's undefined and `classifySite` ignores it. Compare each step against the legacy lines for fidelity.

- [ ] **Step 2: Export from the barrel** — append to `packages/db/src/index.ts`:
```ts
export * from "./queries/upsert";
```
Run `bun --filter @campbrain/db typecheck` (watch for collisions — `upsertEntry` is a new name).

- [ ] **Step 3: Write `packages/db/test/upsert.test.ts`** (integration)

Insert a synthetic `AvailabilityWindowEntry` for a `test-1c` provider+park (one campground, two sites, a future date each), call `upsertEntry`, then assert the rows landed (campgrounds/sites with classification, availability statuses). Then call `upsertEntry` AGAIN with a changed grid for the same window and assert the range-delete + re-insert produced the new state (idempotent + replaces in-range availability). Use the fixture/cleanup shape from `packages/db/test/entries.test.ts` (clean up the `test-1c` provider in `afterAll`, reverse-FK order).

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AvailabilityWindowEntry } from "@campbrain/core";
import { upsertEntry } from "../src/queries/upsert";
import { createTestDb, dbReachable } from "./helpers";

const PROVIDER = "test-1c";
const PARK = "upsert-park";

function makeEntry(dates: Record<string, "available" | "unavailable">): AvailabilityWindowEntry {
  return {
    parkPageId: PARK, parkName: "Upsert Park",
    windowStart: "2999-03-01", windowEnd: "2999-03-08",
    scannedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(), sourceUrl: "http://x",
    campgrounds: [{ id: "loop-a", name: "Loop A", nightlyFee: 35, bookingUrl: "http://b", sites: [
      { name: "Tent 1", dates },
      { name: "Hike 1", dates: { "2999-03-01": "available" } },
    ] }],
  };
}

describe("upsertEntry (integration)", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  beforeAll(() => { if (hasDb) env = createTestDb(); });
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

  it.skipIf(!hasDb)("inserts park/campground/sites/availability with classification", async () => {
    await env!.client`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER}, 'Test') ON CONFLICT DO NOTHING`;
    await upsertEntry(env!.db, makeEntry({ "2999-03-01": "available", "2999-03-02": "available" }), PROVIDER);
    const avail = await env!.client`
      SELECT s.site_name, s.is_walk_up, a.date::text AS date, a.status
      FROM availability a JOIN sites s ON s.site_id = a.site_id
      WHERE s.provider_id = ${PROVIDER} ORDER BY s.site_name, a.date`;
    const tent = avail.filter((r) => r.site_name === "Tent 1");
    expect(tent.map((r) => r.date)).toEqual(["2999-03-01", "2999-03-02"]);
    const hike = avail.find((r) => r.site_name === "Hike 1");
    expect(hike?.is_walk_up).toBe(true); // classifySite ran
  });

  it.skipIf(!hasDb)("replaces in-range availability on re-upsert", async () => {
    await upsertEntry(env!.db, makeEntry({ "2999-03-03": "available" }), PROVIDER);
    const tent = await env!.client`
      SELECT a.date::text AS date FROM availability a JOIN sites s ON s.site_id = a.site_id
      WHERE s.provider_id = ${PROVIDER} AND s.site_name = 'Tent 1' ORDER BY a.date`;
    // The 03-01/03-02 rows were deleted (range delete) and only 03-03 remains for Tent 1.
    expect(tent.map((r) => r.date)).toEqual(["2999-03-03"]);
  });
});
```
> Verify the second test's expectation against the legacy DELETE semantics (step 3 deletes ALL availability for the park's sites in `[windowStart, windowEnd]`, then re-inserts only the new entry's dates). Adjust if you read the behavior differently.

- [ ] **Step 4: Verify** — `bun --filter @campbrain/db test` (upsert tests run + pass) + `typecheck` exit 0.

- [ ] **Step 5: Commit**
```bash
git add packages/db
git commit -m "feat(db): port upsertEntry transactional write"
```

---

## Task 2: MV refresh (guarded) + eviction in `@campbrain/db`

**Files:** Modify `packages/db/src/mv.ts`; Create `packages/db/src/queries/maintenance.ts`, `packages/db/test/maintenance.test.ts`; Modify `packages/db/src/index.ts`.

- [ ] **Step 1: Add `refreshMaterializedView(db)` to `packages/db/src/mv.ts`**

The existing `refreshAvailableStays(db)` always runs `REFRESH MATERIALIZED VIEW CONCURRENTLY`, which **throws on a never-populated MV**. Port the legacy guard (`src/cache/availability-cache.ts:589-599`): check `pg_matviews.ispopulated`, use `CONCURRENTLY` only when populated. Add (keep `refreshAvailableStays` for back-compat, or have it delegate):
```ts
/** Refresh mv_available_stays, using CONCURRENTLY only when already populated
 *  (a never-populated MV cannot be refreshed CONCURRENTLY). Ported from
 *  src/cache/availability-cache.ts:589-599. */
export async function refreshMaterializedView(db: Db): Promise<void> {
  const res = await db.execute(sql`SELECT ispopulated FROM pg_matviews WHERE matviewname = 'mv_available_stays'`);
  const rowsArr = Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? [];
  const populated = (rowsArr[0] as { ispopulated?: boolean } | undefined)?.ispopulated === true;
  if (populated) {
    await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_available_stays`);
  } else {
    await db.execute(sql`REFRESH MATERIALIZED VIEW mv_available_stays`);
  }
}
```
(Ensure `sql` + `Db` are imported in mv.ts; they already are for `refreshAvailableStays`.) Optionally reimplement `refreshAvailableStays` to call `refreshMaterializedView` so there's one source of truth — but don't break its existing signature/exports.

- [ ] **Step 2: Write `packages/db/src/queries/maintenance.ts`**

Port `evictExpired` (`src/cache/availability-cache.ts:652-658`). The legacy reads postgres.js `result.count`; the drizzle/neon `execute` returns a `QueryResult` with `rowCount`.
```ts
import { sql } from "drizzle-orm";
import dayjs from "dayjs";
import type { Db } from "../client";

/** Delete scan_windows + availability older than today. Returns # scan_windows removed.
 *  Ported from src/cache/availability-cache.ts:652-658. */
export async function evictExpired(db: Db, nowMs: number = Date.now()): Promise<number> {
  const today = dayjs(nowMs).format("YYYY-MM-DD");
  const res = await db.execute(sql`DELETE FROM scan_windows WHERE window_end < ${today}::date`);
  await db.execute(sql`DELETE FROM availability WHERE date < ${today}::date`);
  return (res as { rowCount?: number | null }).rowCount ?? 0;
}
```
> `db.execute` over neon-serverless returns a pg-style `QueryResult` with `rowCount`. If `rowCount` is unexpectedly null in practice, the integration test will catch it — adjust to read the count however the adapter actually returns it (the test asserts on it).

- [ ] **Step 3: Export from the barrel** — append to `packages/db/src/index.ts`:
```ts
export * from "./queries/maintenance";
export { refreshMaterializedView } from "./mv";
```
(`export * from "./mv"` may already be present via another line — if so, the named re-export is redundant; just ensure `refreshMaterializedView` is reachable from the barrel without a duplicate-export error. Resolve as needed.) `typecheck` must pass.

- [ ] **Step 4: Write `packages/db/test/maintenance.test.ts`** (integration)

Seed (provider `test-1c-mx`) a park with one site and two availability rows — one with a PAST date (`2000-01-01`) and a past `scan_windows` row, one with a future date — then:
- `evictExpired(db)` → returns ≥1 (the past scan_window removed); assert the past availability row is gone and the future one remains.
- `refreshMaterializedView(db)` → does not throw (works whether or not the MV is populated); assert it completes. (Don't assert MV contents — just that the guarded refresh runs cleanly, which is the regression the guard fixes.)

Follow the fixture/cleanup shape from `entries.test.ts`; `skipIf(!hasDb)`.

- [ ] **Step 5: Verify** — `bun --filter @campbrain/db test` + `typecheck` green.

- [ ] **Step 6: Commit**
```bash
git add packages/db
git commit -m "feat(db): guarded MV refresh + evictExpired (scanner write path)"
```

---

## Task 3: Add `onUnexpectedHtml` debug hook to the core provider

So the scanner can capture the raw HTML when `proactiveScanWindow` hits the "unexpected page" branch (neither a parseable availability table nor a known "no availability" card) — for diagnosing parser drift. Keeps `@campbrain/core` pure: the provider calls an injected async callback; the scanner supplies one that writes a file.

**Files:** Modify `packages/core/src/providers/california-parks-provider.ts` + its test.

- [ ] **Step 1: Add an optional options param to `proactiveScanWindow`**

Change the signature to accept a 5th optional arg and call it at the unexpected-page branch (currently `if (!isNoAvailabilityPage(html)) { return null; }` — see `packages/core/src/providers/california-parks-provider.ts`). New shape:
```ts
async proactiveScanWindow(
  parkPageId: string,
  window: CacheWindow,
  parkName: string,
  campgrounds: CampgroundCatalogEntry[],
  options?: {
    onUnexpectedHtml?: (html: string, ctx: { parkPageId: string; arrivalDate: string; url: string }) => Promise<void>;
  },
): Promise<AvailabilityWindowEntry | null> {
```
At the unexpected branch (inside the probe loop, where `parsed.length === 0 && !isNoAvailabilityPage(html)`):
```ts
if (!isNoAvailabilityPage(html)) {
  await options?.onUnexpectedHtml?.(html, { parkPageId, arrivalDate, url });
  return null;
}
```
(Use the loop's `arrivalDate` and `url` variables already in scope.) No other behavior changes. The `AvailabilityProvider` interface's `proactiveScanWindow` does not need the options param (the concrete method may accept extra optional args and still satisfy the interface — verify it typechecks; if the interface signature conflicts, add the optional `options?` param to the interface too, keeping it optional so it's non-breaking).

- [ ] **Step 2: Cover the hook in the provider test**

Add a test that stubs global `fetch` to return an "unexpected" HTML page (no `<section class="card">` AND not matching the `isNoAvailabilityPage` pattern — e.g. `"<html><body>Maintenance</body></html>"`), passes an `onUnexpectedHtml` spy, and asserts: the method returns `null` AND the spy was called with the unexpected HTML + a context object. Mock `fetch` with `vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200 })))` (or the project's existing fetch-mock approach — check how `california-parks-provider.test.ts` already tests fetch paths; reuse it). Restore the stub after.

- [ ] **Step 3: Verify** — `bun --filter @campbrain/core test` (new case + all prior) + `typecheck` exit 0. Confirm `packages/core` is still Workers-pure (`git grep -nE "from \"node:|\bfs\b|\bpath\b" -- packages/core/src/providers || echo clean` → clean; the callback type doesn't import anything).

- [ ] **Step 4: Commit**
```bash
git add packages/core
git commit -m "feat(core): optional onUnexpectedHtml debug hook on proactiveScanWindow"
```

---

## Task 4: `apps/scanner` — the proactive scan orchestration

A new workspace with a testable `runProactiveScan(deps)` (dependency-injected for unit testing) and a `main.ts` that wires real deps. Adapts `src/scanner/proactive-scanner.ts` to CA-parks-only, scan-all (no `findStaleWindows`), DB-injected, reading the catalog JSON.

**Files:** Create `apps/scanner/package.json`, `apps/scanner/tsconfig.json`, `apps/scanner/src/run-proactive-scan.ts`, `apps/scanner/src/main.ts`, `apps/scanner/test/run-proactive-scan.test.ts`.

- [ ] **Step 1: `apps/scanner/package.json`**
```json
{
  "name": "@campbrain/scanner",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@campbrain/core": "workspace:*",
    "@campbrain/db": "workspace:*",
    "dayjs": "^1.11.13"
  },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.7.0" }
}
```
And `apps/scanner/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`. (No build script — it runs via `bun` directly; turbo `build` skips it.)

- [ ] **Step 2: `apps/scanner/src/run-proactive-scan.ts`** — the testable orchestration

```ts
import { CaliforniaParksProvider, type AvailabilityWindowEntry, type ParkCatalogEntry, runWithConcurrency } from "@campbrain/core";
import { upsertEntry, evictExpired, refreshMaterializedView, type Db } from "@campbrain/db";
import dayjs from "dayjs";

const PROVIDER_ID = "california-parks";
const CONCURRENCY = 5;
const BATCH_DELAY_MS = 500;

export interface ScanDeps {
  db: Db;
  /** CA parks (already filtered to ones worth scanning). */
  parks: ParkCatalogEntry[];
  provider?: CaliforniaParksProvider; // injectable for tests
  daysAhead?: number;                 // default 180
  todayOverride?: string;             // YYYY-MM-DD, for tests
  concurrency?: number;
  batchDelayMs?: number;
  log?: (msg: string) => void;
  /** Capture HTML from unexpected-page responses (e.g. write a debug artifact). */
  onUnexpectedHtml?: (html: string, ctx: { parkPageId: string; arrivalDate: string; url: string }) => Promise<void>;
  sleep?: (ms: number) => Promise<void>; // injectable for tests
}

export interface ScanSummary {
  parks: number; windows: number; fetched: number; fetchErrors: number; cacheWrites: number; durationMs: number;
}

/** Scan every 8-day window for every park, upsert results, evict, refresh the MV. */
export async function runProactiveScan(deps: ScanDeps): Promise<ScanSummary> {
  const start = Date.now();
  const log = deps.log ?? (() => {});
  const provider = deps.provider ?? new CaliforniaParksProvider();
  const concurrency = deps.concurrency ?? CONCURRENCY;
  const delayMs = deps.batchDelayMs ?? BATCH_DELAY_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const today = deps.todayOverride ? dayjs(deps.todayOverride) : dayjs();
  const rangeStart = today.add(2, "day").format("YYYY-MM-DD");
  const rangeEnd = today.add(deps.daysAhead ?? 180, "day").format("YYYY-MM-DD");

  type Candidate = { park: ParkCatalogEntry; windowStart: string; windowEnd: string };
  const candidates: Candidate[] = deps.parks.flatMap((park) =>
    provider.generateCacheWindows(rangeStart, rangeEnd).map((w) => ({ park, windowStart: w.windowStart, windowEnd: w.windowEnd })),
  );
  log(`Proactive scan: ${deps.parks.length} parks, ${candidates.length} windows`);

  let fetched = 0, fetchErrors = 0, cacheWrites = 0;
  const tasks = candidates.map((c) => async () => {
    fetched++;
    const entry: AvailabilityWindowEntry | null = await provider.proactiveScanWindow(
      c.park.parkPageId, { windowStart: c.windowStart, windowEnd: c.windowEnd }, c.park.parkName, c.park.campgrounds,
      deps.onUnexpectedHtml ? { onUnexpectedHtml: deps.onUnexpectedHtml } : undefined,
    );
    if (entry === null) { fetchErrors++; return; }
    await upsertEntry(deps.db, entry, PROVIDER_ID);
    cacheWrites++;
  });

  // Polite batching: `concurrency` per batch, `delayMs` between batches.
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    await runWithConcurrency(batch, concurrency);
    if (i + batch.length < tasks.length) await sleep(delayMs);
  }

  const evicted = await evictExpired(deps.db);
  if (evicted > 0) log(`Evicted ${evicted} expired scan windows`);
  try { await refreshMaterializedView(deps.db); log("MV refreshed"); }
  catch (e) { log(`MV refresh failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`); }

  return { parks: deps.parks.length, windows: candidates.length, fetched, fetchErrors, cacheWrites, durationMs: Date.now() - start };
}
```
> Notes: CA-parks-only; scans ALL windows (no `findStaleWindows`); `proactiveScanWindow` never returns `'unsupported'` for CA so only `entry|null` is handled. `runWithConcurrency`/`CaliforniaParksProvider`/`ParkCatalogEntry` come from core; `upsertEntry`/`evictExpired`/`refreshMaterializedView`/`Db` from db. Confirm `Db` and `ParkCatalogEntry` are exported from their barrels (they are: `Db` from `@campbrain/db` client, `ParkCatalogEntry` from `@campbrain/core` catalog/types).

- [ ] **Step 3: `apps/scanner/src/main.ts`** — wire real deps

Reads the CA catalog JSON (repo checked out), creates a Neon db, sets up a debug-file sink, runs the scan, closes the db.
```ts
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDb, closeDb } from "@campbrain/db";
import type { ParkCatalogEntry } from "@campbrain/core";
import { runProactiveScan } from "./run-proactive-scan";

function loadCaParks(): ParkCatalogEntry[] {
  // apps/scanner/src/main.ts → repo root is ../../../
  const path = fileURLToPath(new URL("../../../data/catalog/california-parks.json", import.meta.url));
  const catalog = JSON.parse(readFileSync(path, "utf-8")) as { parks: ParkCatalogEntry[] };
  // Eligible: has at least one campground with at least one site (matches legacy filter).
  return catalog.parks.filter((p) => p.discoveryStatus !== "failed" && p.campgrounds.some((c) => c.sites.length > 0));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const debugDir = process.env.SCAN_DEBUG_DIR ?? join(process.cwd(), ".scan-debug");

  const db = createDb(url);
  try {
    const summary = await runProactiveScan({
      db,
      parks: loadCaParks(),
      log: (m) => console.log(m),
      onUnexpectedHtml: async (html, ctx) => {
        mkdirSync(debugDir, { recursive: true });
        const safe = `${ctx.parkPageId}-${ctx.arrivalDate}`.replace(/[^a-z0-9-]/gi, "_");
        writeFileSync(join(debugDir, `${safe}.html`), html);
        console.warn(`⚠ unexpected page: park ${ctx.parkPageId} ${ctx.arrivalDate} → ${ctx.url}`);
      },
    });
    console.log(`✅ scan complete: ${JSON.stringify(summary)}`);
  } finally {
    await closeDb(db);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```
> Confirm `createDb`/`closeDb` are exported from `@campbrain/db` (they are, per Phase 0/1b). The debug dir is `.scan-debug/` (gitignored; uploaded as a GH Actions artifact). Add `.scan-debug/` to the root `.gitignore`.

- [ ] **Step 4: `apps/scanner/test/run-proactive-scan.test.ts`** (integration, mock provider + local PG)

Inject a fake provider that returns a canned `AvailabilityWindowEntry` for a known park/window (no real network), plus the real local-PG `db` (via `createTestDb` from `@campbrain/db`'s test helper — OR construct a `createDb` against the local URL). Run `runProactiveScan` with `todayOverride` + one synthetic park, and assert: `upsertEntry` landed availability rows in Neon, the summary counts are right, and the MV refresh didn't throw. Clean up the `test-1c-scan` provider after.

Key test design points:
- The fake provider implements `generateCacheWindows` (return a single window) + `proactiveScanWindow` (return a canned entry); inject via `deps.provider` (cast as `CaliforniaParksProvider` or loosen the `provider` type to the minimal interface it uses — `Pick<CaliforniaParksProvider, "generateCacheWindows" | "proactiveScanWindow">`; prefer the `Pick` so the fake is easy to build).
- Use `deps.sleep = async () => {}` to skip real delays.
- Use the real local-PG `Db`: import `createDb` from `@campbrain/db` and point at `testDbUrl()` (export it from the db test helper or hardcode the local URL); seed a `providers` row for `california-parks` (the scan upserts parks/cgs/sites under `california-parks`, so scope cleanup carefully — OR override `PROVIDER_ID`? It's hardcoded to `california-parks`. To keep the test isolated, use a park page id like `test-1c-scan-park` so cleanup can target it by park_page_id, and delete those rows after; the provider_id stays `california-parks` but only the test park's rows are touched).

  > Because `runProactiveScan` hardcodes `PROVIDER_ID = "california-parks"`, isolate the test by using a unique `parkPageId` and cleaning up rows for that park_page_id (not the whole provider). Assert on that park only.

(If a local-PG integration test for the orchestration proves awkward, an acceptable alternative is a unit test with BOTH a fake provider AND a fake `db` (a stub object capturing `transaction`/`execute` calls) asserting `upsertEntry`/`evictExpired`/`refreshMaterializedView` were invoked the right number of times — but the local-PG version is preferred since it exercises the real write path end-to-end. Choose one; note which.)

- [ ] **Step 5: Verify** — `bun install` (registers the new workspace), then `bun --filter @campbrain/scanner test` + `bun --filter @campbrain/scanner typecheck` green. Also run the real CLI once against local PG with a SMALL slice to sanity-check live fetching is polite and works (optional, hits parks.ca.gov):
  `DATABASE_URL=postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain bun --filter @campbrain/scanner start` — but this scans ALL parks (~11 min, real fetches). For a quick check, temporarily limit `loadCaParks()` to `.slice(0, 2)` locally, confirm rows land, then revert. Document what you ran.

- [ ] **Step 6: Commit**
```bash
git add apps/scanner .gitignore
git commit -m "feat(scanner): apps/scanner proactive scan orchestration (CA parks)"
```

---

## Task 5: GitHub Actions scheduled workflow

**Files:** Create `.github/workflows/scan.yml`.

- [ ] **Step 1: Write `.github/workflows/scan.yml`**
```yaml
name: Proactive Scan
on:
  schedule:
    - cron: "0 */2 * * *"   # every 2 hours (GitHub cron is best-effort, UTC)
  workflow_dispatch: {}       # manual trigger for validation
concurrency:
  group: proactive-scan
  cancel-in-progress: false   # never run two scans at once
jobs:
  scan:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: latest }
      - run: bun install --frozen-lockfile
      - name: Run proactive scan
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: bun --filter @campbrain/scanner start
      - name: Upload parser debug snapshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: scan-debug
          path: .scan-debug/
          if-no-files-found: ignore
          retention-days: 7
```

- [ ] **Step 2: Runbook (manual, performed by the human — document in the PR/commit body, do NOT automate)**
  1. **Add the Neon connection string as a GitHub Actions secret:** repo → Settings → Secrets and variables → Actions → New repository secret → `DATABASE_URL` = the Neon `postgres://…` URL (same value used for the Worker secret + `@campbrain/db migrate`).
  2. **Cadence vs. cost:** the workflow runs every 2 h. GitHub Actions minutes are **free + unlimited for public repos**; for a **private** repo, free tier is 2,000 min/month — a ~11-min scan every 2 h ≈ 4,000 min/month, which exceeds it. If the repo is private, either make it public (recommended — it's a portfolio piece) or change the cron to `0 */6 * * *` (every 6 h ≈ 1,300 min/month). Note this in the workflow as a comment.
  3. **Validate:** after merging, trigger the workflow manually (Actions tab → Proactive Scan → Run workflow), watch the logs for `✅ scan complete: {…cacheWrites…}`, then confirm rows in Neon: `SELECT COUNT(*) FROM availability;` and `SELECT MAX(scanned_at) FROM scan_windows;` should be recent. Check the `scan-debug` artifact only if `fetchErrors`/unexpected pages were logged.
  4. **Politeness check:** confirm the run respects concurrency 5 + 500 ms delays (the scan should take several minutes, not seconds — a too-fast run means the batching delay isn't firing).

- [ ] **Step 3: Commit**
```bash
git add .github/workflows/scan.yml
git commit -m "ci(scanner): scheduled GitHub Actions proactive scan workflow"
```

---

## Task 6: Full-repo verification + scanner validation

**Files:** none (verification + final commit if anything adjusted).

- [ ] **Step 1: Confirm `apps/api` is untouched** — `git diff --stat <phase-1c-base>..HEAD -- apps/api` should be empty. The Worker stays read-only; the scanner is independent. (If anything in apps/api changed, it was a mistake — revert it.)

- [ ] **Step 2: Full-repo gates** (local Postgres up + migrated):
```bash
bun install
bun run typecheck
bun run test
```
Expected: all packages green, including the new `@campbrain/scanner` and the new db write tests. Report the per-package summary + the db/scanner test counts. (`bun run build` should also pass — the scanner has no build step, turbo skips it.)

- [ ] **Step 3: Live scanner smoke (optional but recommended)** — run the real scanner against local PG over a small park slice (temporarily `.slice(0, 3)` in `loadCaParks`, or set a `SCAN_MAX_PARKS` env if you added one), confirm: availability rows for those parks appear in Neon, `mv_available_stays` refreshes without error, and the run is polite (multi-second, batched). Revert any temporary slicing. Document the observed `cacheWrites` + that the MV refreshed.

- [ ] **Step 4: Commit (if needed)** — if Steps 1–3 required a fix:
```bash
git add -A
git commit -m "chore(scanner): phase 1c verification fixes"
```

---

## Self-Review

**Spec coverage (Phase 1c = the proactive scanner from the spec's Scanner section):**
- Proactive enqueue + per-window fetch/parse/upsert → the GitHub Actions job + `runProactiveScan` + `upsertEntry`. ✅ (Architecture differs from Cron+Queues for the documented free-tier-CPU reason; the *behavior* — fetch every window, parse, upsert — is equivalent.)
- MV refresh → `refreshMaterializedView` (guarded), called at end of each run. ✅ (Spec's "Cron B" cadence folded into the same job rather than a separate cron — simpler, and the scan + refresh are naturally sequenced.)
- Debug HTML on low-confidence parses → `onUnexpectedHtml` → GH Actions artifact (instead of R2). ✅
- Alert scan (Cron C) → **deferred to Phase 2** (explicitly scoped out). ✅
- Polite scraping (concurrency + delay, within documented cadence) → preserved (concurrency 5, 500 ms, every 2–6 h). ✅
- Rec.gov, `findStaleWindows`, `getCacheStats`, `rebuildMaterializedView` → deferred (scoped out, with reasons). ✅

**Placeholder scan:** No "TBD/TODO". `upsertEntry` is given as full drizzle code + cites the legacy for fidelity + a behavior-locking integration test; the scanner orchestration, main, core hook, MV guard, evict, and workflow are full code. Two tasks (4 Step 4, 1 Step 3) offer a primary approach + a noted acceptable alternative — both are concrete, not placeholders.

**Type/name consistency:** `runProactiveScan(deps: ScanDeps)`, `ScanSummary`, `upsertEntry(db, entry, providerId)`, `evictExpired(db, nowMs?)`, `refreshMaterializedView(db)`, the `onUnexpectedHtml(html, ctx)` shape, and the `Db`/`AvailabilityWindowEntry`/`ParkCatalogEntry`/`CaliforniaParksProvider` imports are consistent across tasks. `PROVIDER_ID = "california-parks"` is the single provider id used by both the scanner and `upsertEntry`'s caller.

**Risk notes for the executor:**
1. **`upsertEntry` (Task 1) is the highest-risk port.** It's a multi-step transaction translated from postgres.js to drizzle raw `sql`. Read `src/cache/availability-cache.ts:56-185` alongside it and lean on the integration test (insert → assert grid → re-upsert → assert range-replace) to lock behavior. The `rows(tx, …)` for the sites `RETURNING` is the load-bearing detail — site_ids must come back to map availability.
2. **`db.execute` return shape for counts/`pg_matviews`** (Tasks 1–2): neon-serverless returns a `{ rows, rowCount }` QueryResult; the `rows()` helper + the `rowCount`/`ispopulated` reads assume that. The integration tests verify it empirically — if the adapter returns a bare array, adjust the small unwrap code (same pattern Phase 1b's `rows()` already handles).
3. **GitHub Actions cron is best-effort** (5-min granularity, possible delays, and free scheduled workflows pause after ~60 days of repo inactivity). Acceptable for a portfolio; `workflow_dispatch` is always available for manual runs.
4. **Private-repo Actions minutes** (Task 5 runbook): every-2h scanning exceeds the 2,000 free min/month on private repos — go public or drop to every 6 h.
5. **`apps/scanner` reads the catalog JSON from the repo.** The catalog (parks/campgrounds/sites) is also in Neon (1b seed). The JSON is the source for *what to scan* (it has the campground enrichment `proactiveScanWindow` needs); Neon is where results land. Keep them in sync by re-running `@campbrain/db seed:catalog` when the catalog JSON changes (the scanner's `upsertEntry` also upserts parks/cgs/sites it sees, so they self-heal over time).

---

## Execution Handoff

Recommended: **subagent-driven-development** (fresh subagent per task, spec + code-quality review between tasks) — same as Phases 0/1a/1b.

After 1c lands and a scan run populates Neon, the next step is **Phase 1d** (tRPC `map` router consuming `@campbrain/db` + the Vite map page from `web/app/map` + allowlist enforcement + app title) — the live-map milestone, which then has real data behind it. Then Phase 2 (explore/saved/alerts/dashboard to parity, incl. the alert scan).
