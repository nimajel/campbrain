# Surface: / — Dashboard

**Status:** shipped

## Purpose

Landing page; shows active alert rows, recent availability hits, and latest scan summary, backed entirely by server-side file reads (no client-side fetching).

---

## Behavior / Contract

**Route:** `GET /` — `force-dynamic` React server component (`web/app/page.tsx`). No `async` needed; all three data functions are synchronous file reads.

**Data sources:**

| Function | Source | Provides |
|---|---|---|
| `listAlertsWeb()` | `web/lib/alerts.ts` (reads `data/targets.json`) | `Alert[]` — all configured alerts |
| `getLatestScanState()` | `web/lib/state.ts` (reads `.campbrain/state/latest-scan.json`) | `LatestScanState` — per-alert last scan summary keyed by alert ID |
| `getHitsState()` | `web/lib/state.ts` (reads `.campbrain/state/hits.json`) | `HitsState` — all recorded availability hit records |

These are direct file reads — the dashboard does **not** call `/api/state` or any API route.

**Page-level computed values:**

- `activeAlerts` — `alerts.filter(a => a.enabled)`
- `totalMatches` — sum of `matchCount` across all `LatestScanSummary` entries
- `totalHits` — `hitsState.hits.length`
- `lastScanTime` — most recent `scannedAt` across all scan summaries (sorted, `.at(-1)`)
- `recentHits` — top-5 `AvailabilityHitRecord` entries sorted descending by `firstSeenAt`

**Alert row** (`AlertRow` sub-component):

- Shows alert enabled/disabled status dot (`.dot-green` / `.dot-gray`), alert name, provider badge (`badge-blue`), email badge, calendar badge.
- Date-range label derived from `alert.dateMode` via `dateRangeLabel()`: handles `exact_dates`, `date_range`, `weekend_range`, `next_available_weekend` modes.
- Scan summary row: last scan relative time, match count in green if > 0, else "N candidates, no matches".
- If no scan summary exists for the alert: "Not scanned yet".

**Relative time** — `relativeTime(iso)` formats the age of a timestamp into `"just now"`, `"Nm ago"`, `"Nh ago"`, `"Nd ago"` strings. Defined inline in `page.tsx`.

**Output states:**

- No alerts configured → `.empty` div with a "Create your first alert →" link to `/alerts`.
- Alerts but no hits → stats grid + alert rows only.
- Alerts + hits → stats grid + "Recent Hits" table (up to 5 rows) + alert rows.

**Persisted shapes** used: `Alert` (from `src/config/alerts`), `LatestScanSummary`, `HitsState`, `AvailabilityHitRecord` — see [data-model.md](../data-model.md) for the canonical definitions.

> Future: The dashboard currently reads from flat JSON state files in `.campbrain/state/`. When the system moves to Postgres-backed alerts and scan state, this page would switch to `async` server component functions querying the DB (analogous to how `/map` uses `listParksFromDb()`). The `/api/state` route exists as a precursor for this.

---

## Presentation

**Layout:**

```
.page-header
  h1 "Dashboard"
  p.page-subtitle "Campsite availability monitoring"

.grid-3 (stat cards)
  .card  Active alerts  (count / total)
  .card  Current matches (green when > 0)
  .card  Total hits recorded

(scan timestamp line — only when lastScanTime exists)
  "Last scan X ago · View full history →"

(Recent Hits section — only when recentHits.length > 0)
  h2 "Recent Hits"
  .card table: Alert | Site | Arrival | Nights | First seen
    .badge-match for site name

h2 "Alerts"  +  btn-primary "+ New alert" →/alerts

AlertRow cards (one per alert)
  .card with .dot indicator, h3 name, .badge-blue provider, email/calendar badges
  date-range label + sites line
  scan summary line or "Not scanned yet"
  .btn-ghost "Manage →" link to /alerts
```

**Component links:** `.card`, `.grid-3`, `.stat-label`, `.stat-value`, `.dot`/`.dot-green`/`.dot-gray`, `.badge`/`.badge-blue`/`.badge-gray`/`.badge-match`, `.btn-ghost`/`.btn-primary`/`.btn-sm`, `.page-header`, `.page-subtitle`, `.empty` — all defined in [design-system.md](../design-system.md).

---

## Reproduction checklist

1. Add `web/app/page.tsx` as a `force-dynamic` server component (synchronous, not async).
2. Import `listAlertsWeb` from `web/lib/alerts.ts` and `getLatestScanState`, `getHitsState` from `web/lib/state.ts`.
3. Compute `activeAlerts`, `totalMatches`, `totalHits`, `lastScanTime`, `recentHits` (top 5 sorted by `firstSeenAt` desc).
4. Render `.page-header` with h1 "Dashboard" and `.page-subtitle`.
5. Render `.grid-3` with three `.card` stat blocks for active alerts, current matches (green when > 0), and total hits (see [design-system.md](../design-system.md) for `.stat-label`/`.stat-value`).
6. If `lastScanTime` is set, render the relative-time scan line with a "View full history" link to `/scan-history`.
7. If `recentHits.length > 0`, render the "Recent Hits" table inside a `.card` with `.badge-match` for site names.
8. Render the Alerts section header (`h2` + `.btn-primary` "New alert" link). Show `.empty` if `alerts.length === 0`.
9. For each alert, render an `AlertRow` card with: `.dot` status indicator, provider `.badge-blue`, optional email/calendar badges, `dateRangeLabel()` output, and scan summary (last scan time + match count) or "Not scanned yet" when no scan entry exists.
10. Verify: page loads without async DB calls; relative-time formatting is correct; zero-alert state shows the empty prompt; stats update on hard-reload after a scan run.

---

## Dependencies

- [data-model.md](../data-model.md) — `Alert`, `LatestScanSummary`, `HitsState`, `AvailabilityHitRecord` shapes
- [api.md](../api.md) — `/api/state` exists as a supporting route; this surface does not consume it directly
- [design-system.md](../design-system.md) — all layout classes, badges, dots, stat components
