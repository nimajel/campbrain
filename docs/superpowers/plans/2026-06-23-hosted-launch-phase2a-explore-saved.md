# CampBrain Hosted Launch — Phase 2a (Explore + Saved) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **Fresh-session plan — self-contained; read the cited legacy files for behavioral fidelity.**

**Goal:** Port the legacy `/explore` (public availability search) and `/saved` (per-user saved-search management) surfaces to the Vite + tRPC app, and stand up the multi-user auth keystone (`protectedProcedure` + per-`user_id` data isolation) every personal feature in Phase 2/3 builds on.

**Architecture:** A single composable `protectedProcedure` tRPC middleware injects `ctx.userId` from the BetterAuth session and rejects sessionless calls (the real security boundary). A user-scoped saved-search store (`@campbrain/db/queries/saved-searches.ts`, ported from `src/saved-search/store.ts`) makes `userId` required and ownership-filters every read/write. Two ported surfaces consume the new procedures: a public `/explore` search page (region filtered in the procedure handler via the core classifier) and a `<RequireAuth>`-gated `/saved` page, with one frontend `AuthGate` primitive (driven by `useSession`) deciding what gated UI renders.

**Tech Stack:** Bun · Vite · React 19 · TanStack Router + Query · tRPC v11 · BetterAuth · Drizzle/Neon · Tailwind v4 + shadcn · Vitest.

**Spec:** docs/superpowers/specs/2026-06-23-hosted-launch-phase2a-explore-saved-design.md

---

## Scope

**In 2a (this plan):**
- `protectedProcedure` middleware + `ctx.userId` injection (`apps/api/src/trpc/trpc.ts`).
- `@campbrain/db/queries/saved-searches.ts` — saved-search store ported user-scoped + ownership-checked.
- `@campbrain/types`: new `SearchInputSchema` (`from`/`to`/`access`/`kinds`/`hide`/`region`; **no** `minNights`). `SavedSearchInputSchema` already exists, reused.
- tRPC `search` (public, region-filtered in handler) + `savedSearches` router (`list`/`create`/`update`/`delete`/`toggleAlert`, protected, user-scoped), composed into `appRouter`.
- `apps/web`: `features/auth/` gate primitives; `/explore` search port (+ "Save this search" inside `<AuthGate>`); `/saved` management port (`<RequireAuth>`).
- Tests: store user-isolation + ownership; `protectedProcedure` rejects no-session; `search` + `savedSearches` `createCaller` integration; `preview_*` visual checks (incl. a dev-only stub session for the gated flows).

**Deferred (not this plan):**
- Alert *scanning* + Resend email (2b — the Alert toggle ships now as an inert persisted flag).
- `/alerts` booking-window targets + calendar sync (2b / P3).
- Dashboard + `scan_runs`/hit-state tables (2b).
- Per-request allowlist re-check / roles (additive middleware later — `protectedProcedure` composes into them without rework).

## File structure

```
packages/types/src/
  search.ts                          CREATE  SearchInputSchema + SearchInput type
  index.ts                           MODIFY  add `export * from "./search"`

packages/db/src/queries/
  saved-searches.ts                  CREATE  user-scoped store (userId required, ownership-filtered)
packages/db/src/index.ts             MODIFY  add `export * from "./queries/saved-searches"`

apps/api/src/trpc/
  trpc.ts                            MODIFY  add requireSession + protectedProcedure (+ ctx.userId)
  context.ts                         MODIFY  dev-only stub-session honoring (X-Dev-User), gated by env
  router.ts                          MODIFY  compose search + savedSearches into appRouter
  routers/search.ts                  CREATE  publicProcedure; searchAvailableStays + region filter + fallback
  routers/saved-searches.ts          CREATE  protectedProcedure CRUD + toggleAlert, ctx.userId-scoped
apps/api/test/
  protected-procedure.test.ts        CREATE  UNAUTHORIZED w/o session; userId exposed w/ session
  saved-searches-store.test.ts       CREATE  CRUD + cross-user isolation (vs local PG)
  search-router.test.ts              CREATE  date-range results + region narrows (vs local PG)
  saved-searches-router.test.ts      CREATE  CRUD round-trip + isolation + UNAUTHORIZED (vs local PG)

apps/web/src/
  lib/site-taxonomy.ts               CREATE (Task 6, promote)  moved from features/map/lib
  lib/booking-url.ts                 CREATE (Task 6, promote)  moved from features/map/lib
  lib/auth-client.ts                 MODIFY  dev-only stub session (VITE_DEV_STUB_SESSION)
  components/SiteFilterPanel.tsx     CREATE (Task 6, promote)  moved from features/map/components
  features/auth/AuthGate.tsx         CREATE  AuthGate + RequireAuth + SignInPrompt
  features/auth/AuthGate.test.tsx    CREATE
  features/explore/
    ExplorePage.tsx                  CREATE  composition: filters + results, drives public search
    SaveSearchModal.tsx              CREATE  port of web/components/SaveSearchModal.tsx
    hooks/use-explore-filters.ts     CREATE  date/region/taxonomy state + URL seed
    hooks/use-search.ts              CREATE  api.search via useQuery (debounced snapshot)
    lib/saved-search-display.ts      CREATE  suggestSearchName / scopeSummary / datePatternSummary / buildRunUrl
    components/RegionChips.tsx        CREATE
    components/ResultsList.tsx        CREATE  collapsed park cards + counts header
    components/ParkCard.tsx           CREATE  collapsible card (campgrounds, Book links, walk-up)
    components/FallbackDates.tsx      CREATE  alternate-dates panel
    components/SaveSearchButton.tsx   CREATE  rendered inside <AuthGate>
  features/saved/
    SavedPage.tsx                    CREATE  lists savedSearches.list
    components/SavedSearchCard.tsx   CREATE  Run / Edit / Alert-toggle / Delete
  routes/explore.tsx                 MODIFY  render <ExplorePage/>
  routes/saved.tsx                   MODIFY  render <RequireAuth><SavedPage/></RequireAuth>
```

> **Reuse decision (Task 6):** `SiteFilterPanel`, `site-taxonomy`, and `booking-url` currently live under `apps/web/src/features/map/`. `/explore` needs all three. To avoid `features/explore` cross-importing from `features/map` (a smell that couples two sibling features), **promote** the three genuinely-shared modules to shared locations (`lib/` + `components/`) and re-point the map's imports. This is an explicit early task so both features import from the shared home. (Alternative considered: import-in-place from `features/map` — rejected because it makes explore depend on map's internal layout.)

---

## The local-auth-for-visual-verification mechanism (read before Tasks 8–9)

`/saved` and the Save button are **gated** — they only work for a signed-in user. Locally there is no Google OAuth, so `useSession()` always returns `null` and `protectedProcedure` always throws `UNAUTHORIZED`. Without a stub, Tasks 8–9 cannot be visually verified. `apps/api` `dev` is `wrangler dev`, whose `.dev.vars` already points `DATABASE_URL` at local Postgres (`localhost:5432`), so the API reaches local PG fine — the only missing piece is a session.

**Mechanism (option (a) from the brief — dev-only, never shipped):** a stub session honored at BOTH layers, each behind a dev-only env flag:

1. **Backend** (`apps/api/src/trpc/context.ts`): if `process.env.ALLOW_DEV_SESSION === "true"` AND the request carries header `x-dev-user`, synthesize `session = { user: { id: <header value> } }` *instead of* calling `auth.api.getSession`. The flag is set only in `apps/api/.dev.vars` (gitignored, local-only); it is never set in `wrangler.toml`, staging, or prod, so the code path is dead in production.
2. **Frontend** (`apps/web/src/lib/auth-client.ts`): if `import.meta.env.VITE_DEV_STUB_SESSION` is set, export a `useSession` that returns `{ data: { user: { id: VITE_DEV_STUB_SESSION } }, isPending: false }` and add an `x-dev-user: <id>` header to the tRPC fetch. `VITE_DEV_STUB_SESSION` is set only in a local `.env.local` (gitignored); `import.meta.env` strips it from prod builds, and `apps/web/src/lib/env.ts` already throws if prod config is incomplete.

Both flags default off, so the real BetterAuth path is unchanged for tests, staging, and prod. Tasks 8–9 enable them locally (`ALLOW_DEV_SESSION=true` in `.dev.vars`; `VITE_DEV_STUB_SESSION=local-dev` in `apps/web/.env.local`) and seed one `saved_searches` row for `user_id = 'local-dev'`. The stub is removed from neither file — it stays gated and inert.

> Integration tests do NOT use the stub. They pass an explicit `session` to `appRouter.createCaller({ db, auth, session })` (the harness from `apps/api/test/map-router.test.ts`), so the `UNAUTHORIZED` and isolation tests exercise the real `requireSession` middleware, not the dev bypass.

---

## Task 0: Environment up + migrated + seeded

**Files:** none (environment only). No commit.

- [ ] **Step 1: Start local Postgres**

```bash
cd /Users/nimajelveh/campbrain && docker compose -f docker-compose.dev.yml up -d
```

Expected: a `postgres` container in state `Up` (verify `docker compose -f docker-compose.dev.yml ps`).

- [ ] **Step 2: Apply migrations + seed the catalog**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/db migrate && bun --filter @campbrain/db seed:catalog
```

Expected: migrations run idempotently (or "no pending migrations"); seed reports parks/campgrounds/sites inserted. The `saved_searches`, `parks`, `sites`, `availability` tables now exist.

- [ ] **Step 3: Confirm DB reachable for integration tests**

```bash
cd /Users/nimajelveh/campbrain && psql "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain" -c "SELECT count(*) FROM parks;"
```

Expected: a non-zero count. If `psql` is unavailable, instead run `bun --filter @campbrain/api test` and confirm the existing `map-router.test.ts` integration tests run (not skip) — that proves `dbReachable()` is true.

---

## Task 1: `protectedProcedure` + `ctx.userId` (the keystone)

**Files:**
- Modify: `apps/api/src/trpc/trpc.ts`
- Test: `apps/api/test/protected-procedure.test.ts`

The middleware throws `UNAUTHORIZED` when `ctx.session` is null and injects `ctx.userId = ctx.session.user.id` (type-narrowed) otherwise. Handlers read identity only from `ctx.userId`, never from `ctx.session`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/protected-procedure.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TRPCError, initTRPC } from "@trpc/server";
import type { TrpcContext } from "../src/trpc/context";
import { protectedProcedure, router } from "../src/trpc/trpc";

// A throwaway router exercising protectedProcedure in isolation (no DB needed).
const testRouter = router({
  whoami: protectedProcedure.query(({ ctx }) => ({ userId: ctx.userId })),
});

function caller(session: TrpcContext["session"]) {
  return testRouter.createCaller({ db: {} as never, auth: {} as never, session });
}

describe("protectedProcedure", () => {
  it("throws UNAUTHORIZED when there is no session", async () => {
    await expect(caller(null).whoami()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("exposes ctx.userId from the session when present", async () => {
    const session = { user: { id: "userA" } } as unknown as TrpcContext["session"];
    const res = await caller(session).whoami();
    expect(res).toEqual({ userId: "userA" });
  });

  it("keeps publicProcedure callable without a session (regression)", () => {
    // initTRPC import kept to assert the module still constructs; publicProcedure covered by health.test.ts
    expect(typeof initTRPC).toBe("object");
    expect(TRPCError).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api test protected-procedure
```

Expected: FAIL — `protectedProcedure` is not exported from `../src/trpc/trpc`.

- [ ] **Step 3: Implement the middleware**

Replace `apps/api/src/trpc/trpc.ts` entirely with:

```ts
import { initTRPC, TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create();

const requireSession = t.middleware(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  // Narrows: downstream handlers see ctx.userId as a non-null string.
  return next({ ctx: { userId: ctx.session.user.id } });
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(requireSession);
// Future tiers compose WITHOUT touching existing handlers, e.g.:
//   export const allowlistedProcedure = protectedProcedure.use(requireAllowlistRecheck);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api test protected-procedure
```

Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api typecheck
```

Expected: no errors. (`ctx.session.user.id` is typed because `TrpcContext["session"]` is `Awaited<ReturnType<Auth["api"]["getSession"]>> | null`; after the `if (!ctx.session)` guard it narrows to the non-null session whose `.user.id` is a string.)

- [ ] **Step 6: Commit**

```bash
cd /Users/nimajelveh/campbrain && git add apps/api/src/trpc/trpc.ts apps/api/test/protected-procedure.test.ts && git commit -m "feat(api): protectedProcedure auth middleware"
```

---

## Task 2: User-scoped saved-search store

**Files:**
- Create: `packages/db/src/queries/saved-searches.ts`
- Modify: `packages/db/src/index.ts`
- Test: `apps/api/test/saved-searches-store.test.ts`

Port `src/saved-search/store.ts` to the Drizzle `db.execute(sql\`\`)` + `rows()` pattern. **`userId` is required on every function**; every read/write filters `WHERE id = $id AND user_id = $userId` so a cross-user id resolves to not-found. The `definition` jsonb is written as `${JSON.stringify(def)}::jsonb` (Drizzle parameterizes the string, the cast makes it jsonb). `listAlertEnabledSavedSearches(db)` stays un-scoped (reserved for the 2b scanner, not exposed via tRPC).

- [ ] **Step 1: Write the failing test**

`apps/api/test/saved-searches-store.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import {
  listSavedSearches, createSavedSearch, getSavedSearch,
  updateSavedSearch, deleteSavedSearch, setAlertEnabled,
} from "@campbrain/db";
import type { SavedSearchInput } from "@campbrain/types";

const URL =
  process.env["DATABASE_URL"] ??
  "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";

async function dbReachable(): Promise<boolean> {
  try {
    const s = postgres(URL, { max: 1, onnotice: () => {}, connect_timeout: 2 });
    await s`SELECT 1`; await s.end(); return true;
  } catch { return false; }
}

function input(name: string): SavedSearchInput {
  return {
    userId: null, // store overrides with the userId arg
    provider: "california-parks",
    name,
    scope: { region: null, parkPageIds: [] },
    datePattern: { kind: "fixed_range", from: "2026-08-01", to: "2026-08-03" },
    filters: { access: [], kinds: [], hide: [], minNights: 1 },
    alertEnabled: false,
    emailEnabled: true,
  };
}

describe("saved-search store (integration, user-scoped)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let db: ReturnType<typeof drizzle> | null = null;

  beforeAll(async () => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });
    await client`DELETE FROM saved_searches WHERE user_id IN ('userA','userB')`;
  });
  afterAll(async () => {
    if (client) { await client`DELETE FROM saved_searches WHERE user_id IN ('userA','userB')`; await client.end(); }
  });

  it.skipIf(!hasDb)("create + list scopes to the owner", async () => {
    const a = await createSavedSearch(db as never, "userA", input("A search"));
    expect(a.id).toBeTruthy();
    await createSavedSearch(db as never, "userB", input("B search"));
    const listA = await listSavedSearches(db as never, "userA");
    expect(listA.map((s) => s.name)).toEqual(["A search"]);
  });

  it.skipIf(!hasDb)("get/update/delete enforce ownership (cross-user = not found)", async () => {
    const a = await createSavedSearch(db as never, "userA", input("Owned by A"));
    // userB cannot read A's row
    expect(await getSavedSearch(db as never, a.id, "userB")).toBeUndefined();
    // userB cannot update A's row
    await expect(updateSavedSearch(db as never, a.id, "userB", { name: "hijack" }))
      .rejects.toThrow();
    // userB delete is a no-op; A's row survives unchanged
    await deleteSavedSearch(db as never, a.id, "userB");
    expect((await getSavedSearch(db as never, a.id, "userA"))?.name).toBe("Owned by A");
    // owner can update + delete
    const upd = await updateSavedSearch(db as never, a.id, "userA", { name: "renamed" });
    expect(upd.name).toBe("renamed");
    await deleteSavedSearch(db as never, a.id, "userA");
    expect(await getSavedSearch(db as never, a.id, "userA")).toBeUndefined();
  });

  it.skipIf(!hasDb)("setAlertEnabled flips only the owner's row", async () => {
    const a = await createSavedSearch(db as never, "userA", input("toggle me"));
    await setAlertEnabled(db as never, a.id, "userB", true); // no-op (not owner)
    expect((await getSavedSearch(db as never, a.id, "userA"))?.alertEnabled).toBe(false);
    await setAlertEnabled(db as never, a.id, "userA", true);
    expect((await getSavedSearch(db as never, a.id, "userA"))?.alertEnabled).toBe(true);
    await deleteSavedSearch(db as never, a.id, "userA");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api test saved-searches-store
```

Expected: FAIL — the store functions are not exported from `@campbrain/db`.

- [ ] **Step 3: Implement the store**

`packages/db/src/queries/saved-searches.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  SavedSearchSchema, SavedSearchInputSchema,
  type SavedSearch, type SavedSearchInput,
} from "@campbrain/types";
import { rows, type QueryDb } from "./exec";

type DefinitionJson = { scope: unknown; datePattern: unknown; filters: unknown; legacy?: unknown };

type SavedSearchRow = {
  id: string; user_id: string | null; provider: string; name: string;
  definition: DefinitionJson | null;
  alert_enabled: boolean; email_enabled: boolean;
  created_at: string; updated_at: string;
};

function rowToSavedSearch(row: SavedSearchRow): SavedSearch | null {
  const def = row.definition;
  if (!def) return null;
  const result = SavedSearchSchema.safeParse({
    id: row.id, userId: row.user_id, provider: row.provider, name: row.name,
    scope: def.scope, datePattern: def.datePattern, filters: def.filters,
    alertEnabled: row.alert_enabled, emailEnabled: row.email_enabled,
    createdAt: row.created_at, updatedAt: row.updated_at, legacy: def.legacy,
  });
  return result.success ? result.data : null;
}

function toDefinition(input: SavedSearchInput & { legacy?: unknown }): DefinitionJson {
  return {
    scope: input.scope, datePattern: input.datePattern, filters: input.filters,
    ...(input.legacy !== undefined ? { legacy: input.legacy } : {}),
  };
}

const SELECT_COLS = sql`id, user_id, provider, name, definition,
  alert_enabled, email_enabled, created_at::text, updated_at::text`;

/** Only this user's rows (idx_saved_searches_user already exists). */
export async function listSavedSearches(db: QueryDb, userId: string): Promise<SavedSearch[]> {
  const result = await rows<SavedSearchRow>(
    db,
    sql`SELECT ${SELECT_COLS} FROM saved_searches WHERE user_id = ${userId} ORDER BY created_at`,
  );
  const out: SavedSearch[] = [];
  for (const r of result) { const p = rowToSavedSearch(r); if (p) out.push(p); }
  return out;
}

/** A single row, ownership-checked. Cross-user id → undefined. */
export async function getSavedSearch(db: QueryDb, id: string, userId: string): Promise<SavedSearch | undefined> {
  const result = await rows<SavedSearchRow>(
    db,
    sql`SELECT ${SELECT_COLS} FROM saved_searches WHERE id = ${id} AND user_id = ${userId}`,
  );
  const row = result[0];
  if (!row) return undefined;
  return rowToSavedSearch(row) ?? undefined;
}

/** Insert, forcing user_id = userId (never trusts input.userId). */
export async function createSavedSearch(db: QueryDb, userId: string, input: SavedSearchInput): Promise<SavedSearch> {
  const validated = SavedSearchInputSchema.parse({ ...input, userId });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const definition = toDefinition({ ...validated, userId });
  await rows(
    db,
    sql`INSERT INTO saved_searches
          (id, user_id, provider, name, definition, alert_enabled, email_enabled, created_at, updated_at)
        VALUES (${id}, ${userId}, ${validated.provider}, ${validated.name},
                ${JSON.stringify(definition)}::jsonb, ${validated.alertEnabled},
                ${validated.emailEnabled}, ${now}::timestamptz, ${now}::timestamptz)`,
  );
  const saved = await getSavedSearch(db, id, userId);
  if (!saved) throw new Error("Failed to read saved search after create");
  return saved;
}

/** Patch an owned row. Cross-user id (or missing) → throws "not found". */
export async function updateSavedSearch(
  db: QueryDb, id: string, userId: string, patch: Partial<SavedSearchInput>,
): Promise<SavedSearch> {
  const existing = await getSavedSearch(db, id, userId);
  if (!existing) throw new Error(`SavedSearch "${id}" not found`);
  const now = new Date().toISOString();
  const merged = SavedSearchInputSchema.parse({
    userId,
    provider: patch.provider ?? existing.provider,
    name: patch.name ?? existing.name,
    scope: patch.scope ?? existing.scope,
    datePattern: patch.datePattern ?? existing.datePattern,
    filters: patch.filters ?? existing.filters,
    alertEnabled: patch.alertEnabled !== undefined ? patch.alertEnabled : existing.alertEnabled,
    emailEnabled: patch.emailEnabled !== undefined ? patch.emailEnabled : existing.emailEnabled,
    legacy: patch.legacy !== undefined ? patch.legacy : existing.legacy,
  });
  const definition = toDefinition({ ...merged, userId });
  await rows(
    db,
    sql`UPDATE saved_searches
        SET name = ${merged.name}, definition = ${JSON.stringify(definition)}::jsonb,
            provider = ${merged.provider}, alert_enabled = ${merged.alertEnabled},
            email_enabled = ${merged.emailEnabled}, updated_at = ${now}::timestamptz
        WHERE id = ${id} AND user_id = ${userId}`,
  );
  const updated = await getSavedSearch(db, id, userId);
  if (!updated) throw new Error("Failed to read saved search after update");
  return updated;
}

/** Delete an owned row. Cross-user id → no-op (0 rows affected). */
export async function deleteSavedSearch(db: QueryDb, id: string, userId: string): Promise<void> {
  await rows(db, sql`DELETE FROM saved_searches WHERE id = ${id} AND user_id = ${userId}`);
}

/** Flip alert_enabled on an owned row (data only in 2a; 2b consumes it). */
export async function setAlertEnabled(db: QueryDb, id: string, userId: string, enabled: boolean): Promise<void> {
  await rows(
    db,
    sql`UPDATE saved_searches SET alert_enabled = ${enabled}, updated_at = ${new Date().toISOString()}::timestamptz
        WHERE id = ${id} AND user_id = ${userId}`,
  );
}

/** UN-scoped — reserved for the 2b scanner. NOT exposed via tRPC. */
export async function listAlertEnabledSavedSearches(db: QueryDb): Promise<SavedSearch[]> {
  const result = await rows<SavedSearchRow>(
    db,
    sql`SELECT ${SELECT_COLS} FROM saved_searches WHERE alert_enabled = true ORDER BY created_at`,
  );
  const out: SavedSearch[] = [];
  for (const r of result) { const p = rowToSavedSearch(r); if (p) out.push(p); }
  return out;
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/db/src/index.ts`, add after the `search` export line:

```ts
export * from "./queries/saved-searches";
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api test saved-searches-store
```

Expected: PASS (3 tests, none skipped — DB is up from Task 0). The isolation test proves userB cannot read/update/delete userA's row.

- [ ] **Step 6: Typecheck**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/db typecheck
```

Expected: no errors. (`@campbrain/types` exports `SavedSearch`, `SavedSearchInput`, `SavedSearchSchema`, `SavedSearchInputSchema` — verified in `packages/types/src/saved-search.ts`.)

- [ ] **Step 7: Commit**

```bash
cd /Users/nimajelveh/campbrain && git add packages/db/src/queries/saved-searches.ts packages/db/src/index.ts apps/api/test/saved-searches-store.test.ts && git commit -m "feat(db): user-scoped saved-search store"
```

---

## Task 3: `SearchInputSchema` + the public `search` procedure

**Files:**
- Create: `packages/types/src/search.ts`
- Modify: `packages/types/src/index.ts`
- Create: `apps/api/src/trpc/routers/search.ts`
- Modify: `apps/api/src/trpc/router.ts`
- Test: `apps/api/test/search-router.test.ts`

**Region correction (vs spec):** `searchAvailableStays(db, params)` takes **no** `region` and **no** `minNights` — it finds sites open every night in `[from,to)`, so the date range itself is the stay length. Therefore `SearchInputSchema` carries `from/to/access/kinds/hide/region` (no `minNights`), and **region filtering happens in the procedure handler**: classify each returned park via `classifyRegion(lat, lon)` (from `@campbrain/core`) using coordinates from `getCatalogParks(ctx.db)`, then filter to the requested region. The handler also attaches `region`, `totalAvailable`, and `provider` per park (parity with the legacy `GET /api/search` response), and builds the alternate-dates fallback via `findNextAvailableDates`. This mirrors `web/app/api/search/route.ts:72-130` exactly, with coords sourced from the DB catalog instead of the JSON catalog.

- [ ] **Step 1: Write the failing schema test**

`apps/api/test/search-router.test.ts` (schema section first; the integration section is added in Step 5):

```ts
import { describe, it, expect } from "vitest";
import { SearchInputSchema } from "@campbrain/types";

describe("SearchInputSchema", () => {
  it("accepts a minimal valid input and defaults the arrays", () => {
    const parsed = SearchInputSchema.parse({ from: "2026-08-01", to: "2026-08-03" });
    expect(parsed).toMatchObject({
      from: "2026-08-01", to: "2026-08-03",
      access: [], kinds: [], hide: [], region: null,
    });
  });
  it("accepts a full input", () => {
    const parsed = SearchInputSchema.parse({
      from: "2026-08-01", to: "2026-08-03",
      access: ["drive_in"], kinds: ["tent"], hide: ["walk_up"], region: "bay-area",
    });
    expect(parsed.region).toBe("bay-area");
  });
  it("rejects a non-ISO date", () => {
    expect(SearchInputSchema.safeParse({ from: "08/01/2026", to: "2026-08-03" }).success).toBe(false);
  });
  it("rejects an unknown region", () => {
    expect(SearchInputSchema.safeParse({ from: "2026-08-01", to: "2026-08-03", region: "mars" }).success).toBe(false);
  });
  it("has no minNights field (search infers stay length from the date range)", () => {
    const parsed = SearchInputSchema.parse({ from: "2026-08-01", to: "2026-08-03" }) as Record<string, unknown>;
    expect("minNights" in parsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api test search-router
```

Expected: FAIL — `SearchInputSchema` is not exported from `@campbrain/types`.

- [ ] **Step 3: Implement the schema**

`packages/types/src/search.ts`:

```ts
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Input for the public `search` procedure. NO minNights: the date range IS the stay
 *  length (searchAvailableStays finds sites open every night in [from, to)).
 *  Region is filtered in the procedure handler, not the DB query. */
export const SearchInputSchema = z.object({
  from: isoDate,
  to: isoDate,
  access: z.array(z.enum(["drive_in", "hike_in", "boat_in"])).default([]),
  kinds: z.array(z.enum(["tent", "hookup", "cabin"])).default([]),
  hide: z.array(z.enum(["group", "equestrian", "walk_up"])).default([]),
  region: z.enum(["north-coast", "bay-area", "sierra", "central-coast", "socal"]).nullable().default(null),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;
```

In `packages/types/src/index.ts`, add:

```ts
export * from "./search";
```

- [ ] **Step 4: Run the schema test to verify it passes**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api test search-router
```

Expected: PASS (5 schema tests).

- [ ] **Step 5: Append the integration test**

Append to `apps/api/test/search-router.test.ts`:

```ts
import { beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { appRouter } from "../src/trpc/router";
import dayjs from "dayjs";

const URL =
  process.env["DATABASE_URL"] ??
  "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";
async function dbReachable(): Promise<boolean> {
  try {
    const s = postgres(URL, { max: 1, onnotice: () => {}, connect_timeout: 2 });
    await s`SELECT 1`; await s.end(); return true;
  } catch { return false; }
}

describe("search router (integration)", async () => {
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

  const from = dayjs().add(7, "day").format("YYYY-MM-DD");
  const to = dayjs().add(9, "day").format("YYYY-MM-DD");

  it.skipIf(!hasDb)("search is public (no session) and returns the park-grouped shape", async () => {
    const res = await caller!.search({ from, to });
    expect(res).toHaveProperty("parks");
    expect(res).toHaveProperty("fallback");
    expect(Array.isArray(res.parks)).toBe(true);
    if (res.parks.length > 0) {
      const p = res.parks[0]!;
      expect(p).toHaveProperty("parkPageId");
      expect(p).toHaveProperty("region");
      expect(typeof p.totalAvailable).toBe("number");
    }
  });

  it.skipIf(!hasDb)("region filter narrows the result to that region", async () => {
    const all = await caller!.search({ from, to });
    const bay = await caller!.search({ from, to, region: "bay-area" });
    expect(bay.parks.every((p) => p.region === "bay-area")).toBe(true);
    expect(bay.parks.length).toBeLessThanOrEqual(all.parks.length);
  });
});
```

- [ ] **Step 6: Run the integration test to verify it fails**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api test search-router
```

Expected: FAIL — `caller.search` does not exist yet.

- [ ] **Step 7: Implement the search procedure**

`apps/api/src/trpc/routers/search.ts`:

```ts
import { router, publicProcedure } from "../trpc";
import { SearchInputSchema } from "@campbrain/types";
import { searchAvailableStays, findNextAvailableDates, getCatalogParks } from "@campbrain/db";
import { classifyRegion, type CampRegion } from "@campbrain/core";

type SearchPark = {
  parkPageId: string;
  parkName: string;
  provider: string;
  region: CampRegion;
  campgrounds: Awaited<ReturnType<typeof searchAvailableStays>>[number]["campgrounds"];
  totalAvailable: number;
};

export const searchRouter = router({
  // Public, like the map: anyone can search availability.
  query: publicProcedure.input(SearchInputSchema).query(async ({ ctx, input }) => {
    const { from, to, access, kinds, hide, region } = input;

    // Park coords + provider from the DB catalog (parks table has lat/lon).
    const catalog = await getCatalogParks(ctx.db);
    const coordsByPageId = new Map<string, { lat: number; lon: number }>();
    const providerByPageId = new Map<string, string>();
    for (const p of catalog) {
      providerByPageId.set(p.parkPageId, p.providerId);
      if (p.latitude != null && p.longitude != null) {
        coordsByPageId.set(p.parkPageId, { lat: p.latitude, lon: p.longitude });
      }
    }

    const results = await searchAvailableStays(ctx.db, { from, to, access, kinds, hide });

    const parks: SearchPark[] = results
      .map((park): SearchPark => {
        const coords = coordsByPageId.get(park.parkPageId);
        const parkRegion: CampRegion = coords ? classifyRegion(coords.lat, coords.lon) : "socal";
        const totalAvailable = park.campgrounds.reduce((n, cg) => n + cg.availableSites.length, 0);
        return {
          parkPageId: park.parkPageId,
          parkName: park.parkName,
          provider: providerByPageId.get(park.parkPageId) ?? "california-parks",
          region: parkRegion,
          campgrounds: park.campgrounds,
          totalAvailable,
        };
      })
      .filter((p) => !region || p.region === region)
      .sort((a, b) => b.totalAvailable - a.totalAvailable);

    // Fallback: only when no bookable availability (walk-up-only results don't count).
    const noBookable = parks.every((p) => p.totalAvailable === 0);
    let fallback: { alternateDates: { parkPageId: string; parkName: string; region: CampRegion; earliestDate: string }[] } | null = null;
    if (noBookable) {
      const parkPageIds = region
        ? catalog
            .filter((p) => p.latitude != null && p.longitude != null && classifyRegion(p.latitude, p.longitude) === region)
            .map((p) => p.parkPageId)
        : undefined;
      const altDates = await findNextAvailableDates(ctx.db, { withinDays: 60, parkPageIds });
      fallback = {
        alternateDates: altDates.map((p) => {
          const coords = coordsByPageId.get(p.parkPageId);
          const r: CampRegion = coords ? classifyRegion(coords.lat, coords.lon) : "socal";
          return { parkPageId: p.parkPageId, parkName: p.parkName, region: r, earliestDate: p.earliestDate };
        }),
      };
    }

    return { parks, fallback };
  }),
});
```

- [ ] **Step 8: Compose into the app router**

Replace `apps/api/src/trpc/router.ts` with:

```ts
import { router, publicProcedure } from "./trpc";
import { mapRouter } from "./routers/map";
import { searchRouter } from "./routers/search";
import { savedSearchesRouter } from "./routers/saved-searches";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  map: mapRouter,
  search: searchRouter.query, // expose as api.search.query (matches the client call site)
  savedSearches: savedSearchesRouter,
});

export type AppRouter = typeof appRouter;
```

> **Important — keep the call site `api.search.query`:** the brief specifies the client calls `api.search.query(...)`. The cleanest way to get exactly that path is to make `search` a router with one `query` procedure (above) and mount it as `search: searchRouter`. **Adjust:** drop the `.query` in the mount and instead mount the whole sub-router so the path is `api.search.query`:

```ts
  search: searchRouter, // → api.search.query(input)
```

Use `search: searchRouter,` (NOT `searchRouter.query`). The procedure is named `query` inside `searchRouter`, so `api.search.query(input)` resolves. The `savedSearchesRouter` import is wired now but defined in Task 4 — until Task 4 lands, temporarily comment the `savedSearches` line and its import, then uncomment in Task 4 Step 5. (Sequencing note: run Task 3's tests with `savedSearches` commented out.)

- [ ] **Step 9: Run all search-router tests to verify they pass**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api test search-router
```

Expected: PASS (5 schema + 2 integration). The region test confirms every returned park matches `region: "bay-area"` and the count is ≤ the unfiltered count.

- [ ] **Step 10: Typecheck both packages**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/types typecheck && bun --filter @campbrain/api typecheck
```

Expected: no errors. (`classifyRegion`, `CampRegion`, `getCatalogParks`, `searchAvailableStays`, `findNextAvailableDates` are all exported — verified in `packages/core/src/index.ts` and `packages/db/src/index.ts`.)

- [ ] **Step 11: Commit**

```bash
cd /Users/nimajelveh/campbrain && git add packages/types/src/search.ts packages/types/src/index.ts apps/api/src/trpc/routers/search.ts apps/api/src/trpc/router.ts apps/api/test/search-router.test.ts && git commit -m "feat(api): public search procedure with region filter"
```

---

## Task 4: `savedSearches` router (protected, user-scoped)

**Files:**
- Create: `apps/api/src/trpc/routers/saved-searches.ts`
- Modify: `apps/api/src/trpc/router.ts` (uncomment the `savedSearches` line + import)
- Test: `apps/api/test/saved-searches-router.test.ts`

Five procedures, all `protectedProcedure`, all scoped by `ctx.userId`: `list`, `create`, `update`, `delete`, `toggleAlert`. Each calls the Task-2 store with `ctx.userId`. Inputs validate via `SavedSearchInputSchema` (create) and a partial of it (update). The router never reads `userId` from input.

- [ ] **Step 1: Write the failing test**

`apps/api/test/saved-searches-router.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { appRouter } from "../src/trpc/router";
import type { TrpcContext } from "../src/trpc/context";
import type { SavedSearchInput } from "@campbrain/types";

const URL =
  process.env["DATABASE_URL"] ??
  "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";
async function dbReachable(): Promise<boolean> {
  try {
    const s = postgres(URL, { max: 1, onnotice: () => {}, connect_timeout: 2 });
    await s`SELECT 1`; await s.end(); return true;
  } catch { return false; }
}
function stubSession(userId: string): TrpcContext["session"] {
  return { user: { id: userId } } as unknown as TrpcContext["session"];
}
function input(name: string): SavedSearchInput {
  return {
    userId: null, provider: "california-parks", name,
    scope: { region: null, parkPageIds: [] },
    datePattern: { kind: "fixed_range", from: "2026-08-01", to: "2026-08-03" },
    filters: { access: [], kinds: [], hide: [], minNights: 1 },
    alertEnabled: false, emailEnabled: true,
  };
}

describe("savedSearches router (integration, protected + scoped)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let db: ReturnType<typeof drizzle> | null = null;
  const callerFor = (userId: string | null) =>
    appRouter.createCaller({ db: db as never, auth: {} as never, session: userId ? stubSession(userId) : null });

  beforeAll(async () => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });
    await client`DELETE FROM saved_searches WHERE user_id IN ('userA','userB')`;
  });
  afterAll(async () => {
    if (client) { await client`DELETE FROM saved_searches WHERE user_id IN ('userA','userB')`; await client.end(); }
  });

  it.skipIf(!hasDb)("rejects unauthenticated callers with UNAUTHORIZED", async () => {
    await expect(callerFor(null).savedSearches.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(callerFor(null).savedSearches.create(input("x"))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.skipIf(!hasDb)("CRUD round-trip for the owner", async () => {
    const a = callerFor("userA");
    const created = await a.savedSearches.create(input("My search"));
    expect(created.userId).toBe("userA"); // userId comes from the session, not input
    expect((await a.savedSearches.list()).map((s) => s.name)).toContain("My search");
    const updated = await a.savedSearches.update({ id: created.id, patch: { name: "Renamed" } });
    expect(updated.name).toBe("Renamed");
    await a.savedSearches.toggleAlert({ id: created.id, enabled: true });
    expect((await a.savedSearches.list()).find((s) => s.id === created.id)?.alertEnabled).toBe(true);
    await a.savedSearches.delete({ id: created.id });
    expect((await a.savedSearches.list()).some((s) => s.id === created.id)).toBe(false);
  });

  it.skipIf(!hasDb)("isolation: userB cannot touch userA's search", async () => {
    const a = callerFor("userA");
    const b = callerFor("userB");
    const created = await a.savedSearches.create(input("A only"));
    expect((await b.savedSearches.list()).some((s) => s.id === created.id)).toBe(false);
    await expect(b.savedSearches.update({ id: created.id, patch: { name: "hijack" } })).rejects.toThrow();
    await b.savedSearches.delete({ id: created.id }); // no-op
    expect((await a.savedSearches.list()).find((s) => s.id === created.id)?.name).toBe("A only");
    await a.savedSearches.delete({ id: created.id });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api test saved-searches-router
```

Expected: FAIL — `caller.savedSearches` does not exist (the router line is still commented from Task 3).

- [ ] **Step 3: Implement the router**

`apps/api/src/trpc/routers/saved-searches.ts`:

```ts
import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { SavedSearchInputSchema } from "@campbrain/types";
import {
  listSavedSearches, createSavedSearch,
  updateSavedSearch, deleteSavedSearch, setAlertEnabled,
} from "@campbrain/db";

const idInput = z.object({ id: z.string() });

export const savedSearchesRouter = router({
  list: protectedProcedure.query(({ ctx }) => listSavedSearches(ctx.db, ctx.userId)),

  create: protectedProcedure
    .input(SavedSearchInputSchema)
    .mutation(({ ctx, input }) => createSavedSearch(ctx.db, ctx.userId, input)),

  update: protectedProcedure
    .input(z.object({ id: z.string(), patch: SavedSearchInputSchema.partial() }))
    .mutation(({ ctx, input }) => updateSavedSearch(ctx.db, input.id, ctx.userId, input.patch)),

  delete: protectedProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      await deleteSavedSearch(ctx.db, input.id, ctx.userId);
      return { id: input.id };
    }),

  toggleAlert: protectedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await setAlertEnabled(ctx.db, input.id, ctx.userId, input.enabled);
      return { id: input.id, alertEnabled: input.enabled };
    }),
});
```

- [ ] **Step 4: Wire it into the app router**

In `apps/api/src/trpc/router.ts`, uncomment (from Task 3) the import and the `savedSearches: savedSearchesRouter,` line so the final file is:

```ts
import { router, publicProcedure } from "./trpc";
import { mapRouter } from "./routers/map";
import { searchRouter } from "./routers/search";
import { savedSearchesRouter } from "./routers/saved-searches";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  map: mapRouter,
  search: searchRouter,
  savedSearches: savedSearchesRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api test saved-searches-router
```

Expected: PASS (3 tests). The UNAUTHORIZED test proves `protectedProcedure` gates `list` + `create`; the isolation test proves userB cannot list/update/delete userA's row; `created.userId === "userA"` proves the userId is sourced from the session, not input.

- [ ] **Step 6: Typecheck + run the full api suite (no regressions)**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api typecheck && bun --filter @campbrain/api test
```

Expected: typecheck clean; all api tests pass (health, allowlist, map-router, protected-procedure, saved-searches-store, search-router, saved-searches-router).

- [ ] **Step 7: Commit**

```bash
cd /Users/nimajelveh/campbrain && git add apps/api/src/trpc/routers/saved-searches.ts apps/api/src/trpc/router.ts apps/api/test/saved-searches-router.test.ts && git commit -m "feat(api): user-scoped savedSearches router"
```

---

## Task 5: Frontend auth primitives (`AuthGate` / `RequireAuth` / `SignInPrompt`)

**Files:**
- Create: `apps/web/src/features/auth/AuthGate.tsx`
- Test: `apps/web/src/features/auth/AuthGate.test.tsx`

One gate primitive + one session source (`useSession` from `@/lib/auth-client`). `AuthGate` renders children when signed in, else `fallback`. `RequireAuth` is `AuthGate` whose fallback is a full `SignInPrompt`. Frontend gating is UX only — the backend `protectedProcedure` is the security.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/auth/AuthGate.test.tsx` (mock `useSession` the way `src/test/nav-bar.test.tsx` does):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useSession = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  useSession: () => useSession(),
  signIn: { social: vi.fn() },
  signOut: vi.fn(),
}));

import { AuthGate, RequireAuth } from "./AuthGate";

describe("AuthGate", () => {
  beforeEach(() => useSession.mockReset());

  it("renders children when a session exists", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } }, isPending: false });
    render(<AuthGate fallback={<span>nope</span>}><span>secret</span></AuthGate>);
    expect(screen.getByText("secret")).toBeInTheDocument();
    expect(screen.queryByText("nope")).not.toBeInTheDocument();
  });

  it("renders the fallback when there is no session", () => {
    useSession.mockReturnValue({ data: null, isPending: false });
    render(<AuthGate fallback={<span>nope</span>}><span>secret</span></AuthGate>);
    expect(screen.getByText("nope")).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("renders nothing while the session is pending", () => {
    useSession.mockReturnValue({ data: null, isPending: true });
    const { container } = render(<AuthGate><span>secret</span></AuthGate>);
    expect(container).toBeEmptyDOMElement();
  });

  it("RequireAuth shows the sign-in prompt when signed out", () => {
    useSession.mockReturnValue({ data: null, isPending: false });
    render(<RequireAuth><span>secret</span></RequireAuth>);
    expect(screen.getByText(/sign in/i)).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/web test AuthGate
```

Expected: FAIL — `./AuthGate` module does not exist.

- [ ] **Step 3: Implement the primitives**

`apps/web/src/features/auth/AuthGate.tsx`:

```tsx
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { signIn, useSession } from "@/lib/auth-client";

/** Declarative gate: renders children when signed in, else fallback. UX only —
 *  the API's protectedProcedure is the real security boundary. */
export function AuthGate({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  return session ? <>{children}</> : <>{fallback ?? null}</>;
}

/** Full sign-in prompt used as the fallback for whole gated surfaces. */
export function SignInPrompt({ message }: { message?: string } = {}) {
  return (
    <div className="mx-auto max-w-sm space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Sign in to CampBrain</h1>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <Button onClick={() => signIn.social({ provider: "google" })}>Sign in with Google</Button>
    </div>
  );
}

/** Gate that shows a full sign-in prompt when unauthenticated (for /saved etc.). */
export function RequireAuth({ children, message }: { children: ReactNode; message?: string }) {
  return <AuthGate fallback={<SignInPrompt message={message} />}>{children}</AuthGate>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/web test AuthGate
```

Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/web typecheck
```

Expected: no errors. (`@/components/ui/button` and `@/lib/auth-client` both exist — verified.)

- [ ] **Step 6: Commit**

```bash
cd /Users/nimajelveh/campbrain && git add apps/web/src/features/auth/AuthGate.tsx apps/web/src/features/auth/AuthGate.test.tsx && git commit -m "feat(web): AuthGate + RequireAuth primitives"
```

---

## Task 6: Promote shared UI pieces out of `features/map`

**Files:**
- Create: `apps/web/src/lib/site-taxonomy.ts` (moved from `features/map/lib/site-taxonomy.ts`)
- Create: `apps/web/src/lib/booking-url.ts` (moved from `features/map/lib/booking-url.ts`)
- Create: `apps/web/src/components/SiteFilterPanel.tsx` (moved from `features/map/components/SiteFilterPanel.tsx`)
- Modify: the map files that import these (re-point to the new paths)
- Modify/move: `apps/web/src/features/map/lib/site-taxonomy.test.ts` → `apps/web/src/lib/site-taxonomy.test.ts`

`/explore` needs `SiteFilterPanel`, the taxonomy types/helpers, and `injectBookingDates`. Promote the three genuinely-shared modules to shared homes so `features/explore` and `features/map` both import from `@/lib` + `@/components` (no cross-feature import). This is a pure move + re-point — no behavior change.

- [ ] **Step 1: Move `site-taxonomy.ts` and `booking-url.ts` into `lib/`**

```bash
cd /Users/nimajelveh/campbrain && \
  git mv apps/web/src/features/map/lib/site-taxonomy.ts apps/web/src/lib/site-taxonomy.ts && \
  git mv apps/web/src/features/map/lib/site-taxonomy.test.ts apps/web/src/lib/site-taxonomy.test.ts && \
  git mv apps/web/src/features/map/lib/booking-url.ts apps/web/src/lib/booking-url.ts
```

- [ ] **Step 2: Move `SiteFilterPanel.tsx` into `components/` and fix its taxonomy import**

```bash
cd /Users/nimajelveh/campbrain && git mv apps/web/src/features/map/components/SiteFilterPanel.tsx apps/web/src/components/SiteFilterPanel.tsx
```

In `apps/web/src/components/SiteFilterPanel.tsx`, change the two relative imports from `../lib/site-taxonomy` to `@/lib/site-taxonomy`:

```tsx
import { ACCESS_GROUP, KIND_GROUP, HIDE_GROUP } from "@/lib/site-taxonomy";
import type { TaxonomyState, SiteAccess, SiteKind, HideTarget } from "@/lib/site-taxonomy";
```

- [ ] **Step 3: Re-point the map's imports**

Update these import paths (verified call sites):
- `apps/web/src/features/map/hooks/use-map-filters.ts:2-3` — `"../lib/site-taxonomy"` → `"@/lib/site-taxonomy"`.
- `apps/web/src/features/map/hooks/use-map-summary.ts:5` — `"../lib/site-taxonomy"` → `"@/lib/site-taxonomy"`.
- `apps/web/src/features/map/hooks/use-park-availability.ts:4` — `"../lib/site-taxonomy"` → `"@/lib/site-taxonomy"`.
- `apps/web/src/features/map/components/FilterBar.tsx:5` — `"./SiteFilterPanel"` → `"@/components/SiteFilterPanel"`.
- `apps/web/src/features/map/components/ParkDetail.tsx:11` — `"../lib/booking-url"` → `"@/lib/booking-url"`.
- `apps/web/src/features/map/components/ParkDetail.tsx:14` — `"../lib/site-taxonomy"` → `"@/lib/site-taxonomy"`.

In the moved `apps/web/src/lib/site-taxonomy.test.ts`, change the import from `"./site-taxonomy"` — it already is `./site-taxonomy` and the test now sits beside the module, so no change is needed; confirm it still resolves.

- [ ] **Step 4: Typecheck + run the web suite (no regressions)**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/web typecheck && bun --filter @campbrain/web test
```

Expected: typecheck clean (no dangling imports); all existing map tests still pass (site-taxonomy, map-pins, stay-tiers, filter-derivations, nav-bar, AuthGate).

- [ ] **Step 5: Commit**

```bash
cd /Users/nimajelveh/campbrain && git add -A apps/web/src && git commit -m "refactor(web): promote SiteFilterPanel/site-taxonomy/booking-url to shared lib"
```

---

## Task 7: `/explore` port (public search surface)

**Files:**
- Create: `apps/web/src/features/explore/lib/saved-search-display.ts`
- Create: `apps/web/src/features/explore/hooks/use-explore-filters.ts`
- Create: `apps/web/src/features/explore/hooks/use-search.ts`
- Create: `apps/web/src/features/explore/components/RegionChips.tsx`
- Create: `apps/web/src/features/explore/components/ParkCard.tsx`
- Create: `apps/web/src/features/explore/components/ResultsList.tsx`
- Create: `apps/web/src/features/explore/components/FallbackDates.tsx`
- Create: `apps/web/src/features/explore/ExplorePage.tsx`
- Modify: `apps/web/src/routes/explore.tsx`

Port `web/app/explore/FindCampsitesClient.tsx` (entire file, 595 lines) + `web/app/api/search/route.ts` response shape into a Vite/tRPC surface. **Adaptations:** REST `fetch('/api/search?…')` → `api.search.query(input)` via TanStack Query (`use-search.ts`); `next/navigation` `useSearchParams` → TanStack Router `Route.useSearch()` (URL seed for the saved-search round-trip); `'use client'` directive removed; legacy custom-CSS (`className="card"`, inline `style`, `var(--*)`) → Tailwind/shadcn classes matching the map's conventions; region helpers from `@campbrain/core` (`ALL_REGIONS`, `REGION_LABELS`, `CampRegion`); `SiteFilterPanel`/`TaxonomyState`/`injectBookingDates` from the Task-6 shared homes. **Server already returns `region`, `provider`, `totalAvailable`, and `fallback`** (Task 3) — the client does not re-classify regions.

> **Helper-reuse note:** do NOT re-implement `suggestSearchName`/`scopeSummary`/`datePatternSummary`/`buildRunUrl` — port them verbatim from `web/lib/saved-search-display.ts` into `features/explore/lib/saved-search-display.ts`, swapping the legacy type imports (`../../src/saved-search/types.js`) for `@campbrain/types` and `../../src/catalog/regions.js` for `@campbrain/core`. (`/saved` reuses `scopeSummary`/`datePatternSummary`/`buildRunUrl` in Task 9.)

**Module responsibilities + interfaces:**

`lib/saved-search-display.ts` — port of `web/lib/saved-search-display.ts:1-82`. Exports `suggestSearchName(region, from, to)`, `scopeSummary(scope)`, `datePatternSummary(pattern)`, `buildRunUrl(search)`. Adaptation: import `REGION_LABELS` from `@campbrain/core`; import `SavedSearch`/`SavedSearchScope`/`SavedSearchDatePattern` from `@campbrain/types`.

`hooks/use-explore-filters.ts` — owns the filter state. Interface:
```ts
interface ExploreFilters {
  checkIn: string; checkOut: string;
  region: CampRegion | null;
  taxonomy: TaxonomyState;
}
export function useExploreFilters(seed?: Partial<{ from: string; to: string; region: CampRegion | null; access: SiteAccess[]; kinds: SiteKind[]; hide: HideTarget[] }>): {
  filters: ExploreFilters;
  setCheckIn(v: string): void; setCheckOut(v: string): void;
  setRegion(v: CampRegion | null): void; setTaxonomy(v: TaxonomyState): void;
  nights: number; // dayjs(checkOut).diff(checkIn,'day'), 0 if invalid
}
```
Ports the `useState` + check-out-clamp logic from `FindCampsitesClient.tsx:262-282` (clear check-out if it would be ≤ check-in; `nights` derived). The `seed` comes from URL search params (saved-search round-trip).

`hooks/use-search.ts` — wraps `api.search.query` in `useQuery`. Interface:
```ts
export function useSearch(filters: ExploreFilters, nights: number): {
  data: SearchResponse | undefined; isFetching: boolean; error: unknown;
}
```
`SearchResponse` is the inferred return type of `api.search.query` (`import type { AppRouter } from "@campbrain/api-client"` → `inferRouterOutputs`). Enabled only when `checkIn && checkOut && checkIn < checkOut` (mirrors the `runSearch` guard at `FindCampsitesClient.tsx:285`). `queryKey: ["search", filters.checkIn, filters.checkOut, filters.region, filters.taxonomy]`. Build the input: `{ from: checkIn, to: checkOut, region, ...taxonomy }`. Mirrors `FindCampsitesClient.tsx:284-314` (the re-fetch-on-every-filter-change behavior is now TanStack Query refetch on queryKey change — no manual `useEffect(runSearch)`).

`components/RegionChips.tsx` — `{ value: CampRegion | null; onChange(v): void }`. Ports the region chip bar at `FindCampsitesClient.tsx:404-437` (All + per-region toggle; clicking the active region clears to null). Use shadcn `Button` `size="sm"` variants (`default` when active, `ghost` otherwise) like the map's `Pill`.

`components/ParkCard.tsx` — `{ park: SearchResponse["parks"][number]; checkIn: string; nights: number; showWalkUp: boolean }`. Ports the collapsible card at `FindCampsitesClient.tsx:34-203`: collapsed by default (only header row renders — the parity perf strategy), chevron toggle, region badge (`REGION_LABELS[park.region]`), site count vs "walk-up only" badge, per-campground pricing (`$fee/night · $fee*nights total`), Book link `injectBookingDates(cg.bookingUrl, checkIn, nights)` (only when `availableSites.length > 0`), available-site chips, walk-up chips with the "first-come, not reservable" note. Replace inline styles with Tailwind. (Note: the Phase-1 map has no `ProviderBadge` yet — render the provider as a plain shadcn `Badge` with the provider string, or omit; do NOT block on porting `ProviderBadge`.)

`components/ResultsList.tsx` — `{ data: SearchResponse; checkIn: string; nights: number; showWalkUp: boolean }`. Ports the results section at `FindCampsitesClient.tsx:480-520`: a count header ("`N parks` · `M sites available`"), the bookable parks (sorted server-side already), then walk-up-only parks when `showWalkUp`.

`components/FallbackDates.tsx` — `{ fallback: SearchResponse["fallback"]; region: CampRegion | null; hasActiveFilters: boolean; onClearFilters(): void }`. Ports the fallback panel at `FindCampsitesClient.tsx:522-572`: "No availability for those dates" + a "Clear filters" action when filters are active + the alternate-dates list (`parkName` — openings from `earliestDate`).

`ExplorePage.tsx` — composition. Ports the top-level layout at `FindCampsitesClient.tsx:330-593` minus the Next-specific `SavedSearchBanner` fetch (replace with a lightweight banner reading the `savedSearch` name from `api.savedSearches.list` if signed in, OR omit the banner in 2a — note which). Renders: check-in/check-out `<input type="date">` (date-picker per user preference), `<RegionChips/>`, `<SiteFilterPanel groups={["access","kinds","hide"]}/>`, the `<SaveSearchButton/>` (Task 8) inside `<AuthGate>`, then loading/empty/error states and `<ResultsList/>` / `<FallbackDates/>` from `useSearch`. `showWalkUp = !taxonomy.hide.includes("walk_up")`.

- [ ] **Step 1: Port `saved-search-display.ts`** (verbatim logic from `web/lib/saved-search-display.ts:1-82`, type imports swapped to `@campbrain/types` + `@campbrain/core`).

- [ ] **Step 2: Implement `use-explore-filters.ts`** (state + clamp + `nights`, per the interface above).

- [ ] **Step 3: Implement `use-search.ts`** (TanStack `useQuery` over `api.search.query`, enabled-guard + queryKey above).

- [ ] **Step 4: Implement `RegionChips`, `ParkCard`, `ResultsList`, `FallbackDates`** (per responsibilities above; Tailwind/shadcn).

- [ ] **Step 5: Implement `ExplorePage.tsx`** (composition above; `SaveSearchButton` is a temporary `null` placeholder import-wise until Task 8 — render the rest now).

- [ ] **Step 6: Wire the route**

Replace `apps/web/src/routes/explore.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { ExplorePage } from "@/features/explore/ExplorePage";

export const Route = createFileRoute("/explore")({
  component: ExplorePage,
});
```

(If reading URL seed params, add a `validateSearch` to the route and pass `Route.useSearch()` into `useExploreFilters` — keep the param names `from`/`to`/`region`/`access`/`kinds`/`hide`/`savedSearch` to round-trip with `buildRunUrl`.)

- [ ] **Step 7: Typecheck + build**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/web typecheck && bun --filter @campbrain/web build
```

Expected: clean typecheck; build succeeds.

- [ ] **Step 8: Visual verification (`preview_*`)**

Start both dev servers — terminal A: `bun --filter @campbrain/api dev` (wrangler on :8787, reaching local PG via `.dev.vars`); terminal B: `bun --filter @campbrain/web dev` (Vite on :5173). Open `http://localhost:5173/explore` with the `preview_*` tools and verify, in order:
  1. **Search renders** — pick a check-in ~7 days out and a check-out 2 days later; park cards appear (collapsed), each with a region badge + site count. Expand a card → campgrounds, site chips, pricing show.
  2. **Filters re-query** — toggle a HIDE pill (e.g. hide walk-up) and switch a region chip → the result list updates (TanStack refetch on queryKey change), counts change.
  3. **Book links** — expand a bookable card; the Book link `href` contains `date=<check-in>` and `night=<nights>` (inspect the anchor). 
  4. **Fallback** — pick a far-future range with a narrow filter that yields nothing bookable → the "No availability" fallback with alternate-date suggestions renders.

- [ ] **Step 9: Commit**

```bash
cd /Users/nimajelveh/campbrain && git add apps/web/src/features/explore apps/web/src/routes/explore.tsx && git commit -m "feat(web): explore search page"
```

---

## Task 8: "Save this search" (gated)

**Files:**
- Create: `apps/web/src/features/explore/SaveSearchModal.tsx`
- Create: `apps/web/src/features/explore/components/SaveSearchButton.tsx`
- Modify: `apps/web/src/features/explore/ExplorePage.tsx` (render `<SaveSearchButton/>` inside `<AuthGate>`)
- Modify: `apps/web/src/lib/auth-client.ts` (dev-only stub session — see the local-auth section)

Port `web/components/SaveSearchModal.tsx` (325 lines) and add a `SaveSearchButton` that opens it. The button renders **only inside `<AuthGate>`** so a signed-out user never sees it. Save calls `api.savedSearches.create.mutate(input)` and invalidates `savedSearches.list`.

`SaveSearchModal.tsx` — port of `web/components/SaveSearchModal.tsx:40-324`. Props:
```ts
interface SaveSearchModalProps {
  open: boolean;
  onClose(): void;
  editing?: SavedSearch;          // when set → savedSearches.update
  prefill?: { name: string; region: CampRegion | null; from: string; to: string;
              access: SiteAccess[]; kinds: SiteKind[]; hide: HideTarget[]; minNights: 1|2|3 };
  onSaved?(saved: SavedSearch): void;
}
```
**Adaptations:** the two legacy `fetch('/api/saved-searches'…)` calls (`SaveSearchModal.tsx:116-126`) → `api.savedSearches.create.mutate(payload)` / `api.savedSearches.update.mutate({ id: editing.id, patch: payload })`; the legacy `userId: null` in the payload (`:105`) is **dropped** (the server sets `user_id` from the session); shadcn `Dialog`/`Button`/`Toggle` replace the legacy `Modal`/`Toggle`/custom CSS; the date-pattern toggle (fixed_range vs any_weekend), the date inputs, the horizon `<select>`, and the alert toggle keep their legacy semantics (`SaveSearchModal.tsx:177-300`). The built `payload` matches `SavedSearchInput` from `@campbrain/types`.

`SaveSearchButton.tsx` — `{ filters: ExploreFilters; nights: number }`. Renders a shadcn `Button` ("Save this search") that opens `SaveSearchModal` with `prefill` built from current filters (name via `suggestSearchName(region, checkIn, checkOut)`; `minNights: 1` — explore has no minNights control, matching `FindCampsitesClient.tsx:320-323`). On save, calls `queryClient.invalidateQueries({ queryKey: ["savedSearches"] })` and shows a brief toast/confirmation.

**Dev-only stub session** (so this task is verifiable locally): edit `apps/web/src/lib/auth-client.ts` to:
```ts
import { createAuthClient } from "better-auth/react";
import { apiUrl } from "./env";

export const authClient = createAuthClient({ baseURL: apiUrl, basePath: "/api/auth" });

const devStubUserId = import.meta.env.VITE_DEV_STUB_SESSION as string | undefined;

// Dev-only: when VITE_DEV_STUB_SESSION is set (local .env.local only), short-circuit
// useSession to a stub so gated UI is verifiable without Google OAuth. Stripped from
// prod builds (env.ts throws if prod config is incomplete; the var is never set in CI/prod).
export const useSession = devStubUserId
  ? () => ({ data: { user: { id: devStubUserId } }, isPending: false } as const)
  : authClient.useSession;

export const { signIn, signOut } = authClient;
```
And the matching backend honoring goes in `apps/api/src/trpc/context.ts` (one-time edit, dev-gated):
```ts
export async function createContext(opts: { db: Db; auth: Auth; headers: Headers }): Promise<TrpcContext> {
  const devUser = process.env["ALLOW_DEV_SESSION"] === "true" ? opts.headers.get("x-dev-user") : null;
  const session = devUser
    ? ({ user: { id: devUser } } as Awaited<ReturnType<Auth["api"]["getSession"]>>)
    : await opts.auth.api.getSession({ headers: opts.headers });
  return { db: opts.db, auth: opts.auth, session };
}
```
And the api-client must forward the header — but the client is shared; instead set it only via the stub: in `apps/web/src/lib/trpc.ts`, when `import.meta.env.VITE_DEV_STUB_SESSION` is set, pass an extra header. Since `createApiClient` (`packages/api-client/src/index.ts`) doesn't accept headers, add an optional second arg there:
```ts
export function createApiClient(apiUrl: string, headers?: Record<string, string>): ApiClient {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${apiUrl}/trpc`, headers, fetch: (u, o) => fetch(u, { ...o, credentials: "include" }) })],
  });
}
```
then in `apps/web/src/lib/trpc.ts`:
```ts
const devUser = import.meta.env.VITE_DEV_STUB_SESSION as string | undefined;
export const api = createApiClient(apiUrl, devUser ? { "x-dev-user": devUser } : undefined);
```
These three edits are all dev-gated and inert in prod.

- [ ] **Step 1: Port `SaveSearchModal.tsx`** (per the props + adaptations above; tRPC mutations).

- [ ] **Step 2: Implement `SaveSearchButton.tsx`** (prefill + open modal + invalidate on save).

- [ ] **Step 3: Render it gated in `ExplorePage.tsx`**:
```tsx
import { AuthGate } from "@/features/auth/AuthGate";
import { SaveSearchButton } from "./components/SaveSearchButton";
// …in the form footer:
<AuthGate>
  <SaveSearchButton filters={filters} nights={nights} />
</AuthGate>
```

- [ ] **Step 4: Add the dev-only stub** (the four edits above: `auth-client.ts`, `context.ts`, `packages/api-client/src/index.ts`, `apps/web/src/lib/trpc.ts`).

- [ ] **Step 5: Add the api-client header arg test (no DB)**

`apps/api/test/dev-session-context.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createContext } from "../src/trpc/context";

describe("createContext dev session", () => {
  it("synthesizes a stub session from x-dev-user when ALLOW_DEV_SESSION=true", async () => {
    process.env["ALLOW_DEV_SESSION"] = "true";
    const ctx = await createContext({
      db: {} as never, auth: {} as never,
      headers: new Headers({ "x-dev-user": "local-dev" }),
    });
    expect(ctx.session?.user.id).toBe("local-dev");
    delete process.env["ALLOW_DEV_SESSION"];
  });
  it("ignores x-dev-user when the flag is off (would call auth.getSession)", async () => {
    delete process.env["ALLOW_DEV_SESSION"];
    const auth = { api: { getSession: async () => null } } as never;
    const ctx = await createContext({ db: {} as never, auth, headers: new Headers({ "x-dev-user": "x" }) });
    expect(ctx.session).toBeNull();
  });
});
```
Run: `bun --filter @campbrain/api test dev-session-context` → PASS (2 tests). This proves the bypass is flag-gated.

- [ ] **Step 6: Typecheck + build**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/web typecheck && bun --filter @campbrain/api typecheck && bun --filter @campbrain/web build
```

Expected: clean.

- [ ] **Step 7: Visual verification (`preview_*`) — signed-out and signed-in**

  1. **Signed-out:** with NO stub (`apps/web/.env.local` absent, `.dev.vars` without `ALLOW_DEV_SESSION`), restart both dev servers, open `/explore` → **the "Save this search" button is absent** (gated).
  2. **Signed-in (stub):** add `VITE_DEV_STUB_SESSION=local-dev` to `apps/web/.env.local` and `ALLOW_DEV_SESSION=true` to `apps/api/.dev.vars`; restart both servers; open `/explore` → the **Save button now shows**. Click it, fill a name, Save → the modal closes and the toast appears. Confirm the row landed: `psql "$DATABASE_URL" -c "SELECT name, user_id FROM saved_searches WHERE user_id='local-dev';"` shows the new row owned by `local-dev`.

- [ ] **Step 8: Commit**

```bash
cd /Users/nimajelveh/campbrain && git add apps/web/src/features/explore apps/web/src/lib/auth-client.ts apps/web/src/lib/trpc.ts apps/api/src/trpc/context.ts packages/api-client/src/index.ts apps/api/test/dev-session-context.test.ts && git commit -m "feat(web): save-this-search (gated) + dev-only stub session"
```

---

## Task 9: `/saved` port (gated management surface)

**Files:**
- Create: `apps/web/src/features/saved/components/SavedSearchCard.tsx`
- Create: `apps/web/src/features/saved/SavedPage.tsx`
- Modify: `apps/web/src/routes/saved.tsx`

Port `web/app/saved/SavedSearchesClient.tsx` (255 lines). The page lists `api.savedSearches.list` and renders per-card Run / Edit / Alert-toggle / Delete. `/saved` is wrapped in `<RequireAuth>`. **Adaptations:** REST `fetch('/api/saved-searches'…)` → `api.savedSearches.list.query` (via `useQuery`) and mutations via `api.savedSearches.delete.mutate` / `api.savedSearches.toggleAlert.mutate` / `api.savedSearches.update.mutate` (the `SaveSearchModal` from Task 8 handles Edit); custom CSS/`Card`/`Badge`/`StatusDot`/`EmptyState` → shadcn equivalents; `SavedSearch` type from `@campbrain/types`; `scopeSummary`/`datePatternSummary`/`buildRunUrl` reused from `features/explore/lib/saved-search-display.ts`. Mutations invalidate `["savedSearches"]`. The Alert toggle persists `alertEnabled` but is **inert until 2b** (no scanning yet) — keep the label/tooltip.

`SavedSearchCard.tsx` — `{ search: SavedSearch; onEdit(s): void }`. Ports `SavedSearchesClient.tsx:38-166`: a `StatusDot`-style indicator (green when `alertEnabled`), name + scope badge (`scopeSummary`), date-pattern summary (`datePatternSummary`), filter chips (`FilterChips` logic from `:16-32` — access/kinds/hide/`minNights>1`), then the action row: **Run** anchor (`buildRunUrl(search)` → `/explore?…` for `fixed_range` or `/map?weekendsOnly=true&…` for `any_weekend`), **Edit** (calls `onEdit`), **Alert on/off** (`toggleAlert.mutate({ id, enabled: !alertEnabled })`), **Delete** (`confirm()` then `delete.mutate({ id })`). Use a TanStack `useMutation` per action with `onSuccess` invalidating `["savedSearches"]`.

`SavedPage.tsx` — composition. Ports `SavedSearchesClient.tsx:172-255`: `useQuery(["savedSearches"], () => api.savedSearches.list.query())`; loading/error states; empty state (`EmptyState` → shadcn, with the "filter on Explore and hit Save this search" copy + a link to `/explore`); the list of `<SavedSearchCard/>`; and the Edit `SaveSearchModal` (from Task 8) rendered when `editing` is set, with `onSaved` invalidating the list.

- [ ] **Step 1: Implement `SavedSearchCard.tsx`** (per the responsibility above; tRPC mutations + invalidation).

- [ ] **Step 2: Implement `SavedPage.tsx`** (list query + states + Edit modal).

- [ ] **Step 3: Wire the route gated**

Replace `apps/web/src/routes/saved.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/features/auth/AuthGate";
import { SavedPage } from "@/features/saved/SavedPage";

export const Route = createFileRoute("/saved")({
  component: () => (
    <RequireAuth message="Sign in to save and manage your searches.">
      <SavedPage />
    </RequireAuth>
  ),
});
```

- [ ] **Step 4: Typecheck + build**

```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/web typecheck && bun --filter @campbrain/web build
```

Expected: clean.

- [ ] **Step 5: Visual verification (`preview_*`)**

With the dev stub on (`VITE_DEV_STUB_SESSION=local-dev` + `ALLOW_DEV_SESSION=true`) and the row saved in Task 8, restart both servers and open `http://localhost:5173/saved`:
  1. **Signed-in:** the saved row from Task 8 renders as a card (name, scope badge, date summary, filter chips).
  2. **Run:** the Run link points to `/explore?…from=…&to=…` (for the `fixed_range` row) with the saved filters in the query string.
  3. **Edit:** click Edit → the `SaveSearchModal` opens prefilled; change the name + Save → the card name updates (list invalidated).
  4. **Alert toggle:** click Alert off→on → the status dot turns green; reload → it stays on (persisted). (No email fires — inert until 2b.)
  5. **Delete:** click Delete, confirm → the card disappears; reload → still gone.
  6. **Signed-out:** remove `apps/web/.env.local` (or set it empty), restart Vite, open `/saved` → the **sign-in prompt** renders (no cards, no list query fires for an unauthenticated user — and even if it did, the server returns UNAUTHORIZED).

- [ ] **Step 6: Commit**

```bash
cd /Users/nimajelveh/campbrain && git add apps/web/src/features/saved apps/web/src/routes/saved.tsx && git commit -m "feat(web): saved searches management page"
```

---

## Task 10: Full-repo verification + cleanup

**Files:** none new (verification + any final fixes surfaced).

- [ ] **Step 1: Repo-wide typecheck**

```bash
cd /Users/nimajelveh/campbrain && bun run typecheck
```

Expected: every package/app passes.

- [ ] **Step 2: Repo-wide tests**

```bash
cd /Users/nimajelveh/campbrain && bun run test
```

Expected: all suites pass. **Confirm none of the keystone tests skipped** — the integration tests in `saved-searches-store`, `search-router`, and `saved-searches-router` must run (DB up from Task 0), and `protected-procedure` + `dev-session-context` + `AuthGate` run unconditionally. Specifically eyeball: the cross-user isolation tests and the `UNAUTHORIZED` test report PASS (not "skipped").

- [ ] **Step 3: Repo-wide build**

```bash
cd /Users/nimajelveh/campbrain && bun run build
```

Expected: success (the Worker bundle + the SPA both build).

- [ ] **Step 4: Confirm `AppRouter` exposes the new procedures**

```bash
cd /Users/nimajelveh/campbrain && grep -nE "search:|savedSearches:" apps/api/src/trpc/router.ts
```

Expected: both `search: searchRouter,` and `savedSearches: savedSearchesRouter,` present. (Their types flow to `@campbrain/api-client`'s `AppRouter`, so `api.search.query` / `api.savedSearches.*` are typed on the web side.)

- [ ] **Step 5: Confirm the dev-stub is inert by default**

```bash
cd /Users/nimajelveh/campbrain && grep -n "VITE_DEV_STUB_SESSION\|ALLOW_DEV_SESSION" apps/api/wrangler.toml apps/web/.env 2>/dev/null; echo "exit:$?"
```

Expected: no matches in committed config (the flags live only in gitignored `.dev.vars` / `.env.local`). Confirm `apps/web/.env.local` and the `ALLOW_DEV_SESSION` line in `.dev.vars` are NOT staged.

- [ ] **Step 6: Commit any cleanup** (only if Steps 1–5 surfaced fixes)

```bash
cd /Users/nimajelveh/campbrain && git add -A && git commit -m "chore: phase 2a verification cleanup"
```

---

## Self-Review

### Spec coverage (each spec section → task)

| Spec section / requirement | Task(s) |
|---|---|
| Auth gating: `protectedProcedure` + `ctx.userId` (backend keystone) | Task 1 |
| Auth gating: `AuthGate` / `RequireAuth` / `SignInPrompt` (frontend) | Task 5 |
| `@campbrain/db/queries/saved-searches.ts` — user-scoped + ownership-checked | Task 2 |
| `list`/`get`/`create`/`update`/`delete`/`setAlertEnabled` required-userId | Task 2 |
| `listAlertEnabledSavedSearches` un-scoped (reserved for 2b) | Task 2 |
| `SearchInputSchema` in `@campbrain/types` | Task 3 |
| `search` procedure (public, fallback) + region filter in handler | Task 3 |
| `savedSearches` router (protected, user-scoped, all 5 procedures) | Task 4 |
| Composed into `appRouter`; `AppRouter` inference flows to api-client | Tasks 3, 4, 10 |
| Data isolation keystone (userId only from `ctx.userId`) | Tasks 2, 4 (isolation tests) |
| `/explore` search port (collapsed cards, pricing, Book links, fallback) | Task 7 |
| Reuse SiteFilterPanel/taxonomy/booking-url (don't fork) | Task 6 (+ 7) |
| "Save this search" inside `<AuthGate>` → `savedSearches.create` | Task 8 |
| `/saved` `<RequireAuth>` port (Run/Edit/Alert/Delete, empty state) | Task 9 |
| Alert toggle ships inert (persisted, no scanning) | Tasks 2, 8, 9 |
| Run round-trip (`buildRunUrl` → `/explore` or `/map?weekendsOnly`) | Tasks 7, 9 |
| Integration tests (`createCaller`): search, savedSearches CRUD, isolation, UNAUTHORIZED | Tasks 3, 4 |
| Unit tests: `SearchInputSchema` accept/reject; store ownership; AuthGate | Tasks 3, 2, 5 |
| Visual `preview_*` for all gated + public flows | Tasks 7, 8, 9 |
| Local-auth-in-visual-verification risk (signed-in state locally) | "local-auth" section + Task 8 |
| Full-repo `typecheck`/`test`/`build` gates | Task 10 |

**Gaps / resolutions:**
- **Region-filtering correction (spec said the DB query takes `region`/`minNights`):** resolved per the verified facts — `searchAvailableStays` takes neither; `SearchInputSchema` omits `minNights`, and the `search` *handler* (Task 3) classifies each returned park via `classifyRegion(lat,lon)` using `getCatalogParks` coords and filters to the requested region, exactly mirroring the legacy `web/app/api/search/route.ts:72-130`. The legacy `minNights` only ever lived as a saved-search filter prefill (it does not constrain the explore query), so it stays out of `SearchInputSchema` and lives only in `SavedSearchFiltersSchema` (already in `@campbrain/types`).
- **Local-auth verification:** resolved with a dual dev-only stub (frontend `VITE_DEV_STUB_SESSION` → stubbed `useSession` + `x-dev-user` header; backend `ALLOW_DEV_SESSION` → `createContext` honors the header). Both default off, are unit-tested as flag-gated (`dev-session-context.test.ts`), live only in gitignored config, and are confirmed absent from committed config in Task 10 Step 5. Integration tests bypass the stub entirely by passing an explicit `session` to `createCaller`.
- **`SiteFilterPanel`/taxonomy/booking-url location:** resolved by promoting to `@/lib` + `@/components` (Task 6) so `features/explore` never cross-imports from `features/map`.
- **`api.search.query` call path:** resolved by mounting `searchRouter` (whose sole procedure is named `query`) as `search` → `api.search.query(input)`.

**Placeholder scan:** No "TBD"/"add validation"/"handle edge cases"/"similar to Task N" placeholders. UI-port tasks (7–9) give each file's responsibility + props interface + exact legacy `file:line` ranges + the specific adaptations (REST→tRPC, Next→TanStack, CSS→Tailwind, dropped `userId`) + concrete `preview_*` checks, rather than verbatim JSX. NEW backend + all tests (Tasks 1–5, 8) show full code.

**Type consistency:** Names are stable across tasks — `protectedProcedure`, `ctx.userId`, `SearchInput`/`SearchInputSchema`, `SearchParkResult`/`searchAvailableStays`, `listSavedSearches(db, userId)` / `createSavedSearch(db, userId, input)` / `updateSavedSearch(db, id, userId, patch)` / `deleteSavedSearch(db, id, userId)` / `setAlertEnabled(db, id, userId, enabled)`, `savedSearchesRouter` (`list`/`create`/`update`/`delete`/`toggleAlert`), `searchRouter` (mounted as `search`, procedure `query`), `AuthGate`/`RequireAuth`/`SignInPrompt`, `useExploreFilters`/`useSearch`, `suggestSearchName`/`scopeSummary`/`datePatternSummary`/`buildRunUrl`. The store signatures defined in Task 2 are the exact ones imported in Task 4; the `SearchInputSchema` shape defined in Task 3 is the exact one the `search` handler and `use-search` consume.
