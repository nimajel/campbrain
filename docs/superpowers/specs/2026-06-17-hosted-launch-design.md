# CampBrain — Hosted Launch Design (Cloudflare-native rewrite)

**Date:** 2026-06-17
**Status:** Phase 0 SHIPPED + deployed 2026-06-19 (live: https://campbrain-api.jelvehn.workers.dev); Phases 1–3 pending
**Owner:** ritolaya

> **As-built deployment note (Phase 0):** the owner has no custom domain, so the planned
> "Cloudflare Pages (web) + separate Worker (api)" split — which would need a shared parent
> domain for first-party cookies — was replaced by a **single Worker that serves both the
> built Vite SPA (via `[assets]`) and the API, on one origin.** Same-origin ⇒ first-party
> `SameSite=Lax` cookies (no custom domain needed; `SameSite=None` caused an OAuth
> `state_mismatch` via browser third-party-cookie blocking). Pages is not used. If a custom
> domain is added later, the Pages+Worker split (or `app.`/`api.` subdomains) can be revisited.

> **Supersedes** the earlier draft of this file (a Vercel + Next.js + Neon + Railway
> *migration*). After choosing a standard stack, this is a **Cloudflare-native rewrite**
> on Bun/Turborepo: a Vite SPA + Hono Worker, with the domain logic salvaged into
> packages. The backend (DB layer, scanner) is re-platformed regardless of the frontend
> choice; only the web tier is a true UI rewrite.

---

## Goal

Take CampBrain from a local, single-user Next.js tool to a **hosted multi-user web app**
on Cloudflare, with Google sign-in and per-user data isolation. Scoped to a small invite
group at launch, on infrastructure that opens to the public later **by config change, not
rewrite**, and polished enough to be a **portfolio showcase** (clean public URL, public
read-only browsing, real auth, coherent modern stack).

The interactive **map becomes the home/front door**; the existing surfaces (`/explore`,
`/saved`, `/alerts`, dashboard) are kept and ported.

## Audience & success

- **Now:** owner + a few invited people; each has isolated saved searches/alerts;
  invite-only via an email allowlist.
- **Later:** open public signup (Phase 3) without re-architecture.
- **Always:** a deployed, public, demoable URL suitable for a job search.

**Phase 1 is the live portfolio milestone** (map running on the new stack at a clean URL).
**Phase 2 reaches feature parity** (all surfaces ported, multi-user). Done = invitees sign
in with Google, see only their own data, alert emails reach the right person, and the
proactive scanner runs entirely on Cloudflare.

## Locked decisions

| Decision | Choice |
|---|---|
| Database | **Neon (Postgres)** — preserves the materialized view, `text[]` arrays, JSONB |
| Scanner | **Cloudflare Cron Triggers + Queues** fan-out (one message per 8-day window) |
| API style | **tRPC** for the app + **minimal REST** (health/cron-internal/future webhooks) |
| Web tier | **Full Vite + shadcn rewrite**, delivered **map-first** as vertical slices |
| Auth | **BetterAuth** + Google social, Drizzle adapter, sessions in Neon |

## Non-goals (YAGNI)

- **No booking automation of any kind** — reaffirms CLAUDE.md guardrails (no CAPTCHA
  bypass, queue evasion, automated checkout, login automation, proxy rotation,
  high-frequency scraping). Assistant, not a bot.
- **Cut from the stack menu (don't fit a 2h-refresh personal app):** Stripe, WorkOS,
  Meilisearch/Typesense/Algolia (existing filters + Postgres FTS suffice), Sanity/
  Contentful, Svix, Vercel AI SDK, Durable Objects for realtime, Trigger.dev.
- No native mobile app; responsive web only.
- No SMS/Slack channels (separate roadmap item).
- No new provider adapters as part of this work.
- No public open signup at launch (Phase 3).

---

## Core principle: Neon is the only shared substrate

The web app (Cloudflare Pages/Worker) and the scanner (Cloudflare Worker cron+queues) are
**separate Workers with no filesystem at all**. The only thing both reach is **Neon**.
Therefore *all* shared and per-user state lives in Neon; the few filesystem artifacts move:

| State | Today | Action |
|---|---|---|
| Availability cache (`parks`, `campgrounds`, `sites`, `scan_windows`, `availability`, `mv_available_stays`) | Postgres, shared | Re-express in Drizzle; keep schema/MV |
| Saved searches (`user_id` exists, nullable; store user-aware) | Postgres | Drizzle; populate real `user_id` via auth |
| Alert hit-state + latest scan results | `.campbrain/state/*.json` | → Neon tables (`alert_hit_state`, `scan_runs`) — **required** (Workers have no FS) |
| Booking-window targets | `data/targets.json` | → per-user `targets` Neon table |
| Parser debug HTML snapshots | `.campbrain/debug/*.html` | → **Cloudflare R2** bucket |
| Google Calendar tokens | `.campbrain/google-token.json` | → per-user `calendar_credentials` table — **Phase 3** |

**Multi-tenancy stays cheap:** the proactive scanner is **global, not per-user** — one
shared availability copy for everyone. Adding users does **not** increase scraping load.

---

## Tech stack

- **Runtime/PM:** Bun · **Lang:** TypeScript (strict, no `any`) · **Monorepo:** Turborepo
- **Web (`apps/web`):** Vite + React · Tailwind + shadcn/ui + Radix · lucide-react ·
  React Router (or TanStack Router) · Leaflet/react-leaflet (ported) · Storybook
- **API (`apps/api`):** Hono on Cloudflare Workers · tRPC + minimal REST · Zod
- **Auth:** BetterAuth (Google social) + Drizzle adapter
- **DB/ORM:** Drizzle + Neon (Postgres); `@neondatabase/serverless` driver
  (neon-http for reads; neon-serverless/WebSocket for transactional scanner writes)
- **Background:** Cloudflare Cron Triggers + Queues (+ DLQ); R2 for debug snapshots
- **Email:** Resend (already integrated) · **Errors:** Sentry (web + worker) ·
  **Analytics/flags:** PostHog · **Logs:** Cloudflare Workers Logs (Axiom optional) ·
  **Spam (Phase 3):** Turnstile
- **Testing:** Vitest (unit) + Playwright (e2e) · **Deploy:** Wrangler (Workers + Pages) ·
  **Local parity:** Docker (local Postgres) + `wrangler dev` + `vite dev`, orchestrated by
  `turbo`

---

## Monorepo shape

```
apps/
  web/            Vite + React SPA (map home, explore, saved, alerts, dashboard)
  api/            Hono Worker: tRPC routers + REST + BetterAuth + cron/queue consumers
packages/
  ui/             shadcn/Radix/Tailwind shared components + Storybook (replaces custom CSS + 14 primitives)
  config/         shared tsconfig / env schema / Zod env helpers
  api-client/     typed tRPC client wrapper (consumed by apps/web)
  types/          shared Zod schemas + DTOs (migrated from src/*/types.ts, config/schemas.ts)
  core/           domain/engine: provider adapters, scanner window logic, site-classifier,
                  reservation-window rules, catalog, saved-search match  (salvaged from src/)
  db/             Drizzle schema + query layer + migrations  (replaces raw SQL in src/cache)
```

The cron handler + queue consumers live in `apps/api` and import `core` + `db`. Existing
CLI ops (db init, catalog refresh, backfill, target migrate) become Bun scripts using
`core`/`db` (`db` migrations via Drizzle Kit).

---

## Target architecture

```
   Google OAuth ─▶ ┌──────────────────────────┐
   (BetterAuth)    │ Cloudflare Pages + Worker │  apps/web (Vite SPA)
                   │  served via Hono / Pages  │  apps/api (Hono): tRPC + REST + auth
                   └─────────────┬────────────┘
                                 │ Drizzle / Neon serverless driver (SSL)
                                 ▼
                   ┌──────────────────────────┐
                   │   Neon — managed Postgres │◀── shared availability cache + MV
                   │   + BetterAuth tables     │    + per-user data + alert state
                   └─────────────▲────────────┘
                                 │ Drizzle / Neon (WebSocket, transactional)
   Cron (2h) ─▶ enqueue ─▶ ┌─────┴──────────────┐ ─▶ R2 (debug HTML)
   per 8-day window        │ apps/api Worker     │
   (~2000 msgs)            │  Queue consumer:    │ ─▶ Resend (per-user alert email)
   Cron (MV refresh)       │  scan 1 window →    │
   Cron (alert scan)       │  upsert Neon        │
                           └─────────────────────┘
```

---

## Database & Drizzle (Neon)

- Re-express the existing schema in Drizzle: `providers`, `parks`, `campgrounds`, `sites`
  (six classification columns), `scan_windows`, `availability`, `saved_searches`.
- **Materialized view** `mv_available_stays` (with `available_sites text[]` /
  `walk_up_sites text[]`): define via `pgMaterializedView` where possible; create/refresh
  via **raw SQL in Drizzle migrations** (Drizzle can't fully express MV + CONCURRENTLY).
  Port `rebuildMaterializedView` / `refreshMaterializedView` to Drizzle raw SQL.
- **Migrations:** Drizzle Kit (`generate` + `migrate`) replaces `db:init` / `db:rebuild-mv`.
  MV, partial indexes, and array columns go in custom SQL migration files.
- **Driver split:** neon-http for simple reads; **neon-serverless (WebSocket)** for the
  scanner's transactional/batched window upserts.
- **No data migration:** availability data regenerates every 2h, so **start fresh on Neon**
  and let the scanner repopulate. The handful of saved searches/targets are re-created or
  hand-seeded.

### New / changed tables

- BetterAuth tables (users, sessions, accounts, verification) — via its Drizzle adapter.
- `access_allowlist(email PK, added_at)` — invite gate.
- `targets` — per-user booking-window targets (replaces `data/targets.json`).
- `alert_hit_state` — per-saved-search hit-state (replaces `availability-hits.json`),
  carrying the v3 fields (`parkPageId`, `parkName`, `campgroundName`, `notifiedAt`).
- `scan_runs` — latest scan summary for the dashboard (replaces `latest-scan-results.json`).
- `calendar_credentials` — per-user Google tokens (**Phase 3**).
- `saved_searches` — no schema change; `user_id` now populated by auth.

---

## Auth & multi-tenancy (BetterAuth + Google)

- **BetterAuth** with the Google social provider and the Drizzle adapter; DB-backed
  sessions in Neon. Reuse the existing Google OAuth credentials; add the BetterAuth
  callback URL.
- **Invite gate:** a sign-in hook checks `access_allowlist`; non-allowlisted users land on
  a **request-access** screen. Phase 3 relaxes this to open signup.
- **Per-user scoping:** tRPC procedures read the session user; `saved_searches` and
  `targets` filter by `user_id`. `user_id IS NULL` rows act as a shared/seed tier during
  transition.
- **Per-user alert email:** recipient moves from the single `ALERT_EMAIL_TO` env to each
  user's email (`users.email`); `RESEND_API_KEY` / `ALERT_EMAIL_FROM` stay global.
- **Public read-only:** map + explore render for signed-out visitors (availability is
  public). Saving a search / enabling an alert prompts Google sign-in.

---

## Scanner in production (Cron + Queues)

Decoupled, CF-native, no completion-tracking needed:

- **Cron A — proactive enqueue (every `CAMPBRAIN_PROACTIVE_INTERVAL_MINUTES`, default
  120):** compute window starts (`generateWindowStarts` in `core`) and enqueue one message
  per `(parkPageId, windowStart)` (~2000) to the `scan-windows` Queue.
- **Queue consumer:** each message = one provider fetch + parse (`core` adapters) + upsert
  into Neon (one HTTP fetch + parse — well within Worker CPU limits). Failures retry; a
  **DLQ** captures persistent failures. Low-confidence parses write debug HTML to **R2**.
- **Cron B — MV refresh (every ~30–60 min):** `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
- **Cron C — alert scan (every `CAMPBRAIN_SCAN_INTERVAL_MINUTES`, default 60):** iterate
  alert-enabled saved searches across all users, dedupe via `alert_hit_state`, email each
  user via Resend, write a `scan_runs` summary.
- Polite-scraping behavior unchanged; cadence within documented limits.
- **Parser risk:** validate `cheerio` runs on Workers; fall back to `linkedom` or
  `HTMLRewriter` if not (planning task).

---

## API layer (Hono + tRPC)

- `apps/api` is a Hono Worker. tRPC router mounted under one route; BetterAuth handler
  mounted; minimal REST for `GET /health` and internal cron/queue endpoints.
- tRPC routers (Phase-aligned): `map` (catalog, availability, summary), `search`,
  `savedSearches` (CRUD/run/alert), `targets`, `dashboard`.
- `packages/types` holds the Zod schemas/DTOs (migrated from the current `zod` types);
  `packages/api-client` wraps the tRPC client (+ `@tanstack/react-query`) for `apps/web`.

---

## Map-as-home IA (Vite)

- **`/` → map** (the backbone). Router routes: `/` (map), `/explore`, `/saved`, `/alerts`,
  `/dashboard`.
- **Auth-aware nav:** avatar + sign-out when signed in; "Sign in with Google" otherwise.
- **Public read-only** map + explore; save/alert affordances prompt login.
- **shadcn/ui** replaces the custom CSS design system and the 14 hand-built primitives;
  Storybook re-pointed at the shadcn components in `packages/ui`.
- Ported as-is (framework-agnostic): `LeafletMap`, booking-url injection, site-filters,
  available-display, weekend-tier logic, regions, taxonomy defs.

---

## Production hardening

- **Secrets:** Wrangler secrets for `apps/api`; Cloudflare Pages env for `apps/web` build.
  The old `next.config.ts` `.env` bridging is gone.
- **Observability:** Sentry (web + worker), PostHog (analytics + feature flags), Workers
  Logs for the scanner.
- **Rate limiting + Turnstile + ToS/Privacy + parks.ca.gov/Rec.gov acceptable-use review:**
  Phase 3 gates before opening to the public. Low risk while invite-only.
- **Reliability:** Queue DLQ + alerting on the worker; `GET /health`; Neon automated
  backups (verify restore once).

---

## Branching & rollout

- **`main`** stays as the working **local Next.js app** (fallback + "what's built"
  reference) until the new stack reaches **feature parity (end of Phase 2)**.
- **`hosted-launch`** — long-lived integration branch; all rewrite work lands here as
  short-lived per-slice PRs.
- **Cloudflare Pages gives every branch a URL**, so the Phase 1 map can be **live and
  demoable on the `hosted-launch` Pages URL without merging to `main`.**
- **Git worktree:** keep a `main` checkout (local app) alongside a `hosted-launch`
  worktree (new stack) so both run without branch-switch churn.
- Merge `hosted-launch` → `main` at feature parity; the new stack becomes the trunk.

---

## Phased plan

> The implementation plan should target **Phase 0 + Phase 1 first** (foundation → live
> map). Phases 2–3 are planned in later passes.

### Phase 0 — Monorepo foundation & staging
- `hosted-launch` branch + worktree.
- Turborepo + Bun scaffold; `apps/{web,api}` + `packages/{ui,config,api-client,types,core,db}`.
- Neon project; Drizzle schema for the cache tables + MV; Drizzle Kit migrations.
- Wrangler config (Worker + Pages); deploy a trivial authed shell to a staging URL.
- BetterAuth + Google + allowlist gate (sign-in works).
- Docker local Postgres; `turbo`/Bun dev orchestration; CI (typecheck + Vitest) on PRs.
- Sentry + PostHog baseline.
- **Exit:** staging URL, Google sign-in works, empty authed shell, schema live on Neon.

### Phase 1 — Map-first vertical slice (LIVE milestone)
- `packages/core`: port CA-parks + Rec.gov adapters, catalog, scanner window logic,
  site-classifier, rules.
- `packages/db`: Drizzle queries backing the map (entries-for-parks, availability counts,
  summary, MV reads).
- Scanner v1: Cron enqueue → Queue consumer → Neon upsert; Cron MV refresh; R2 debug.
  Real availability data flowing.
- `apps/api`: tRPC `map` router (catalog, availability, summary) + `/health`.
- `apps/web`: map page on Vite + shadcn + Leaflet; auth-aware nav; public read-only;
  minimal per-user "save search" (proves auth + per-user data end-to-end).
- **Exit:** live map at a clean Cloudflare URL, real data via the CF scanner, Google login,
  per-user save works.

### Phase 2 — Port remaining surfaces (feature parity)
- `/explore` (search + filters + alternate-date fallback), `/saved` (full CRUD/run/alert),
  `/alerts` (targets table + per-user alert email + `alert_hit_state`), `/dashboard`
  (`scan_runs` + recent openings).
- Storybook on shadcn; Playwright e2e for key flows.
- Merge `hosted-launch` → `main`; new stack becomes trunk.
- **Exit:** full parity with the old app, multi-user, invite-only.

### Phase 3 — Public-ready (later)
- Open signup (relax allowlist / waitlist); Turnstile; rate limiting.
- ToS + Privacy; parks.ca.gov / Rec.gov acceptable-use review.
- Per-user Google Calendar tokens (`calendar_credentials`) → calendar sync.
- DLQ alerting, uptime monitor, backup-restore verification.
- **Exit:** anyone can sign up safely; abuse-protected; legally reviewed.

---

## Open questions (resolve during planning; defaults in parens)

1. **Parser runtime:** confirm `cheerio` works on Workers; else `linkedom` / `HTMLRewriter`.
   *(default: try cheerio, fall back to linkedom.)*
2. **Allowlist mechanism:** `access_allowlist` table vs. BetterAuth config hook.
   *(default: table + sign-in hook.)*
3. **Router:** React Router vs. TanStack Router. *(default: TanStack Router — typed.)*
4. **Logging:** Workers Logs vs. Axiom. *(default: Workers Logs; Axiom optional later.)*
5. **Data:** start fresh on Neon (recommended) vs. migrate existing rows.
   *(default: fresh; scanner repopulates.)*
6. **Custom domain** for the portfolio URL. *(default: add late, optional.)*
