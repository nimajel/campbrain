# CampBrain — System Overview

**Status:** shipped

CampBrain is a personal-use camping reservation assistant. It is **not** an automated booking bot — the user completes all bookings manually. See [CLAUDE.md](../../CLAUDE.md) for the full guardrails list.

---

## System shape

Two tiers run independently and communicate only through Postgres:

**Tier 1 — Proactive Scanner** (`npm run worker`)
- Long-running background process. Scans all parks on startup, then on a configurable interval (default 2 hours via `CAMPBRAIN_PROACTIVE_INTERVAL_MINUTES`).
- Covers a 180-day booking window by issuing one fetch per 8-day sub-window per park.
- Writes raw per-site per-day availability into Postgres.

**Tier 2 — Web App** (`npm run dev`, port 3001)
- Next.js 14 server + client. Reads from Postgres. Never issues provider fetches directly (except via the manual "Refresh now" / on-demand scan API).
- Seven nav links: Dashboard (`/`), Find Campsites (`/explore`), Map (`/map`), Alerts (`/alerts`), Scan History (`/scan-history`), Calendar (`/calendar`), Settings (`/settings`).

---

## Data flow

```
Provider API                  Scanner Tier               Postgres                 Web Tier
(parks.ca.gov / rec.gov)  →   fetchWindow()          →   scan_windows             GET /api/search
                          →   upsertEntry()          →   + availability      →    GET /api/map/*
                                                     →   mv_available_stays  →    (refreshed after scan)
                                                                             →    Surface pages
```

Step by step:
1. **Provider** — CA Parks (`AvailabilityInfo?arrival_date&length=1&page_id=…`) or Rec.gov (RIDB API) returns an 8-column availability grid.
2. **Scanner** — parses the grid, builds an `AvailabilityWindowEntry`, and calls `upsertEntry()` which writes rows to `scan_windows` + `availability`.
3. **Materialized view** — `mv_available_stays` is refreshed after each scan batch. It precomputes 1N and 2N stay records so the web tier never needs to re-derive them.
4. **API routes** — Next.js route handlers read from the MV or directly from `availability` (for the map detail panel). See [api.md](api.md).
5. **Surfaces** — React pages consume the API routes. Filtering and presentation happen client-side on `/explore`; pin-lighting on `/map` uses a server-side `FILTER_SQL` pass.

---

## Glossary

| Term | Definition |
|---|---|
| **window** | An 8-day scan span. The scanner always fetches 8 columns (the parks.ca.gov API maximum). A window is keyed by `(provider_id, park_page_id, window_start)` in `scan_windows`. |
| **stay** | A contiguous span of 1 or 2 nights on a reservable site starting on `arrival_date`. The MV stores one row per `(park, campground, arrival_date, nights)`. |
| **walk-up** | A hike/bike campsite that is first-come / non-reservable. Detected by the regex `\bhike\s*[/&]?\s*bike\b` on site name. Walk-up sites appear with a badge on the UI but are excluded from bookable counts and `available_sites`. |
| **page_id** | CA Parks' integer park identifier used in the `AvailabilityInfo` endpoint. Also used as `park_page_id` in Postgres. Rec.gov uses its own facility ID in the same column. |
| **materialized view** | `mv_available_stays` — a Postgres precomputed table of 1N/2N stays. Must be refreshed after scan writes (`refreshMaterializedView()`) and rebuilt after schema changes (`rebuildMaterializedView()` / `npm run db:rebuild-mv`). |

---

## Guardrails

CampBrain explicitly does not:
- Bypass CAPTCHAs, queues, or checkout flows
- Automate login
- Rotate proxies
- Poll more frequently than every 60–120 minutes under normal conditions

See [CLAUDE.md](../../CLAUDE.md) for the full "Do not implement" list.

---

## Dependencies

- [CLAUDE.md](../../CLAUDE.md) — conventions, guardrails, and Next Steps roadmap
- [data-model.md](data-model.md) — Postgres schema and shared TypeScript types
- [api.md](api.md) — API route contracts
