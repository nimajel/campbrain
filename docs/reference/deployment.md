# CampBrain — Deployment

**Status:** partial (local shipped; hosted planned)

---

## Current (local)

CampBrain runs entirely on a developer's laptop. Three processes are started manually:

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

Starts the proactive scanner (`src/cli/index.ts worker`). Scans all parks immediately on startup, then repeats on the interval set by `CAMPBRAIN_PROACTIVE_INTERVAL_MINUTES` (defaults to 120 minutes if unset). Runs as a long-lived foreground process; keep it running while the web app is in use.

### 4. Web app

```bash
npm run dev
```

Starts the Next.js dev server (`web/`) on port **3001**. Requests to the Next.js server (API routes and server components) access Postgres directly via `DATABASE_URL`.

### Environment variables

Config lives in a root `.env` file. `web/next.config.ts` reads this file at startup and injects matching variables into the Next.js process so API routes can access them. Variables are not duplicated into `web/.env`.

Required / used keys:

| Key | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (e.g. `postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain`) |
| `RIDB_API_KEY` | Recreation.gov RIDB API key — required only to seed Rec.gov catalog (`npm run catalog:refresh -- --provider=recreation-gov`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID for Calendar sync |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth redirect URI |
| `CAMPBRAIN_PROACTIVE_INTERVAL_MINUTES` | Proactive park-scan interval in minutes — how often the worker rescans all parks into the Postgres cache (optional, default 120, minimum 15) |
| `CAMPBRAIN_SCAN_INTERVAL_MINUTES` | Alert-scan interval in minutes — how often the worker checks saved targets against the cache and fires notifications (optional, default 60, minimum 15) |
| `CAMPBRAIN_SCAN_ON_START` | Set to `false` to skip the alert scan on worker startup; any other value (or absent) runs a scan immediately (optional, default: scan on start) |
| `RESEND_API_KEY` | Resend API key for email alert notifications — required together with `ALERT_EMAIL_TO` and `ALERT_EMAIL_FROM`; if any of the three are absent the email step is silently skipped |
| `ALERT_EMAIL_TO` | Recipient address for campsite availability alert emails (required for email notifications) |
| `ALERT_EMAIL_FROM` | Sender address used by the Resend email service for alert emails — must be a domain verified in your Resend account (required for email notifications) |

Do not commit `.env` to source control.

### Useful dev commands

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

> Future: **Path to hosted deployment**
>
> The following is **not yet built** — it describes the migration shape when CampBrain moves from local to a hosted setup:
>
> - **Postgres:** replace the Docker-local instance with a managed Postgres service (e.g. Railway, Supabase, Fly.io Postgres, or RDS). Update `DATABASE_URL` to point at the managed instance.
> - **Web app:** deploy the Next.js app to a hosting platform that supports server-side rendering (e.g. Vercel, Fly.io, Railway). Set env vars via the platform's secrets manager rather than a local `.env`.
> - **Scanner worker:** the worker currently runs as a long-lived local process (`npm run worker`). For hosted deployment, convert it to a scheduled job (cron-triggered container or managed worker) that runs `tsx src/cli/index.ts scan` on the desired interval. There is no "always-on" process needed — the scanner is stateless apart from Postgres.
> - **`web/next.config.ts` env bridging:** the current bridging logic that reads `../env` is a monorepo dev convenience. In a hosted environment, set env vars directly on each service; the bridging code becomes a no-op since `DATABASE_URL` will already be present in `process.env`.
> - Flip this doc's `**Status:**` from `partial` to `shipped` once the hosted setup is live.

---

## Dependencies

- [engines/scanner.md](engines/scanner.md) — the worker process documented above
- [engines/cache.md](engines/cache.md) — Postgres schema init and MV refresh commands
