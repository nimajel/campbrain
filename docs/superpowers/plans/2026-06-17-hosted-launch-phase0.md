# CampBrain Hosted Launch — Phase 0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Bun/Turborepo monorepo, the Drizzle+Neon schema, a Hono Worker API with BetterAuth Google sign-in behind an email allowlist, and a Vite+shadcn web shell — deployed to a Cloudflare staging URL with CI green.

**Architecture:** Two Cloudflare apps (`apps/web` Vite SPA on Pages, `apps/api` Hono Worker) over a shared Neon Postgres reached via Drizzle. Domain/db logic lives in `packages/*`. Phase 0 ships an *authed empty shell* — no map/scanner yet (that is Phase 1). The deliverable is demonstrable: a deployed URL where an allowlisted Google account signs in and a non-allowlisted one is bounced to a request-access screen.

**Tech Stack:** Bun · Turborepo · TypeScript (strict) · Drizzle + Neon (`neon-serverless` at runtime, `postgres-js` for migrations) · Hono · tRPC · BetterAuth (Google) · Vite + React + Tailwind + shadcn/ui + TanStack Router · Vitest · Wrangler · Sentry · PostHog.

**Spec:** `docs/superpowers/specs/2026-06-17-hosted-launch-design.md` (Phase 0 section).

---

## Setup (before Task 1)

This plan runs on the `hosted-launch` branch. If executing in isolation, create a worktree first with the `superpowers:using-git-worktrees` skill. Confirm Docker is available (`docker --version`) and Bun is installed (`bun --version`; install via `curl -fsSL https://bun.sh/install | bash` if missing).

---

## File Structure

```
package.json                     root workspace + scripts (Bun workspaces)
turbo.json                       Turborepo pipeline
tsconfig.base.json               shared strict TS settings
bunfig.toml                      Bun config
.github/workflows/ci.yml         typecheck + test + build on PRs into hosted-launch
docker-compose.dev.yml           local Postgres for dev/migrations

packages/
  config/
    package.json
    src/env.ts                   zod env schemas + parse helpers (server + web)
    src/index.ts
    test/env.test.ts
  db/
    package.json
    drizzle.config.ts            drizzle-kit config (postgres-js)
    src/schema.ts                cache tables + saved_searches + access_allowlist
    src/auth-schema.ts           BetterAuth tables (generated, committed)
    src/client.ts                createDb() — neon-serverless (Worker runtime)
    src/mv.ts                    MV creation SQL + refreshAvailableStays()
    src/migrate.ts               run drizzle migrations + create MV (postgres-js)
    src/index.ts
    migrations/                  drizzle-kit output
    test/schema.test.ts          applies migrations to local PG, asserts tables/MV
  types/
    package.json
    src/index.ts                 shared DTO/zod placeholders (grows in later phases)
  api-client/
    package.json
    src/index.ts                 typed tRPC client factory

apps/
  api/
    package.json
    wrangler.toml
    src/index.ts                 Hono app: /health, /api/auth/*, /trpc/*
    src/trpc/context.ts          tRPC context (db, session)
    src/trpc/router.ts           appRouter + AppRouter type
    src/auth.ts                  BetterAuth instance (Drizzle adapter, Google)
    src/allowlist.ts             isAllowlisted()
    src/sentry.ts                Sentry init
    test/health.test.ts
    test/allowlist.test.ts
  web/
    package.json
    vite.config.ts
    index.html
    tailwind.config.ts / postcss / components.json (shadcn)
    src/main.tsx                 providers (router, query, trpc, posthog, sentry)
    src/router.tsx               TanStack Router routes
    src/lib/trpc.ts              tRPC react client
    src/lib/auth-client.ts       BetterAuth react client
    src/routes/__root.tsx        RootLayout + NavBar
    src/routes/index.tsx         HomePage (map placeholder)
    src/routes/sign-in.tsx       SignInPage
    src/routes/request-access.tsx RequestAccessPage
    src/components/nav-bar.tsx
    src/test/nav-bar.test.tsx
```

---

## Task 1: Monorepo scaffold (Bun + Turborepo)

**Files:**
- Create: `package.json`, `turbo.json`, `tsconfig.base.json`, `bunfig.toml`, `.gitignore` (append)

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "campbrain",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.1.38",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "db:up": "docker compose -f docker-compose.dev.yml up -d",
    "db:migrate": "bun --filter @campbrain/db migrate"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.0"
  }
}
```

> Note: the legacy single-package `package.json` is being replaced. The old `src/` and `web/` trees stay in the working tree for reference/salvage but are no longer part of the workspace build. Do not delete them in Phase 0.

- [ ] **Step 2: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".output/**"] },
    "dev": { "cache": false, "persistent": true },
    "test": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {}
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "composite": false
  }
}
```

- [ ] **Step 4: Create `bunfig.toml`**

```toml
[install]
exact = true
```

- [ ] **Step 5: Append monorepo entries to `.gitignore`**

```
node_modules
dist
.output
.turbo
.dev.vars
.wrangler
.env
```

- [ ] **Step 6: Install and verify**

Run: `bun install`
Expected: lockfile `bun.lockb` created, no errors.

Run: `bun run typecheck`
Expected: completes (no workspace packages yet → "no tasks" or success).

- [ ] **Step 7: Commit**

```bash
git add package.json turbo.json tsconfig.base.json bunfig.toml .gitignore bun.lockb
git commit -m "chore(monorepo): bun + turborepo scaffold"
```

---

## Task 2: `packages/config` — env schemas (TDD)

**Files:**
- Create: `packages/config/package.json`, `packages/config/src/env.ts`, `packages/config/src/index.ts`
- Test: `packages/config/test/env.test.ts`

- [ ] **Step 1: Create `packages/config/package.json`**

```json
{
  "name": "@campbrain/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": { "zod": "^3.24.0" },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.7.0" }
}
```

Add `packages/config/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 2: Write the failing test** — `packages/config/test/env.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseServerEnv } from "../src/env";

describe("parseServerEnv", () => {
  it("parses a complete env", () => {
    const env = parseServerEnv({
      DATABASE_URL: "postgres://u:p@host/db",
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://api.example.com",
      GOOGLE_CLIENT_ID: "gid",
      GOOGLE_CLIENT_SECRET: "gsecret",
    });
    expect(env.DATABASE_URL).toContain("postgres://");
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => parseServerEnv({ BETTER_AUTH_SECRET: "x".repeat(32) })).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --filter @campbrain/config test`
Expected: FAIL — `parseServerEnv` not found.

- [ ] **Step 4: Implement `packages/config/src/env.ts`**

```ts
import { z } from "zod";

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgres")),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  SENTRY_DSN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(raw: Record<string, unknown>): ServerEnv {
  return serverEnvSchema.parse(raw);
}

export const webEnvSchema = z.object({
  VITE_API_URL: z.string().url(),
  VITE_POSTHOG_KEY: z.string().optional(),
  VITE_POSTHOG_HOST: z.string().optional(),
  VITE_SENTRY_DSN: z.string().optional(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
```

- [ ] **Step 5: Create `packages/config/src/index.ts`**

```ts
export * from "./env";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun --filter @campbrain/config test`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/config
git commit -m "feat(config): server + web env schemas"
```

---

## Task 3: `packages/db` — Drizzle schema + connection

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`, `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/mv.ts`, `packages/db/src/index.ts`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@campbrain/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./schema": "./src/schema.ts" },
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "bun run src/migrate.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "drizzle-orm": "^0.38.0",
    "@neondatabase/serverless": "^0.10.0",
    "postgres": "^3.4.5"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.0",
    "vitest": "^2.1.0",
    "typescript": "^5.7.0"
  }
}
```

`packages/db/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 2: Create `packages/db/src/schema.ts`** (ported 1:1 from `src/cache/db.ts`)

```ts
import {
  pgTable, text, serial, integer, boolean, date, timestamp, numeric, jsonb,
  primaryKey, foreignKey, unique, index, uniqueIndex, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// NOTE: drizzle-orm 0.38 requires the ARRAY-return form for table extra-config
// callbacks: `(t) => [ ... ]` (not the object form shown below). Convert each
// table's callback to an array of the same constraints during implementation.

export const providers = pgTable("providers", {
  providerId: text("provider_id").primaryKey(),
  displayName: text("display_name").notNull(),
  baseUrl: text("base_url"),
});

export const parks = pgTable("parks", {
  providerId: text("provider_id").notNull().references(() => providers.providerId),
  parkPageId: text("park_page_id").notNull(),
  parkName: text("park_name").notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.providerId, t.parkPageId] }) }));

export const campgrounds = pgTable("campgrounds", {
  providerId: text("provider_id").notNull(),
  parkPageId: text("park_page_id").notNull(),
  campgroundName: text("campground_name").notNull(),
  campgroundId: text("campground_id").notNull(),
  nightlyFee: numeric("nightly_fee", { precision: 8, scale: 2 }),
  bookingUrl: text("booking_url"),
}, (t) => ({
  pk: primaryKey({ columns: [t.providerId, t.parkPageId, t.campgroundName] }),
  parkFk: foreignKey({ columns: [t.providerId, t.parkPageId], foreignColumns: [parks.providerId, parks.parkPageId] }),
}));

export const sites = pgTable("sites", {
  siteId: serial("site_id").primaryKey(),
  providerId: text("provider_id").notNull(),
  parkPageId: text("park_page_id").notNull(),
  campgroundName: text("campground_name").notNull(),
  siteName: text("site_name").notNull(),
  access: text("access").notNull().default("drive_in"),
  siteKind: text("site_kind"),
  isGroup: boolean("is_group").notNull().default(false),
  isEquestrian: boolean("is_equestrian").notNull().default(false),
  isWalkUp: boolean("is_walk_up").notNull().default(false),
  isDayUse: boolean("is_day_use").notNull().default(false),
}, (t) => ({
  uq: unique().on(t.providerId, t.parkPageId, t.campgroundName, t.siteName),
  cgFk: foreignKey({
    columns: [t.providerId, t.parkPageId, t.campgroundName],
    foreignColumns: [campgrounds.providerId, campgrounds.parkPageId, campgrounds.campgroundName],
  }),
  parkIdx: index("idx_sites_park").on(t.providerId, t.parkPageId),
}));

export const scanWindows = pgTable("scan_windows", {
  providerId: text("provider_id").notNull(),
  parkPageId: text("park_page_id").notNull(),
  windowStart: date("window_start").notNull(),
  windowEnd: date("window_end").notNull(),
  scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull(),
  sourceUrl: text("source_url").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.providerId, t.parkPageId, t.windowStart] }),
  parkFk: foreignKey({ columns: [t.providerId, t.parkPageId], foreignColumns: [parks.providerId, parks.parkPageId] }),
  endIdx: index("idx_scan_windows_end").on(t.windowEnd),
}));

export const availability = pgTable("availability", {
  siteId: integer("site_id").notNull().references(() => sites.siteId, { onDelete: "cascade" }),
  date: date("date").notNull(),
  status: text("status").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.siteId, t.date] }),
  dateIdx: index("idx_availability_date").on(t.date),
  availIdx: index("idx_availability_available").on(t.date).where(sql`status = 'available'`),
  statusCheck: check("availability_status_check", sql`status IN ('available', 'unavailable', 'unknown')`),
}));

export const savedSearches = pgTable("saved_searches", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  provider: text("provider").notNull().default("california-parks").references(() => providers.providerId),
  name: text("name").notNull(),
  definition: jsonb("definition").notNull(),
  alertEnabled: boolean("alert_enabled").notNull().default(false),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("idx_saved_searches_user").on(t.userId),
  alertIdx: index("idx_saved_searches_alert_enabled").on(t.alertEnabled).where(sql`alert_enabled = true`),
}));

export const accessAllowlist = pgTable("access_allowlist", {
  email: text("email").primaryKey(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Create `packages/db/src/mv.ts`** (MV SQL ported verbatim from `src/cache/db.ts`)

```ts
import { sql } from "drizzle-orm";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";

export const MV_CREATE_SQL = `
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_available_stays AS
WITH avail AS (
  SELECT s.provider_id, s.park_page_id, s.campground_name, s.site_name, s.site_id,
         a.date, s.is_walk_up
  FROM availability a
  JOIN sites s ON s.site_id = a.site_id
  WHERE a.status = 'available' AND a.date >= CURRENT_DATE AND s.is_day_use = false
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
SELECT s.provider_id, s.park_page_id, p.park_name, s.campground_name,
       cg.nightly_fee::numeric(8,2), cg.booking_url, s.arrival_date, s.nights,
       coalesce(array_agg(DISTINCT s.site_name ORDER BY s.site_name) FILTER (WHERE NOT s.is_walk_up), '{}'::text[]) AS available_sites,
       coalesce(array_agg(DISTINCT s.site_name ORDER BY s.site_name) FILTER (WHERE s.is_walk_up), '{}'::text[]) AS walk_up_sites
FROM stays s
JOIN parks p ON p.provider_id = s.provider_id AND p.park_page_id = s.park_page_id
JOIN campgrounds cg ON cg.provider_id = s.provider_id AND cg.park_page_id = s.park_page_id AND cg.campground_name = s.campground_name
GROUP BY s.provider_id, s.park_page_id, p.park_name, s.campground_name,
         cg.nightly_fee, cg.booking_url, s.arrival_date, s.nights
WITH NO DATA;
`;

export const MV_INDEX_SQL = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_available_stays_pk ON mv_available_stays(provider_id, park_page_id, campground_name, arrival_date, nights)`,
  `CREATE INDEX IF NOT EXISTS idx_mv_available_stays_date ON mv_available_stays(arrival_date)`,
];

export async function refreshAvailableStays(db: NeonDatabase): Promise<void> {
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_available_stays`);
}
```

- [ ] **Step 4: Create `packages/db/src/client.ts`** (Worker runtime — neon-serverless, transactional)

```ts
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

export type Db = NeonDatabase<typeof schema>;

export function createDb(databaseUrl: string): Db {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle(pool, { schema });
}
```

- [ ] **Step 5: Create `packages/db/src/index.ts`**

```ts
export * as schema from "./schema";
export * from "./schema";
export { createDb, type Db } from "./client";
export { refreshAvailableStays } from "./mv";
```

- [ ] **Step 6: Create `packages/db/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

> `auth-schema.ts` is generated in Task 5; create an empty placeholder now so config resolves:
> `packages/db/src/auth-schema.ts` with `export {};`

- [ ] **Step 7: Typecheck**

Run: `bun --filter @campbrain/db typecheck`
Expected: PASS (no type errors).

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): drizzle schema + neon client + MV sql"
```

---

## Task 4: Local Postgres + migrations (Drizzle Kit + MV)

**Files:**
- Create: `docker-compose.dev.yml`, `packages/db/src/migrate.ts`
- Test: `packages/db/test/schema.test.ts`

- [ ] **Step 1: Create `docker-compose.dev.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    container_name: campbrain-dev-pg
    environment:
      POSTGRES_USER: campbrain
      POSTGRES_PASSWORD: campbrain_dev_password
      POSTGRES_DB: campbrain
    ports: ["5432:5432"]
    volumes: ["campbrain_dev_pgdata:/var/lib/postgresql/data"]
volumes:
  campbrain_dev_pgdata:
```

- [ ] **Step 2: Create `packages/db/src/migrate.ts`** (postgres-js — works local + Neon)

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { MV_CREATE_SQL, MV_INDEX_SQL } from "./mv";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);

  await migrate(db, { migrationsFolder: "./migrations" });

  await db.execute(sql.raw(MV_CREATE_SQL));
  for (const stmt of MV_INDEX_SQL) await db.execute(sql.raw(stmt));

  await client.end();
  console.log("✅ migrations + MV applied");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Generate the initial migration**

Run:
```bash
cd packages/db
docker compose -f ../../docker-compose.dev.yml up -d
export DATABASE_URL="postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain"
bun run generate
```
Expected: `migrations/0000_*.sql` + `migrations/meta/` created. Commit these as-is.

- [ ] **Step 4: Write the schema test** — `packages/db/test/schema.test.ts`

```ts
import { describe, it, expect, beforeAll } from "vitest";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";

describe("schema migration", () => {
  let sql: ReturnType<typeof postgres>;
  beforeAll(() => { sql = postgres(url, { max: 1, onnotice: () => {} }); });

  it("creates the sites table with classification columns", async () => {
    const rows = await sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'sites'
    `;
    const cols = rows.map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(["is_walk_up", "is_day_use", "access", "site_kind"]));
  });

  it("creates the mv_available_stays materialized view", async () => {
    const rows = await sql`SELECT matviewname FROM pg_matviews WHERE matviewname = 'mv_available_stays'`;
    expect(rows.length).toBe(1);
  });

  it("creates the access_allowlist table", async () => {
    const rows = await sql`SELECT to_regclass('public.access_allowlist') AS t`;
    expect(rows[0].t).toBe("access_allowlist");
  });
});
```

- [ ] **Step 5: Run migrations against local PG, then run the test**

Run:
```bash
bun run migrate
bun run test
```
Expected: migrate prints "✅ migrations + MV applied"; all 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.dev.yml packages/db/src/migrate.ts packages/db/migrations packages/db/test
git commit -m "feat(db): local postgres + drizzle migrations + MV apply"
```

---

## Task 5: BetterAuth schema + instance + allowlist (TDD)

**Files:**
- Create: `apps/api/src/auth.ts`, `apps/api/src/allowlist.ts`, `packages/db/src/auth-schema.ts` (generated)
- Test: `apps/api/test/allowlist.test.ts`
- Modify: `packages/db/migrations` (regenerate to include auth tables)

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@campbrain/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@campbrain/config": "workspace:*",
    "@campbrain/db": "workspace:*",
    "hono": "^4.6.0",
    "@hono/trpc-server": "^0.3.4",
    "@trpc/server": "^11.0.0",
    "better-auth": "^1.1.0",
    "@sentry/cloudflare": "^8.40.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "wrangler": "^3.90.0",
    "@cloudflare/workers-types": "^4.20241127.0",
    "vitest": "^2.1.0",
    "typescript": "^5.7.0"
  }
}
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types"] },
  "include": ["src", "test"]
}
```

- [ ] **Step 2: Create the BetterAuth instance** — `apps/api/src/auth.ts`

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Db } from "@campbrain/db";

export function createAuth(db: Db, env: {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  WEB_ORIGIN: string;
}) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_ORIGIN],
    socialProviders: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    },
    advanced: {
      // Web (Pages) and API (Worker) are different origins in staging, so the
      // session cookie must be SameSite=None; Secure to survive the cross-site
      // round-trip. See the cross-origin cookie note in Task 10.
      defaultCookieAttributes: { sameSite: "none", secure: true },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

> **Cross-origin cookie risk (important):** `*.pages.dev` and `*.workers.dev` are different *registrable* domains, so even with `SameSite=None; Secure` browsers may block the cookie as third-party. The robust fix is to put both behind **one parent domain** via Cloudflare custom domains — e.g. `app.campbrain.<tld>` (Pages) + `api.campbrain.<tld>` (Worker) — which makes the cookie first-party. If you don't want a custom domain yet for staging, verify sign-in in a browser with third-party cookies allowed, and treat the custom-domain setup as a required step before sharing the link. This is the single most likely thing to break in Task 10.

- [ ] **Step 3: Generate BetterAuth's Drizzle schema**

Run (from repo root):
```bash
bunx @better-auth/cli generate --config apps/api/src/auth.ts --output packages/db/src/auth-schema.ts -y
```
Expected: `packages/db/src/auth-schema.ts` now exports `user`, `session`, `account`, `verification` Drizzle tables. Export them from `packages/db/src/index.ts`:

```ts
export * from "./auth-schema";
```

> If the CLI cannot resolve the factory form, define the four tables manually per BetterAuth's Drizzle schema docs (user, session, account, verification) with the documented columns.

- [ ] **Step 4: Regenerate + apply migrations (now including auth tables)**

Run:
```bash
cd packages/db
export DATABASE_URL="postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain"
bun run generate && bun run migrate
```
Expected: a new `migrations/0001_*.sql` adds the auth tables; migrate succeeds.

- [ ] **Step 5: Write the failing allowlist test** — `apps/api/test/allowlist.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { isAllowlisted } from "../src/allowlist";

function fakeDb(emails: string[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(emails.map((email) => ({ email }))),
      }),
    }),
  } as unknown as Parameters<typeof isAllowlisted>[0];
}

describe("isAllowlisted", () => {
  it("returns true for a listed email (case-insensitive)", async () => {
    expect(await isAllowlisted(fakeDb(["a@b.com"]), "A@B.com")).toBe(true);
  });
  it("returns false when not listed", async () => {
    expect(await isAllowlisted(fakeDb([]), "x@y.com")).toBe(false);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun --filter @campbrain/api test`
Expected: FAIL — `isAllowlisted` not found.

- [ ] **Step 7: Implement `apps/api/src/allowlist.ts`**

```ts
import { eq } from "drizzle-orm";
import { accessAllowlist, type Db } from "@campbrain/db";

export async function isAllowlisted(db: Db, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const rows = await db.select().from(accessAllowlist).where(eq(accessAllowlist.email, normalized));
  return rows.length > 0;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun --filter @campbrain/api test`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.json apps/api/src/auth.ts apps/api/src/allowlist.ts apps/api/test packages/db/src/auth-schema.ts packages/db/src/index.ts packages/db/migrations
git commit -m "feat(api): better-auth google + allowlist gate"
```

---

## Task 6: Hono Worker — /health + tRPC + auth mount (TDD)

**Files:**
- Create: `apps/api/src/trpc/context.ts`, `apps/api/src/trpc/router.ts`, `apps/api/src/sentry.ts`, `apps/api/src/index.ts`, `apps/api/wrangler.toml`
- Test: `apps/api/test/health.test.ts`

- [ ] **Step 1: Create the tRPC context** — `apps/api/src/trpc/context.ts`

```ts
import type { Db } from "@campbrain/db";
import type { Auth } from "../auth";

export interface TrpcContext {
  db: Db;
  auth: Auth;
  session: Awaited<ReturnType<Auth["api"]["getSession"]>> | null;
}

export async function createContext(opts: {
  db: Db; auth: Auth; headers: Headers;
}): Promise<TrpcContext> {
  const session = await opts.auth.api.getSession({ headers: opts.headers });
  return { db: opts.db, auth: opts.auth, session };
}
```

- [ ] **Step 2: Create the router** — `apps/api/src/trpc/router.ts`

```ts
import { initTRPC } from "@trpc/server";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 3: Create Sentry init** — `apps/api/src/sentry.ts`

```ts
import * as Sentry from "@sentry/cloudflare";

export function sentryOptions(env: { SENTRY_DSN?: string }) {
  return { dsn: env.SENTRY_DSN, tracesSampleRate: 0.1 };
}
export { Sentry };
```

- [ ] **Step 4: Create the Hono app** — `apps/api/src/index.ts`

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { createDb } from "@campbrain/db";
import { createAuth } from "./auth";
import { appRouter } from "./trpc/router";
import { createContext } from "./trpc/context";

type Bindings = {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  WEB_ORIGIN: string;
  SENTRY_DSN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", (c, next) =>
  cors({ origin: c.env.WEB_ORIGIN, credentials: true })(c, next));

app.get("/health", (c) => c.json({ ok: true }));

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const auth = createAuth(db, c.env);
  return auth.handler(c.req.raw);
});

app.use("/trpc/*", async (c, next) => {
  const db = createDb(c.env.DATABASE_URL);
  const auth = createAuth(db, c.env);
  return trpcServer({
    router: appRouter,
    createContext: (_opts, ctx) =>
      createContext({ db, auth, headers: ctx.req.raw.headers }),
  })(c, next);
});

export default app;
```

- [ ] **Step 5: Create `apps/api/wrangler.toml`**

```toml
name = "campbrain-api"
main = "src/index.ts"
compatibility_date = "2024-11-27"
compatibility_flags = ["nodejs_compat"]

[vars]
WEB_ORIGIN = "http://localhost:5173"
BETTER_AUTH_URL = "http://localhost:8787"
```

> Secrets (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SENTRY_DSN`) are set via `wrangler secret put` (Task 10) and in `.dev.vars` locally. Create `apps/api/.dev.vars` (gitignored) with local values.

- [ ] **Step 6: Write the health test** — `apps/api/test/health.test.ts`

```ts
import { describe, it, expect } from "vitest";
import app from "../src/index";

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `bun --filter @campbrain/api test`
Expected: PASS (health + the 2 allowlist tests).

- [ ] **Step 8: Smoke the worker locally**

Run: `cd apps/api && bun run dev` (wrangler dev on :8787), then in another shell `curl http://localhost:8787/health`
Expected: `{"ok":true}`. Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src apps/api/wrangler.toml apps/api/test/health.test.ts
git commit -m "feat(api): hono worker with /health, trpc, auth mount"
```

---

## Task 7: `packages/api-client` + `packages/types`

**Files:**
- Create: `packages/types/package.json`, `packages/types/src/index.ts`, `packages/api-client/package.json`, `packages/api-client/src/index.ts`

- [ ] **Step 1: Create `packages/types`** (placeholder that grows in later phases)

`packages/types/package.json`:
```json
{
  "name": "@campbrain/types",
  "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": { "zod": "^3.24.0" },
  "devDependencies": { "typescript": "^5.7.0" }
}
```
`packages/types/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`
`packages/types/src/index.ts`:
```ts
export {}; // shared Zod DTOs land here as surfaces are ported (Phase 1+)
```

- [ ] **Step 2: Create `packages/api-client`** — typed tRPC client factory

`packages/api-client/package.json`:
```json
{
  "name": "@campbrain/api-client",
  "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": {
    "@campbrain/api": "workspace:*",
    "@trpc/client": "^11.0.0"
  },
  "devDependencies": { "typescript": "^5.7.0" }
}
```
`packages/api-client/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`
`packages/api-client/src/index.ts`:
```ts
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@campbrain/api/src/trpc/router";

export type { AppRouter };

export function createApiClient(apiUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${apiUrl}/trpc`, fetch: (u, o) => fetch(u, { ...o, credentials: "include" }) })],
  });
}
```

> Add `"@campbrain/api": { "exports": { "./src/trpc/router": "./src/trpc/router.ts" } }` — i.e. add a subpath export to `apps/api/package.json`:
> `"exports": { "./src/trpc/router": "./src/trpc/router.ts" }`

- [ ] **Step 3: Typecheck both packages**

Run: `bun --filter @campbrain/types typecheck && bun --filter @campbrain/api-client typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/types packages/api-client apps/api/package.json
git commit -m "feat(packages): shared types + typed trpc api-client"
```

---

## Task 8: `apps/web` — Vite + Tailwind + shadcn + auth shell

**Files:**
- Create the Vite app scaffold + the custom files listed below.
- Test: `apps/web/src/test/nav-bar.test.tsx`

- [ ] **Step 1: Scaffold Vite React TS app**

Run (from repo root):
```bash
bunx create-vite@latest apps/web --template react-ts
cd apps/web && bun install
bun add @campbrain/api-client@workspace:* @campbrain/config@workspace:* @tanstack/react-router @tanstack/react-query @trpc/client @trpc/tanstack-react-query better-auth posthog-js @sentry/react
bun add -d tailwindcss @tailwindcss/vite vitest @testing-library/react @testing-library/jest-dom jsdom
```
Set `apps/web/package.json` name to `@campbrain/web` and scripts:
```json
"scripts": { "dev": "vite", "build": "vite build", "test": "vitest run", "typecheck": "tsc --noEmit" }
```

- [ ] **Step 2: Wire Tailwind v4 + shadcn**

`apps/web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { port: 5173 },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test/setup.ts"] },
});
```
Add `@import "tailwindcss";` at the top of `apps/web/src/index.css`. Then init shadcn:
```bash
bunx shadcn@latest init -d
bunx shadcn@latest add button avatar dropdown-menu
```
Create `apps/web/src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Create the BetterAuth react client** — `apps/web/src/lib/auth-client.ts`

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL,
  basePath: "/api/auth",
});

export const { signIn, signOut, useSession } = authClient;
```

- [ ] **Step 4: Create the tRPC client** — `apps/web/src/lib/trpc.ts`

```ts
import { createApiClient } from "@campbrain/api-client";

export const api = createApiClient(import.meta.env.VITE_API_URL);
```

- [ ] **Step 5: Create the NavBar** — `apps/web/src/components/nav-bar.tsx`

```tsx
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { signIn, signOut, useSession } from "@/lib/auth-client";

export function NavBar() {
  const { data: session } = useSession();
  return (
    <header className="flex items-center justify-between border-b px-4 py-2">
      <nav className="flex gap-4">
        <Link to="/">Map</Link>
        <Link to="/explore">Explore</Link>
        <Link to="/saved">Saved</Link>
        <Link to="/alerts">Alerts</Link>
      </nav>
      {session ? (
        <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
      ) : (
        <Button onClick={() => signIn.social({ provider: "google" })}>
          Sign in with Google
        </Button>
      )}
    </header>
  );
}
```

- [ ] **Step 6: Create routes** — root layout, home, sign-in, request-access

`apps/web/src/routes/__root.tsx`:
```tsx
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { NavBar } from "@/components/nav-bar";

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen">
      <NavBar />
      <main className="p-4"><Outlet /></main>
    </div>
  ),
});
```
`apps/web/src/routes/index.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <div data-testid="home">Map coming in Phase 1</div>,
});
```
`apps/web/src/routes/sign-in.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth-client";

export const Route = createFileRoute("/sign-in")({
  component: () => (
    <div className="mx-auto max-w-sm space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Sign in to CampBrain</h1>
      <Button onClick={() => signIn.social({ provider: "google" })}>
        Sign in with Google
      </Button>
    </div>
  ),
});
```
`apps/web/src/routes/request-access.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/request-access")({
  component: () => (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold">Request access</h1>
      <p className="text-muted-foreground">CampBrain is invite-only right now. Ask the owner to add your email.</p>
    </div>
  ),
});
```

- [ ] **Step 7: Wire providers** — `apps/web/src/main.tsx`

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "./index.css";

const queryClient = new QueryClient();
const router = createRouter({ routeTree });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
```

> Add the TanStack Router Vite plugin to generate `routeTree.gen.ts`:
> `bun add -d @tanstack/router-plugin` and add `TanStackRouterVite()` to `vite.config.ts` plugins (before `react()`).

- [ ] **Step 8: Write the NavBar test** — `apps/web/src/test/nav-bar.test.tsx`

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NavBar } from "@/components/nav-bar";

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: null }),
  signIn: { social: vi.fn() },
  signOut: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

describe("NavBar", () => {
  it("shows Sign in when logged out", () => {
    render(<NavBar />);
    expect(screen.getByText("Sign in with Google")).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Run test + build**

Run: `bun --filter @campbrain/web test`
Expected: PASS.
Run: `bun --filter @campbrain/web build`
Expected: build succeeds, `dist/` produced.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): vite + tailwind + shadcn auth shell"
```

---

## Task 9: CI (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: CI
on:
  pull_request:
    branches: [hosted-launch, main]
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: campbrain
          POSTGRES_PASSWORD: campbrain_dev_password
          POSTGRES_DB: campbrain
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: latest }
      - run: bun install --frozen-lockfile
      - run: bun --filter @campbrain/db migrate
      - run: bun run typecheck
      - run: bun run test
      - run: bun run build
```

- [ ] **Step 2: Verify locally (act-free smoke)**

Run: `bun install --frozen-lockfile && bun run typecheck && bun run test && bun run build`
Expected: all pass against the locally-running Docker Postgres.

- [ ] **Step 3: Commit + open PR**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: typecheck + test + build on PRs into hosted-launch"
```
Push the branch and open a PR into `hosted-launch` to confirm CI goes green. (If executing in slices, this is the first PR; subsequent tasks merge through CI.)

---

## Task 10: Deploy to Cloudflare (staging)

**Files:** none (platform config). Requires a Cloudflare account, a Neon project, and a Google OAuth client.

- [ ] **Step 1: Provision Neon + run migrations**

Create a Neon project (dashboard). Copy the **pooled** connection string. Then:
```bash
export DATABASE_URL="<neon-pooled-connection-string>"
bun --filter @campbrain/db migrate
```
Expected: "✅ migrations + MV applied" against Neon.

- [ ] **Step 2: Seed your own email into the allowlist**

```bash
psql "$DATABASE_URL" -c "INSERT INTO access_allowlist (email) VALUES ('jelvehn@gmail.com') ON CONFLICT DO NOTHING;"
```

- [ ] **Step 3: Create Google OAuth client**

In Google Cloud Console → Credentials → OAuth client (Web). Authorized redirect URI:
`https://campbrain-api.<your-subdomain>.workers.dev/api/auth/callback/google`
(and `http://localhost:8787/api/auth/callback/google` for local). Note the client id/secret.

- [ ] **Step 4: Set Worker secrets + deploy the API**

```bash
cd apps/api
wrangler secret put DATABASE_URL          # neon pooled string
wrangler secret put BETTER_AUTH_SECRET     # `openssl rand -base64 32`
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put SENTRY_DSN             # optional
wrangler deploy
```
Update `wrangler.toml` `[vars]` `BETTER_AUTH_URL` and `WEB_ORIGIN` to the deployed URLs (set `WEB_ORIGIN` after Step 5), then `wrangler deploy` again.
Expected: `https://campbrain-api.<subdomain>.workers.dev/health` returns `{"ok":true}`.

- [ ] **Step 5: Deploy the web app to Cloudflare Pages**

Connect the repo in the Cloudflare Pages dashboard with:
- Production branch: `hosted-launch` (staging)
- Build command: `bun install && bun --filter @campbrain/web build`
- Build output dir: `apps/web/dist`
- Env var: `VITE_API_URL=https://campbrain-api.<subdomain>.workers.dev`
Expected: Pages builds and serves a URL (e.g. `https://campbrain-web.pages.dev`). Set the API's `WEB_ORIGIN` to this origin and redeploy the Worker (Step 4).

- [ ] **Step 6: End-to-end acceptance**

1. Visit the Pages URL → NavBar shows "Sign in with Google".
2. Sign in with `jelvehn@gmail.com` (allowlisted) → session established, NavBar shows "Sign out".
3. (Phase 1 will enforce the allowlist redirect; Phase 0 verifies sign-in + session round-trips between Pages and the Worker with cookies/CORS working.)

If the session does not stick after Google redirect, it is almost certainly the **cross-origin cookie** issue (see the note in Task 5): confirm the cookie is `SameSite=None; Secure`, that `WEB_ORIGIN` exactly matches the Pages origin (scheme + host, no trailing slash), and — the durable fix — move both apps under one parent domain via Cloudflare custom domains (`app.` + `api.`).

Expected: a deployed staging URL where Google sign-in works end-to-end against Neon.

- [ ] **Step 7: Commit any config changes**

```bash
git add apps/api/wrangler.toml
git commit -m "chore(deploy): staging wrangler vars (api url, web origin)"
```

---

## Self-Review

**Spec coverage (Phase 0 section):**
- Branch + worktree → Setup section. ✅
- Turborepo + Bun scaffold + `apps/{web,api}` + `packages/{ui,config,api-client,types,core,db}` → Tasks 1–3, 7, 8. ⚠️ `packages/ui` and `packages/core` are **intentionally deferred to Phase 1** (no shared components or domain logic is needed for the empty shell; shadcn components live in `apps/web` until extraction). Noted here so it is not mistaken for a gap.
- Neon + Drizzle schema + MV + migrations → Tasks 3, 4, 10. ✅
- Wrangler config (Worker + Pages); trivial authed shell at staging URL → Tasks 6, 8, 10. ✅
- BetterAuth + Google + allowlist gate → Tasks 5, 6 (+ enforcement of the redirect is Phase 1; Phase 0 establishes sign-in + the allowlist primitive). ✅
- Docker local Postgres; turbo/Bun dev orchestration → Tasks 1, 4. ✅
- CI (typecheck + Vitest) → Task 9 (also runs build). ✅
- Sentry + PostHog baseline → Sentry wired in Task 6; **PostHog/Sentry web init deferred into Task 8's provider wiring** — add `posthog-js` + `@sentry/react` init in `main.tsx` (dependencies are installed in Task 8 Step 1). Note: keep these behind the optional env vars from `webEnvSchema`.

**Placeholder scan:** No "TBD/TODO"; every code step has complete content. The two deferrals (`packages/ui`/`core`, allowlist *enforcement*) are explicitly scoped to Phase 1, not left vague.

**Type consistency:** `createDb`/`Db` (db), `createAuth`/`Auth` (auth), `isAllowlisted(db, email)`, `appRouter`/`AppRouter`, `createApiClient(apiUrl)`, `createContext({db,auth,headers})`, `parseServerEnv`/`serverEnvSchema` are used consistently across tasks. Table exports (`accessAllowlist`, `savedSearches`, etc.) match `schema.ts`.

**Note for the executor:** Library versions are pinned to recent majors; if `bun install` resolves a newer major with breaking API changes (esp. BetterAuth, Drizzle, tRPC v11, Tailwind v4, TanStack Router), follow that library's current quickstart for the exact import paths — the *structure* of each task (what file does what) stays valid.
