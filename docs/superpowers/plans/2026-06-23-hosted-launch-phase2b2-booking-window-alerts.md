# CampBrain Hosted Launch — Phase 2b-2 (Booking-Window Targets + `/alerts`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **Fresh-session plan — self-contained; read the cited legacy files for fidelity.** Calendar sync (2b-3) is OUT of scope — `calendar_enabled` ships as an inert flag.

**Goal:** Port the legacy `/alerts` booking-window surface to a multi-user, Neon-backed surface: a `targets` table, the Reservation-Window engine (6-months-before + 8 AM-release reminder cascade) ported + tested in `@campbrain/core`, a protected `targets` tRPC router, and a gated `/alerts` React surface that manages targets + shows their upcoming booking windows.

**Architecture:** Pure booking-window math in `@campbrain/core`; user-scoped persistence in `@campbrain/db` (a `targets` store that mirrors the proven 2a `saved_searches` store — `definition` JSONB, ownership-filtered on `user_id`); a protected `targets` tRPC router (`ctx.userId`-scoped, mirrors `savedSearches`); a gated `/alerts` surface (mirrors `/saved` + `/dashboard`). No scanner/cron — booking windows are computed on read.

**Tech Stack:** Bun · Turborepo · TS strict · Drizzle + Neon (drizzle-kit migrations) · tRPC v11 · React 19 + TanStack Router/Query + Tailwind v4 + shadcn · dayjs (utc/timezone) · Vitest.

**Spec:** docs/superpowers/specs/2026-06-23-hosted-launch-phase2b2-booking-window-alerts-design.md

**Env note:** `migrate`/`generate`+`migrate` need `DATABASE_URL` inline: `postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain` (migrate.ts has no fallback). Integration tests default to that URL themselves.

---

## Task 0: Environment up + migrated + seeded

**Files:** none. No commit.

```bash
cd /Users/nimajelveh/campbrain && docker compose -f docker-compose.dev.yml up -d && \
  DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun --filter @campbrain/db migrate && \
  DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun --filter @campbrain/db seed:catalog
```
Expected: postgres `Up`; migrations idempotent (`✅ migrations + MV applied`); seed reports parks. (This applies the 2b-1 `hits`/`scan_runs` migrations too — fine.)

---

## Task 1: `targets` table schema + migration

**Files:** Modify `packages/db/src/schema.ts`; Generated `packages/db/migrations/000X_*.sql`; Test `packages/db/test/targets.test.ts` (smoke).

- [ ] **Step 1: Add the table def to `packages/db/src/schema.ts`** (mirror the existing `savedSearches` table style — `(t) => [ index(...) ]` form):

```ts
export const targets = pgTable("targets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  definition: jsonb("definition").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  calendarEnabled: boolean("calendar_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_targets_user").on(t.userId),
]);
```
(`jsonb` is already imported in schema.ts — confirm. Match the `savedSearches` column patterns exactly.)

- [ ] **Step 2: Generate + apply**
```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/db generate && \
  DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' bun --filter @campbrain/db migrate
```
Expected: a new `000X_*.sql` that ONLY creates `targets` + its index (no ALTERs to existing tables); `✅ migrations + MV applied`. Confirm: `docker compose -f docker-compose.dev.yml exec -T postgres psql -U campbrain -d campbrain -c "\d targets"`.

- [ ] **Step 3: Smoke test** `packages/db/test/targets.test.ts` (mirror `packages/db/test/scan-runs.test.ts` harness — `dbReachable`, `it.skipIf(!hasDb)`): insert a `targets` row with a `definition` jsonb + read it back, asserting the name round-trips. (This file gets the full CRUD/isolation suite in Task 4 — structure it so cases append.)

- [ ] **Step 4: Run + typecheck + commit**
```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/db test targets && bun --filter @campbrain/db typecheck && git add packages/db/src/schema.ts packages/db/migrations packages/db/test/targets.test.ts && git commit -m "feat(db): targets table"
```

---

## Task 2: `@campbrain/types` — Target / BookingRule / datePattern / window DTOs

**Files:** Create `packages/types/src/target.ts`; Modify `packages/types/src/index.ts`; Test `packages/types/test/target.test.ts`.

- [ ] **Step 1: Write the failing test** `packages/types/test/target.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { TargetInputSchema, TargetDatePatternSchema, BookingRuleSchema } from "@campbrain/types";

describe("target schemas", () => {
  it("BookingRuleSchema defaults to CA rule", () => {
    expect(BookingRuleSchema.parse({})).toEqual({ monthsBefore: 6, releaseTime: "08:00", timezone: "America/Los_Angeles" });
  });
  it("datePattern accepts the three kinds", () => {
    expect(TargetDatePatternSchema.parse({ kind: "exact", date: "2026-08-01" }).kind).toBe("exact");
    expect(TargetDatePatternSchema.parse({ kind: "range", from: "2026-08-01", to: "2026-08-31", weekendsOnly: true }).kind).toBe("range");
    expect(TargetDatePatternSchema.parse({ kind: "rolling_weekends", weeks: 12 }).kind).toBe("rolling_weekends");
  });
  it("rejects a bad release time + a 0-week rolling pattern", () => {
    expect(BookingRuleSchema.safeParse({ releaseTime: "8am" }).success).toBe(false);
    expect(TargetDatePatternSchema.safeParse({ kind: "rolling_weekends", weeks: 0 }).success).toBe(false);
  });
  it("TargetInputSchema accepts a full input", () => {
    const t = TargetInputSchema.parse({
      userId: null, provider: "california-parks", name: "Angel Island Aug",
      scope: { parkPageId: "468", parkName: "Angel Island SP", campgroundName: null },
      datePattern: { kind: "rolling_weekends", weeks: 8 },
      bookingRule: {}, enabled: true, calendarEnabled: false,
    });
    expect(t.bookingRule.monthsBefore).toBe(6);
  });
});
```

- [ ] **Step 2: Run → fail.** `cd /Users/nimajelveh/campbrain && bun --filter @campbrain/types test target`

- [ ] **Step 3: Implement** `packages/types/src/target.ts`:
```ts
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const TargetScopeSchema = z.object({
  parkPageId: z.string().nullable(),
  parkName: z.string().nullable(),
  campgroundName: z.string().nullable(),
});
export type TargetScope = z.infer<typeof TargetScopeSchema>;

export const TargetDatePatternSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact"), date: isoDate }),
  z.object({ kind: z.literal("range"), from: isoDate, to: isoDate, weekendsOnly: z.boolean() }),
  z.object({ kind: z.literal("rolling_weekends"), weeks: z.number().int().min(1).max(52) }),
]);
export type TargetDatePattern = z.infer<typeof TargetDatePatternSchema>;

export const BookingRuleSchema = z.object({
  monthsBefore: z.number().int().positive().default(6),
  releaseTime: z.string().regex(/^\d{2}:\d{2}$/).default("08:00"),
  timezone: z.string().default("America/Los_Angeles"),
});
export type BookingRule = z.infer<typeof BookingRuleSchema>;

export const TargetInputSchema = z.object({
  userId: z.string().nullable(),
  provider: z.string(),
  name: z.string().min(1),
  scope: TargetScopeSchema,
  datePattern: TargetDatePatternSchema,
  bookingRule: BookingRuleSchema,
  enabled: z.boolean(),
  calendarEnabled: z.boolean(),
});
export type TargetInput = z.infer<typeof TargetInputSchema>;

export const TargetSchema = TargetInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Target = z.infer<typeof TargetSchema>;

export const BookingWindowSchema = z.object({
  arrivalDate: isoDate,
  bookingOpensAt: z.string(),
  reminders: z.object({ sevenDaysBefore: z.string(), nightBefore: z.string(), tenMinutesBefore: z.string() }),
});
export type BookingWindow = z.infer<typeof BookingWindowSchema>;

export const UpcomingTargetSchema = z.object({
  targetId: z.string(),
  name: z.string(),
  scopeLabel: z.string(),
  windows: z.array(BookingWindowSchema),
});
export type UpcomingTarget = z.infer<typeof UpcomingTargetSchema>;
```
In `packages/types/src/index.ts` add `export * from "./target";`

- [ ] **Step 4: Run + typecheck + commit**
```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/types test target && bun --filter @campbrain/types typecheck && git add packages/types/src/target.ts packages/types/src/index.ts packages/types/test/target.test.ts && git commit -m "feat(types): booking-window target schemas"
```

---

## Task 3: Core Reservation-Window engine (port + TEST)

**Files:** Create `packages/core/src/rules/booking-window.ts`; Modify `packages/core/src/index.ts`; Test (co-located) `packages/core/src/rules/booking-window.test.ts`.

Port `expandArrivalDates` + `computeBookingWindows` from legacy `src/rules/booking-window.ts`, adapted to `TargetDatePattern`, returning ISO strings. Reuses the existing (untested) `getBookingWindowTime`/`getReminderTimes` from `../utils/dates` — these get covered here.

> **NOTE:** `@campbrain/core` tests are **co-located** (`src/**/*.test.ts`), NOT in a `test/` dir (vitest config). `@campbrain/core` must depend on `@campbrain/types` (added in 2b-1 — confirm `package.json`). `dayjs` utc/timezone plugins are already extended in `utils/dates.ts`; this module must `dayjs.extend(isSameOrBefore)` for the range iteration (import `dayjs/plugin/isSameOrBefore.js`).

- [ ] **Step 1: Write the failing test** `packages/core/src/rules/booking-window.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { expandArrivalDates, computeBookingWindows } from "@campbrain/core";
import type { BookingRule } from "@campbrain/types";

const CA: BookingRule = { monthsBefore: 6, releaseTime: "08:00", timezone: "America/Los_Angeles" };

describe("expandArrivalDates", () => {
  it("exact → the single date", () => {
    expect(expandArrivalDates({ kind: "exact", date: "2026-08-01" }, "2026-06-23")).toEqual(["2026-08-01"]);
  });
  it("range weekendsOnly keeps only Fri/Sat", () => {
    const d = expandArrivalDates({ kind: "range", from: "2026-08-01", to: "2026-08-09", weekendsOnly: true }, "2026-06-23");
    expect(d).toEqual(["2026-08-01", "2026-08-07", "2026-08-08"]); // Sat 1, Fri 7, Sat 8
  });
  it("rolling_weekends yields N Fri+Sat pairs from today", () => {
    const d = expandArrivalDates({ kind: "rolling_weekends", weeks: 2 }, "2026-06-23"); // Tue
    expect(d).toHaveLength(4);
    expect(d.every((x) => [5, 6].includes(new Date(x + "T12:00:00Z").getUTCDay()))).toBe(true);
  });
});

describe("computeBookingWindows (6mo / 8AM PT)", () => {
  it("arrival 2026-07-15 opens 2026-01-15 08:00 PT with the reminder cascade", () => {
    const [w] = computeBookingWindows({ kind: "exact", date: "2026-07-15" }, CA, "2026-06-23");
    expect(w!.arrivalDate).toBe("2026-07-15");
    // 08:00 PST = 16:00 UTC. VERIFY these exact ISO strings against dayjs output; if dayjs
    // differs, the discrepancy is a real tz finding — investigate before adjusting.
    expect(w!.bookingOpensAt).toBe("2026-01-15T16:00:00.000Z");
    expect(w!.reminders.sevenDaysBefore).toBe("2026-01-08T17:00:00.000Z");   // 09:00 PST
    expect(w!.reminders.nightBefore).toBe("2026-01-15T04:00:00.000Z");       // 20:00 PST day-before
    expect(w!.reminders.tenMinutesBefore).toBe("2026-01-15T15:50:00.000Z");  // 07:50 PST
  });
});
```

- [ ] **Step 2: Run → fail.** `cd /Users/nimajelveh/campbrain && bun --filter @campbrain/core test booking-window`

- [ ] **Step 3: Implement** `packages/core/src/rules/booking-window.ts`:
```ts
import dayjs from "dayjs";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore.js";
import type { TargetDatePattern, BookingRule, BookingWindow } from "@campbrain/types";
import { getBookingWindowTime, getReminderTimes } from "../utils/dates";

dayjs.extend(isSameOrBefore);

function iterateDays(from: string, to: string, weekendsOnly: boolean): string[] {
  const dates: string[] = [];
  let cur = dayjs(from);
  const end = dayjs(to);
  while (cur.isSameOrBefore(end)) {
    const dow = cur.day();
    if (!weekendsOnly || dow === 5 || dow === 6) dates.push(cur.format("YYYY-MM-DD"));
    cur = cur.add(1, "day");
  }
  return dates;
}

export function expandArrivalDates(pattern: TargetDatePattern, today: string): string[] {
  switch (pattern.kind) {
    case "exact":
      return [pattern.date];
    case "range":
      return iterateDays(pattern.from, pattern.to, pattern.weekendsOnly);
    case "rolling_weekends": {
      const dates: string[] = [];
      let cur = dayjs(today).add(1, "day");
      let found = 0;
      while (found < pattern.weeks) {
        if (cur.day() === 5) {
          dates.push(cur.format("YYYY-MM-DD"));                 // Friday
          dates.push(cur.add(1, "day").format("YYYY-MM-DD"));   // Saturday
          found++;
          cur = cur.add(7, "day");
        } else {
          cur = cur.add(1, "day");
        }
      }
      return dates;
    }
  }
}

export function computeBookingWindows(pattern: TargetDatePattern, rule: BookingRule, today: string): BookingWindow[] {
  return expandArrivalDates(pattern, today).map((arrivalDate) => {
    const open = getBookingWindowTime(arrivalDate, rule.monthsBefore, rule.releaseTime, rule.timezone);
    const r = getReminderTimes(open);
    return {
      arrivalDate,
      bookingOpensAt: open.toISOString(),
      reminders: {
        sevenDaysBefore: r.sevenDaysBefore.toISOString(),
        nightBefore: r.nightBefore.toISOString(),
        tenMinutesBefore: r.tenMinutesBefore.toISOString(),
      },
    };
  });
}
```
In `packages/core/src/index.ts` add `export * from "./rules/booking-window";`

- [ ] **Step 4: Run + typecheck + commit**
```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/core test booking-window && bun --filter @campbrain/core typecheck && git add packages/core/src/rules/booking-window.ts packages/core/src/index.ts packages/core/src/rules/booking-window.test.ts && git commit -m "feat(core): reservation-window engine (expandArrivalDates + computeBookingWindows)"
```
Expected: PASS. If the exact ISO assertions fail, compute the real dayjs values, confirm they're 6-months-before at 08:00 in the target tz (the BEHAVIOR is what matters), and update the expected strings to the verified values — note any surprise.

---

## Task 4: `@campbrain/db` targets store (user-scoped) + isolation tests

**Files:** Create `packages/db/src/queries/targets.ts`; Modify `packages/db/src/index.ts`; extend `packages/db/test/targets.test.ts`.

**Copy `packages/db/src/queries/saved-searches.ts` almost verbatim**, swapping `saved_searches`→`targets`, the `definition` shape (`{ scope, datePattern, bookingRule }`), and the columns (`enabled`/`calendar_enabled` instead of `alert_enabled`/`email_enabled`). Functions: `listTargets(db, userId)`, `getTarget(db, id, userId)`, `createTarget(db, userId, input)` (forces `user_id`, ignores `input.userId`), `updateTarget(db, id, userId, patch)` (ownership-checked → throws not-found cross-user), `deleteTarget(db, id, userId)` (no-op cross-user), `setTargetEnabled(db, id, userId, enabled)`. Validate via `TargetInputSchema`. `definition` written as `${JSON.stringify(def)}::jsonb`.

- [ ] **Step 1: Append the failing isolation test** to `packages/db/test/targets.test.ts` (mirror `packages/db/test/saved-searches`-style isolation from the 2a store test): create for userA + userB; `getTarget`/`updateTarget`/`deleteTarget`/`setTargetEnabled` enforce ownership (cross-user → undefined / throws / no-op); `listTargets` scopes to owner.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `packages/db/src/queries/targets.ts` (port of `saved-searches.ts`; read it for the exact `rows`/`QueryDb`/`SELECT_COLS`/`rowToX`/`toDefinition` patterns). Barrel: add `export * from "./queries/targets";` to `packages/db/src/index.ts`.
- [ ] **Step 4: Run + typecheck + commit**
```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/db test targets && bun --filter @campbrain/db typecheck && git add packages/db/src/queries/targets.ts packages/db/src/index.ts packages/db/test/targets.test.ts && git commit -m "feat(db): user-scoped targets store"
```

---

## Task 5: `targets` tRPC router (protected, user-scoped) + `upcoming`

**Files:** Create `apps/api/src/trpc/routers/targets.ts`; Modify `apps/api/src/trpc/router.ts`; Test `apps/api/test/targets-router.test.ts`.

Mirror `apps/api/src/trpc/routers/saved-searches.ts`. All `protectedProcedure`, `ctx.userId`-scoped: `list`, `create(TargetInputSchema)`, `update({id, patch: TargetInputSchema.partial()})`, `delete({id})`, `setEnabled({id, enabled})`. Plus `upcoming`:

- [ ] **Step 3 (impl)** `apps/api/src/trpc/routers/targets.ts`:
```ts
import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { TargetInputSchema, type UpcomingTarget } from "@campbrain/types";
import { listTargets, createTarget, updateTarget, deleteTarget, setTargetEnabled } from "@campbrain/db";
import { computeBookingWindows } from "@campbrain/core";

function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
function scopeLabel(scope: { parkName: string | null; campgroundName: string | null }): string {
  return [scope.parkName, scope.campgroundName].filter(Boolean).join(" — ") || "Any park";
}

export const targetsRouter = router({
  list: protectedProcedure.query(({ ctx }) => listTargets(ctx.db, ctx.userId)),
  create: protectedProcedure.input(TargetInputSchema).mutation(({ ctx, input }) => createTarget(ctx.db, ctx.userId, input)),
  update: protectedProcedure.input(z.object({ id: z.string(), patch: TargetInputSchema.partial() }))
    .mutation(({ ctx, input }) => updateTarget(ctx.db, input.id, ctx.userId, input.patch)),
  delete: protectedProcedure.input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => { await deleteTarget(ctx.db, input.id, ctx.userId); return { id: input.id }; }),
  setEnabled: protectedProcedure.input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => { await setTargetEnabled(ctx.db, input.id, ctx.userId, input.enabled); return { id: input.id, enabled: input.enabled }; }),
  upcoming: protectedProcedure.query(async ({ ctx }) => {
    const today = todayUtc();
    const nowMs = Date.now();
    const targets = await listTargets(ctx.db, ctx.userId);
    const out: UpcomingTarget[] = [];
    for (const t of targets) {
      if (!t.enabled) continue;
      const windows = computeBookingWindows(t.datePattern, t.bookingRule, today)
        .filter((w) => new Date(w.bookingOpensAt).getTime() > nowMs)
        .sort((a, b) => a.bookingOpensAt.localeCompare(b.bookingOpensAt));
      if (windows.length > 0) out.push({ targetId: t.id, name: t.name, scopeLabel: scopeLabel(t.scope), windows });
    }
    out.sort((a, b) => (a.windows[0]!.bookingOpensAt).localeCompare(b.windows[0]!.bookingOpensAt));
    return out;
  }),
});
```
Compose `targets: targetsRouter` into `apps/api/src/trpc/router.ts`.

- [ ] **Test** `apps/api/test/targets-router.test.ts` (mirror `saved-searches-router.test.ts`): UNAUTHORIZED without session; CRUD round-trip for the owner (`created.userId === "userA"`); isolation (userB can't list/update/delete userA's target); `upcoming` returns future windows only, for enabled targets, scoped to the caller. Seed a target with a far-future `exact` date so a window is guaranteed future.
- [ ] **Verify + commit**
```bash
cd /Users/nimajelveh/campbrain && bun --filter @campbrain/api test targets-router && bun --filter @campbrain/api typecheck && bun --filter @campbrain/api test && git add apps/api/src/trpc/routers/targets.ts apps/api/src/trpc/router.ts apps/api/test/targets-router.test.ts && git commit -m "feat(api): protected targets router + upcoming windows"
```

---

## Task 6: `/alerts` web surface ("Booking Reminders", gated)

**Files:** Create `apps/web/src/features/alerts/{TargetsPage,TargetModal}.tsx` + `components/{TargetCard,UpcomingWindows}.tsx` + `hooks/use-targets.ts`; Modify `apps/web/src/routes/alerts.tsx`.

Port the *intent* of `web/app/alerts/AlertsClient.tsx`, scoped to the user, Tailwind/shadcn, **vanilla tRPC client** (`api.targets.*.query/mutate` in `useQuery`/`useMutation`). **Reuse the `/saved` patterns** (`SavedSearchCard`/`SaveSearchModal`/`SavedPage`) — the shapes are near-identical.

**Module responsibilities + interfaces:**
- `hooks/use-targets.ts` — `useTargets()` → `{ targets, upcoming, isLoading, isError }` (two `useQuery`s over `api.targets.list` + `api.targets.upcoming`, queryKeys `["targets","list"]`/`["targets","upcoming"]`). Plus mutation helpers (create/update/delete/setEnabled) invalidating `["targets"]`.
- `components/TargetCard.tsx` — `{ target: Target; onEdit(t): void }`: name, scope label, date-pattern summary, enabled dot, **calendar toggle that is visually present but disabled with a "Calendar sync coming soon" tooltip** (the inert `calendar_enabled`), Edit / Delete / Enable-toggle (mutations invalidate `["targets"]`). (Port `SavedSearchCard`.)
- `components/UpcomingWindows.tsx` — `{ upcoming: UpcomingTarget[] }`: a chronological list — per target, each window's `bookingOpensAt` (locale + tz via `toLocaleString`) + the 3 reminder times; empty state ("No enabled reminders yet"). This is the `npm run upcoming` value as UI.
- `TargetModal.tsx` — create/edit: name; a park/campground label input (free-text label is acceptable for v1 — see spec open question O-1; a catalog picker can be a follow-up); a date-pattern editor (radio: exact date / range+weekendsOnly / rolling-weekends N); a collapsible "Booking rule" override (monthsBefore/releaseTime/timezone, defaults CA). Builds a `TargetInput`; `api.targets.create.mutate` / `update.mutate`; invalidates `["targets"]`. (Port `SaveSearchModal`.)
- `TargetsPage.tsx` — composition (RequireAuth is applied at the route): heading "Booking Reminders"; the `<UpcomingWindows/>` panel; the target list (`<TargetCard/>` + a "New reminder" button opening `<TargetModal/>`); loading/error/empty states; the Edit modal. (Port `SavedPage`.)
- `routes/alerts.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/features/auth/AuthGate";
import { TargetsPage } from "@/features/alerts/TargetsPage";
export const Route = createFileRoute("/alerts")({
  component: () => (<RequireAuth message="Sign in to manage your booking reminders."><TargetsPage /></RequireAuth>),
});
```
(NavBar already has an "Alerts" link → `/alerts`; keep it.)

- [ ] Steps: implement hooks → components → modal → page → route. Typecheck + build green. Commit `feat(web): booking-reminders /alerts surface`.
- [ ] **Visual verification (controller-run `preview_*`)** — reuse the 2a/2b-1 dev-stub harness (throwaway `createNodeDb` node server on :8787 + `VITE_DEV_STUB_SESSION=local-dev` + `ALLOW_DEV_SESSION`). Signed-in: create a target (e.g. a rolling-weekends reminder) → it lists; the Upcoming panel shows the computed booking-open time + reminders; the calendar toggle is present-but-disabled with the "coming soon" tooltip; Edit/Delete/Enable persist. Signed-out: `/alerts` shows the RequireAuth prompt.

---

## Task 7: Full-repo verification + cleanup

- [ ] Repo-wide `bun run typecheck` (8/8), `bun run test` (all pass; **the new targets/booking-window/targets-router integration tests RUN not skipped** — eyeball the isolation + UNAUTHORIZED + upcoming tests), `bun run build` (green).
- [ ] `grep -nE "targets:" apps/api/src/trpc/router.ts` confirms the router is exposed; confirm `/alerts` is no longer a stub.
- [ ] Worker dry-run (`apps/api`, `bunx wrangler deploy --dry-run`) builds clean (the new core/db imports use the existing neon path — Worker stays postgres-js-free).
- [ ] Remove any throwaway dev harness used for Task 6's visual pass; confirm the tree is clean (only intentional untracked files). Commit only if Steps surfaced fixes.

---

## Manual setup (human, after merge)
Apply the new `targets` migration to Neon: `DATABASE_URL='<neon>?sslmode=require' bun --filter @campbrain/db migrate`. (No secrets needed — 2b-2 has no external services. Calendar OAuth/secrets are 2b-3.)

## Deferred to 2b-3 (Google Calendar sync)
The `calendar_enabled` flag is inert in 2b-2. Calendar sync (per-user OAuth, `googleapis`, token storage, where-it-runs) needs the open decisions in the spec's "Phase 2b-3" section answered before it's planned.

## Self-Review
**Spec coverage:** targets table (T1) · Target/BookingRule/window schemas (T2) · core engine port + the previously-untested helpers covered (T3) · user-scoped store + isolation (T4) · protected router + `upcoming` (T5) · gated `/alerts` surface, calendar toggle inert (T6) · full-repo gates (T7). Calendar correctly deferred.
**Type consistency:** `TargetInput`/`Target` (T2) are what the store (T4) + router (T5) consume; `TargetDatePattern`/`BookingRule` (T2) feed `computeBookingWindows` (T3) called by the router's `upcoming` (T5) and returned as `UpcomingTarget`/`BookingWindow` (T2) to the web hook (T6). `listTargets`/`createTarget`/… signatures (T4) are exactly those imported in T5.
**Placeholder scan:** backend tasks carry full code; the web task gives responsibilities + interfaces + legacy `Saved*` reuse pointers (same approach as the 2a/2b-1 plans). The one soft spot — the exact booking-open ISO assertions in T3 — is explicitly flagged to verify against dayjs (behavior, not magic strings, is the contract).
