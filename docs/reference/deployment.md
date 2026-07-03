# CampBrain — Deployment

**Status:** Phase 1 live (Cloudflare hosted stack, `hosted-launch` branch); local Next.js app
still functional on `main`.

---

## Hosted deployment (Cloudflare — active, `hosted-launch`)

Phase 1 is **deployed live** at `https://campbrain-api.jelvehn.workers.dev`.

### Architecture

A single Cloudflare Worker (`apps/api`, name `campbrain-api`) serves **both** the built
Vite SPA and the tRPC + BetterAuth API from one origin:

- The built `apps/web/dist` directory is bound to the Worker via `[assets]`
  (`binding = "ASSETS"`, `not_found_handling = "single-page-application"`).
- API routes (`/trpc/*`, `/api/auth/*`, `/health`) are handled by the Hono worker.
- Non-API, non-asset requests fall through to index.html (SPA client-side routing).
- Same-origin = first-party `SameSite=Lax` cookies; no custom domain or Cloudflare Pages
  is required. If a custom domain is added later, a Pages + Worker split can be revisited.

**Database:** Neon (managed Postgres). Drizzle ORM + migrations. Schema includes the full
availability cache (`parks`, `campgrounds`, `sites`, `scan_windows`, `availability`,
`mv_available_stays`, `park_digests`) plus auth tables (BetterAuth), `access_allowlist`, and
`saved_searches`.

**Auth:** BetterAuth with Google OAuth. An `access_allowlist` table gates sign-in;
non-allowlisted users see a request-access screen.

**Scanner:** GitHub Actions (`Proactive Scan` workflow, `.github/workflows/scan.yml`),
cron `0 */6 * * *` (every 6 h, UTC, best-effort). The Cloudflare Worker free plan's 10 ms
CPU cap makes the cheerio-based parser unviable in a Worker; GitHub Actions runners have no
such limit. Steps: apply pending DB migrations → idempotently seed the catalog (CA + Rec.gov
parks) → run the scan. The scan runs **two provider passes** — CA State Parks first (own MV
refresh, digest build, alerts, calendar sync), Recreation.gov last (own MV refresh + digest
build, ~95–155 min at its polite 1.5 s-per-request cadence) — plus a stale-`scan_runs`
cleanup guarding against a previously killed run. Timeout: 300 minutes, sized for the
combined worst case. The `DATABASE_URL` secret is set in GitHub repo settings.

The repo is **public** at `github.com/nimajel/campbrain`; the **default branch is
`hosted-launch`** (so the scanner cron and workflow_dispatch trigger from it automatically).

---

### Deploy procedure

1. **Build the SPA** (set `VITE_API_URL` to the Worker origin):
   ```bash
   VITE_API_URL=https://campbrain-api.jelvehn.workers.dev \
     bun --filter @campbrain/web build
   ```
   Output lands in `apps/web/dist/`.

2. **Deploy the Worker** (also uploads `apps/web/dist` via the `[assets]` binding):
   ```bash
   cd apps/api
   bunx wrangler deploy
   ```

3. **Set Worker secrets** (one-time; persisted in Cloudflare):
   ```bash
   bunx wrangler secret put DATABASE_URL
   bunx wrangler secret put BETTER_AUTH_SECRET
   bunx wrangler secret put GOOGLE_CLIENT_ID
   bunx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
   `WEB_ORIGIN` and `BETTER_AUTH_URL` are `[vars]` in `apps/api/wrangler.toml` (not
   secrets; set to the Worker origin `https://campbrain-api.jelvehn.workers.dev`).

---

### Database setup (Neon)

Run migrations and seed the catalog **against Neon**, not local Postgres:

```bash
# Apply Drizzle migrations + create the materialized view
DATABASE_URL='<neon-connection-string>?sslmode=require' \
  bun --filter @campbrain/db migrate

# Seed the CA parks catalog into Neon
DATABASE_URL='<neon-connection-string>?sslmode=require' \
  bun --filter @campbrain/db seed:catalog

# Seed the access allowlist (add permitted email addresses)
DATABASE_URL='<neon-connection-string>?sslmode=require' \
  bun --filter @campbrain/db seed:allowlist
```

The availability data regenerates automatically once the scanner runs — no data migration
from the local Postgres instance is needed.

---

### Scanner

The scanner runs via **GitHub Actions** (`Proactive Scan`). To trigger manually:
Actions tab → Proactive Scan → Run workflow.

To add the `DATABASE_URL` secret: repo → Settings → Secrets and variables → Actions →
New repository secret → `DATABASE_URL` = the Neon connection string.

After a successful run, confirm data: `SELECT MAX(scanned_at) FROM scan_windows;` and
`SELECT COUNT(*) FROM availability;` against Neon should be recent and non-zero.

Debug HTML from unexpected parser responses is uploaded as a `scan-debug-<run_id>`
Actions artifact (retained 7 days).

---

### Monorepo shape (hosted-launch)

```
apps/
  web/          Vite + React SPA (TanStack Router, Tailwind/shadcn, Leaflet)
  api/          Hono Worker: tRPC + BetterAuth + Cloudflare [assets] SPA serving
  scanner/      Bun script run by GitHub Actions (proactive CA-parks scan)
packages/
  core/         Provider adapters, scanner window logic, site-classifier, rules, catalog
  db/           Drizzle schema + queries + migrations (Neon + local Postgres)
  types/        Shared Zod schemas + DTOs
  api-client/   Typed tRPC client wrapper for apps/web
  config/       Shared tsconfig / env schema / Zod env helpers
```

---

### Local development (hosted stack)

```bash
# Start local Postgres (for db migrations / integration tests)
docker compose -f docker-compose.dev.yml up -d

# Install dependencies
bun install

# Apply migrations to local Postgres
DATABASE_URL='postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain' \
  bun --filter @campbrain/db migrate

# Run the Worker locally (wrangler dev) — reads apps/api/.dev.vars for secrets
cd apps/api && bunx wrangler dev

# Run the Vite dev server (separate terminal)
bun --filter @campbrain/web dev
```

**Useful commands:**
```bash
bun run typecheck       # Turborepo: typecheck all packages
bun run test            # Turborepo: run all Vitest suites
bun run build           # Turborepo: build all packages
bun --filter @campbrain/db test           # db package tests only
bun --filter @campbrain/scanner start     # run proactive scan locally
```

---

## Local deployment (legacy Next.js — `main` branch)

The original local-only app lives on `main` and remains fully functional as a reference.

### 1. Postgres (via Docker)

```bash
docker compose up -d
```

Uses `docker-compose.yml` at the repo root:
- Image: `postgres:16`
- Container name: `campbrain-postgres`
- Port: `5432` (host-mapped)
- Database: `campbrain` / user: `campbrain`
- Data persisted to Docker volume `campbrain_pgdata`

### 2. Schema initialisation (run once, or after schema changes)

```bash
npm run db:init          # create tables + materialized view (idempotent)
npm run db:rebuild-mv    # drop + recreate mv_available_stays (after MV schema changes only)
```

### 3. Scanner worker

```bash
npm run worker
```

Starts the proactive scanner (`src/cli/index.ts worker`). Scans all parks immediately on
startup, then repeats on the interval set by `CAMPBRAIN_PROACTIVE_INTERVAL_MINUTES`
(default 120 minutes). Runs as a long-lived foreground process.

### 4. Web app

```bash
npm run dev
```

Starts the Next.js dev server (`web/`) on port **3001**. API routes and server components
access Postgres directly via `DATABASE_URL`.

### Environment variables (local / `main`)

Config lives in a root `.env` file. `web/next.config.ts` reads it at startup and injects
matching variables into the Next.js process. Do not commit `.env`.

| Key | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (`postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain`) |
| `RIDB_API_KEY` | Recreation.gov RIDB API key (only for `npm run catalog:refresh -- --provider=recreation-gov`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID for Calendar sync |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth redirect URI |
| `CAMPBRAIN_PROACTIVE_INTERVAL_MINUTES` | Proactive scan interval in minutes (default 120, minimum 15) |
| `CAMPBRAIN_SCAN_INTERVAL_MINUTES` | Alert-scan interval in minutes (default 60, minimum 15) |
| `CAMPBRAIN_SCAN_ON_START` | `false` to skip alert scan on startup (default: scan on start) |
| `RESEND_API_KEY` | Resend API key for email alert notifications |
| `ALERT_EMAIL_TO` | Recipient address for availability alert emails |
| `ALERT_EMAIL_FROM` | Sender address (must be verified in Resend) |

### Useful dev commands (local / `main`)

```bash
npm run scan             # one-off availability scan
npm run cache:refresh    # refresh mv_available_stays
npm run catalog:refresh  # discover / update CA state park catalog
npm run upcoming         # print upcoming booking windows for configured targets
npm run typecheck        # TypeScript check
npm test                 # Vitest suite
npm run verify           # typecheck + test + upcoming + scan + web build
```

---

## Dependencies

- [engines/scanner.md](engines/scanner.md) — scanner process documentation
- [engines/cache.md](engines/cache.md) — Postgres schema and MV refresh
