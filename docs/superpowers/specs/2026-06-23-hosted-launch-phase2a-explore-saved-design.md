# CampBrain Hosted Launch — Phase 2a (Explore + Saved) Design

**Status:** Approved design (2026-06-23). Drives the Phase 2a implementation plan.
**Depends on:** Phase 1 (deployed live map; `@campbrain/db` read layer; `@campbrain/types` saved-search DTOs; BetterAuth + allowlist-gated sign-in).
**Master spec:** `docs/superpowers/specs/2026-06-17-hosted-launch-design.md` (Phase 2 = feature parity, multi-user).

## Goal

Port the legacy `/explore` (availability search) and `/saved` (saved-search management) surfaces to the Vite + tRPC app, and stand up the **multi-user auth keystone** (`protectedProcedure` + per-`user_id` data isolation) that every personal feature in Phase 2/3 builds on. Done = anyone can search availability on `/explore`; an allowlisted signed-in user can save searches and manage them on `/saved`, seeing only their own data.

Phase 2 is decomposed into **2a (this spec): Explore + Saved** and **2b: Alerts + Dashboard** (the alert scanner, per-user `targets`, `scan_runs`/hit-state tables, Resend email, dashboard). Calendar-token sync remains Phase 3.

## Decisions (locked with the user, 2026-06-23)

1. **Access boundary: public search, gated save.** `/explore` search is public (like the map); only "Save this search" + the `/saved` surface require an (allowlisted) session.
2. **`protectedProcedure` is session-only.** Because the allowlist is enforced at sign-in (Phase 1d-1), *having a session ⇒ allowlisted*; no per-request allowlist re-check. (Re-check is a later additive middleware if ever needed — see Auth gating architecture.)
3. **Alert on/off toggle ships now as an inert flag.** 2a persists `alert_enabled` + renders the toggle; the actual alert scanning + Resend email is Phase 2b. Toggling has no functional effect until 2b.
4. **Faithful full port, Tailwind v4 + shadcn** — same conventions as the Phase 1d-2 map (no legacy custom CSS; reuse the map's already-ported pieces where shared, e.g. the site-filter panel + region/taxonomy helpers).

## Auth gating architecture (the modularity contract)

Gating is **centralized + declarative**, in two small places — never inline `if (session)` checks scattered through handlers/components. This keeps the public/gated boundary a one-line change and lets new tiers compose additively.

### Backend — one composable middleware (`apps/api/src/trpc/trpc.ts`)

```ts
const requireSession = t.middleware(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { userId: ctx.session.user.id } }); // type-narrows: userId now non-null
});
export const publicProcedure    = t.procedure;
export const protectedProcedure = t.procedure.use(requireSession);
// future tiers compose WITHOUT touching existing handlers:
//   allowlistedProcedure = protectedProcedure.use(requireAllowlistRecheck)
//   adminProcedure       = protectedProcedure.use(requireRole("admin"))
```
- A handler declares its tier by **which builder** it uses (`publicProcedure` vs `protectedProcedure`). Flipping a procedure public↔gated is a one-word change at its definition.
- `ctx.userId` is injected once and type-narrowed, so handlers read `ctx.userId` (never re-derive identity from `ctx.session`).
- **This is the real enforcement boundary** — the server rejects unauthorized calls regardless of the UI.

### Frontend — one auth-gate primitive + one session source (`apps/web/src/features/auth/`)

```tsx
// single source of truth: useSession() (BetterAuth, wired in Phase 0)
export function AuthGate({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { data: session, isPending } = useSession();
  if (isPending) return null;            // or a skeleton
  return session ? <>{children}</> : <>{fallback ?? null}</>;
}
```
- Gated UI is declarative at the call site: `<AuthGate fallback={<SignInPrompt/>}><SaveSearchButton/></AuthGate>`.
- `/saved` wraps its content in `<RequireAuth>` (an `AuthGate` whose fallback is a full sign-in prompt). Frontend gating is **UX only**; the backend `protectedProcedure` is the security.
- A hard router guard (TanStack Router `beforeLoad` redirect) is intentionally **not** required in 2a — the component gate is simpler and needs no router-context session plumbing. If hard guards are wanted later, the same `useSession` source feeds a `beforeLoad`; no rework of the gate logic.

### How it changes later (the detangle test)

| Change | Touch |
|---|---|
| Make all of `/explore` gated | `search`: `publicProcedure`→`protectedProcedure`; wrap `/explore` content in `<RequireAuth>` |
| Re-check allowlist per request | add `requireAllowlistRecheck` middleware → `allowlistedProcedure`; switch the handlers that need it |
| Roles / "pro" tier | add a role middleware + a `<RequireRole>` gate; existing handlers untouched |
| Public signup (Phase 3) | nothing in gating changes — only the allowlist gate at *sign-in* is removed |

No heavyweight policy/feature-flag engine (YAGNI) — middleware composition + the auth-gate component IS the modular approach.

## Scope

**In 2a:**
- `protectedProcedure` middleware + `ctx.userId` injection.
- `@campbrain/db/queries/saved-searches.ts` — the saved-search store ported from `src/saved-search/store.ts`, **user-scoped + ownership-checked**.
- tRPC: `search` (public) + `savedSearches` router (`list`/`create`/`update`/`delete`/`toggleAlert`, protected, user-scoped). Composed into `appRouter`.
- `@campbrain/types`: a `SearchInputSchema` (region/from/to/access/kinds/hide/minNights). `SavedSearchInputSchema` already exists.
- `apps/web`: `/explore` (search UI port) + `/saved` (saved-search management port) + the `features/auth/` gate primitives + "Save this search".
- Tests: store user-isolation + ownership; `protectedProcedure` rejects no-session; `search` + `savedSearches` `createCaller` integration; visual verification via `preview_*`.

**Deferred:**
- Alert *scanning* + Resend email (2b — the toggle is inert until then).
- `/alerts` (booking-window targets → per-user `targets` table) + calendar sync (2b / P3).
- Dashboard + `scan_runs`/hit-state tables (2b).
- Per-request allowlist re-check / roles (additive later, not now).

## Backend

### Saved-search store → `@campbrain/db/queries/saved-searches.ts`
Port from `src/saved-search/store.ts` (Drizzle, `db.execute(sql\`\`)` via the established `rows()` normalizer), making `user_id` **required** and **ownership-enforced**:
- `listSavedSearches(db, userId)` — only this user's rows (the `idx_saved_searches_user` index already exists).
- `createSavedSearch(db, userId, input: SavedSearchInput)` — sets `user_id = userId`.
- `getSavedSearch(db, id, userId)` / `updateSavedSearch(db, id, userId, patch)` / `deleteSavedSearch(db, id, userId)` — all filter `WHERE id = $id AND user_id = $userId` (a cross-user id resolves to "not found", never another user's data).
- `setAlertEnabled(db, id, userId, enabled: boolean)` — flips `alert_enabled` (data only in 2a).
- `listAlertEnabledSavedSearches(db)` — un-scoped, reserved for the 2b scanner (not exposed via tRPC).

### tRPC procedures
- **`search`** (`publicProcedure`, `apps/api/src/trpc/routers/search.ts`): `.input(SearchInputSchema)` → `searchAvailableStays(ctx.db, …)` (+ `findNextAvailableDates` for the alternate-dates fallback). Returns stays grouped by park (parity with legacy `GET /api/search`).
- **`savedSearches`** (`protectedProcedure`, `apps/api/src/trpc/routers/saved-searches.ts`): `list` / `create` / `update` / `delete` / `toggleAlert`, each calling the user-scoped store with `ctx.userId`.
- Both composed into `appRouter` alongside `health` + `map`. `AppRouter` inference flows the new procedures to `@campbrain/api-client`.

### Data isolation (the multi-user keystone)
`user_id` is sourced **only** from `ctx.userId` (the session), never from client input. Every saved-search read/write is filtered by it. This is the "invitees see only their own data" guarantee, and the store's ownership filter is the enforcement point (covered by an explicit isolation test).

## Frontend (`apps/web`, Tailwind/shadcn, faithful port)

```
apps/web/src/
  routes/explore.tsx               MODIFY/CREATE: render <ExplorePage/>
  routes/saved.tsx                 CREATE: render <RequireAuth><SavedPage/></RequireAuth>
  features/auth/
    AuthGate.tsx                   AuthGate + RequireAuth + SignInPrompt (useSession)
  features/explore/
    ExplorePage.tsx                composition: filters + results, drives the public `search` query
    hooks/use-explore-filters.ts   date range / region / taxonomy / minNights state
    hooks/use-search.ts            api.search via useQuery (debounced filter snapshot)
    components/                     RegionChips, ResultsList (collapsed park cards), ParkCard,
                                    FallbackDates, SaveSearchButton (in <AuthGate>)
    SaveSearchModal.tsx            captures live filter state → savedSearches.create
  features/saved/
    SavedPage.tsx                  lists savedSearches.list; per-card Run/Edit/Alert/Delete
    components/SavedSearchCard.tsx
  lib/                             reuse map's site-taxonomy + booking-url + regions where shared
```
- **`/explore`**: the public `search` query drives collapsed park cards (parity perf strategy), pricing, Book links, the alternate-dates fallback. The site-filter panel + region/taxonomy helpers are **reused from `features/map`** (don't duplicate). "Save this search" renders only inside `<AuthGate>`.
- **`/saved`**: `<RequireAuth>`-wrapped; lists the user's searches with Run (→ `/explore` prefilled for `fixed_range`, or `/map?weekendsOnly=true` for `any_weekend`), Edit, the (inert-until-2b) Alert toggle, Delete; empty state; sign-in prompt when unauthenticated.
- Data via the vanilla tRPC client + TanStack Query (`api.search.query` / `api.savedSearches.*`), matching the map's pattern; mutations invalidate the `savedSearches.list` query.

## Testing & verification

- **Integration (`createCaller` vs local PG):** `search` returns stays for a date range; `savedSearches` full CRUD with a stub session (`ctx.userId = "userA"`); **isolation test** — userA cannot `get`/`update`/`delete` userB's search (resolves to not-found); `protectedProcedure` throws `UNAUTHORIZED` with `session: null`.
- **Unit:** `SearchInputSchema` accept/reject; the store's ownership-filter SQL.
- **Visual (`preview_*`):** `/explore` search renders + filters re-query + Book links inject correct dates; signed-out shows no Save button; signed-in can Save → appears on `/saved`; `/saved` Run/Edit/Delete; signed-out `/saved` shows the sign-in prompt. (Local sign-in uses the same throwaway-node-tRPC + `createNodeDb` workaround noted for the map, since `wrangler dev` can't reach local PG; auth in local visual checks may be stubbed.)
- Full-repo gates: `bun run typecheck` / `test` / `build`.

## Risks / notes

- **Local auth in visual verification:** the map's local-dev DB workaround (throwaway node tRPC + `createNodeDb`) stubbed `get-session` → null. For 2a's gated flows, local visual checks need a way to simulate a signed-in session (stub `useSession`/session, or a local session row). The plan must specify this so `/saved` is actually verifiable locally.
- **Reuse vs duplication:** the site-filter panel, taxonomy, region, and booking-url helpers already exist in `features/map` / `@campbrain/core` — 2a must reuse them, not fork. Plan should verify each before creating.
- **Legacy store semantics:** `src/saved-search/store.ts` `listSavedSearches(userId?)` treated `userId` as optional (single-user). The port makes it required; confirm no legacy assumption (e.g. `null` user) leaks into the multi-user path.
- **`/explore` ↔ `/saved` Run round-trip:** the saved-search `scope`/`datePattern`/`filters` shape (from `@campbrain/types`) must round-trip cleanly between Save (on `/explore`) and Run (back to `/explore` or `/map`) — covered by the existing DTO schemas.
