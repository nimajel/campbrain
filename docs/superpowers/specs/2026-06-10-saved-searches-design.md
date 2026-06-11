# User-Defined Saved Searches — Design

**Date:** 2026-06-10
**Status:** Designed (not yet planned). Hand to **planner**.
**Owner at design time:** architect
**Parent specs / required reading:**
  - [2026-06-02-find-campsites-design.md](2026-06-02-find-campsites-design.md) — `/explore` search/cache read model (`searchAvailableStays`, taxonomy filters)
  - [2026-06-09-alert-scanner-completion-design.md](2026-06-09-alert-scanner-completion-design.md) — the alert pipeline this feature subsumes (`runScan`, `matchCandidates`, `reconcileHits`, hit-state v2, notification contract)
  - CLAUDE.md → Three Engines (this is the **Trip Target Engine**), Cache Architecture (Postgres grid), Site Filters, Conventions

## Why this doc exists

"User-defined saved searches" is the top open CLAUDE.md Next Step and the foundation for
two things: (1) finishing alert-scanner saved-target matching (Resend email is already
wired and hardened to consumer-grade delivery), and (2) a future hosted multi-user
deployment. Today the user filters `/explore` and `/map` ad-hoc; nothing persists, and the
only persisted "watch" mechanism is the legacy `data/targets.json` **Target** model, which
requires a hand-picked `campgroundName` + `acceptableSites` list and four fiddly date
modes.

A **saved search** is a named, persisted query over the *same broad dimensions* the
`/explore` page already filters on — region or specific parks, a date range or a simple
recurring pattern, min nights, and the access/kinds/hide site taxonomy. It is (a)
re-runnable from the UI with one click and (b) consumable by the alert scanner so that NEW
availability matching it triggers an email, deduped so the user is never spammed.

## Decided upstream (by the user's delegate)

**Saved Search is the new primary model; Target becomes legacy.** A saved search stores
broad `/explore`-style dimensions and matches **any bookable site** in the selected
parks/region that passes the filters — no `campgroundName` / `acceptableSites` required.
`data/targets.json` is migrated into the new storage and the old Target alert path is
retired. This doc fills in every remaining decision (storage, migration, matching/dedupe,
v1 date patterns, UI, API) with a recommendation + rejected alternatives in the Decision
Log.

## Goals

1. Persist named saved searches over `/explore`/`/map` dimensions (region OR explicit
   parks, date range OR recurring pattern, min nights, access/kinds/hide).
2. One-click **Run** from the UI — opens `/explore` (or `/map`) prefilled, OR renders
   results inline. (Inline result reuse via the existing search read path.)
3. **Create-from-current-filters** on `/explore`: a "Save this search" affordance that
   captures the live filter state.
4. Edit / delete / enable-disable / toggle email per saved search.
5. Make the alert scanner consume saved searches: match any bookable site in scope, dedup
   new availability, email via the existing hardened pipeline.
6. Single-user local use NOW; clean path to multi-user later (nullable `user_id`).

## Non-goals (v1)

- Auth / multi-tenancy / row-level security. We add a nullable `user_id` column and stop
  there.
- Arbitrary day-of-week recurrence rules (e.g. "every Tuesday"), holidays, or cron-style
  patterns. v1 ships exactly two date patterns (see Decision 4).
- SMS / Slack channels (separate roadmap items).
- Quiet hours / digesting (already a documented non-goal of the alert scanner; perishable
  availability favors immediate delivery).
- A dedicated lottery-window saved-search type (Yosemite/Death Valley) — separate roadmap
  item; the schema leaves room (`provider`, free-form scope) but no lottery logic ships.
- Per-saved-search distance/geo radius (a `/map` "near me" dimension). v1 scopes by region
  or explicit park list only; geo radius is a documented fast-follow.

---

## Domain model

A **SavedSearch** is the union of: an identity, a scope (which parks), a date pattern, and
the existing taxonomy filter state.

```ts
// src/saved-search/types.ts (new) — single source of truth for the shape.
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SavedSearchScopeSchema = z.object({
  // Exactly one of region | parkPageIds drives park selection; both empty = all parks.
  // Validation: not both non-empty (Decision 2a).
  region: z.enum(['north-coast', 'bay-area', 'sierra', 'central-coast', 'socal']).nullable(),
  parkPageIds: z.array(z.string()).default([]),
});

export const SavedSearchDatePatternSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed_range'), from: isoDate, to: isoDate }),
  z.object({
    kind: z.literal('any_weekend'),
    horizonDays: z.number().int().positive().max(180).default(90),
  }),
]);

export const SavedSearchFiltersSchema = z.object({
  access: z.array(z.enum(['drive_in', 'hike_in', 'boat_in'])).default([]),
  kinds: z.array(z.enum(['tent', 'hookup', 'cabin'])).default([]),
  hide: z.array(z.enum(['group', 'equestrian', 'walk_up'])).default([]),
  minNights: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
});

export const SavedSearchSchema = z.object({
  id: z.string(),                       // uuid (crypto.randomUUID)
  userId: z.string().nullable(),        // null in single-user mode; FK-ready for multi-user
  provider: z.enum(['california-parks', 'recreation-gov']).default('california-parks'),
  name: z.string().min(1),
  scope: SavedSearchScopeSchema,
  datePattern: SavedSearchDatePatternSchema,
  filters: SavedSearchFiltersSchema,
  alertEnabled: z.boolean().default(false),   // off by default — saved ≠ alerting
  emailEnabled: z.boolean().default(true),
  createdAt: z.string(),                       // ISO 8601
  updatedAt: z.string(),
});

export type SavedSearch = z.infer<typeof SavedSearchSchema>;
export type SavedSearchScope = z.infer<typeof SavedSearchScopeSchema>;
export type SavedSearchDatePattern = z.infer<typeof SavedSearchDatePatternSchema>;
export type SavedSearchFilters = z.infer<typeof SavedSearchFiltersSchema>;
```

The `scope`, `datePattern`, and `filters` objects are stored as JSONB (one column each,
or a single `definition` JSONB — see Decision 2). `weekendsOnly` is **not** a separate
flag: it is implied by `datePattern.kind === 'any_weekend'`. For `fixed_range`, weekends
are not forced (matches `/explore`, which has no weekends-only pill).

---

## Storage — Postgres table (Decision 2)

A new provider-agnostic table in `src/cache/db.ts` `initDb()` (idempotent
`CREATE TABLE IF NOT EXISTS`). It does **not** reference `providers(provider_id)` with a
hard FK on a JSONB scope, but the scalar `provider` column does.

```sql
CREATE TABLE IF NOT EXISTS saved_searches (
  id           TEXT PRIMARY KEY,                 -- uuid
  user_id      TEXT,                             -- nullable; multi-user-ready, no FK yet
  provider     TEXT NOT NULL DEFAULT 'california-parks'
                 REFERENCES providers(provider_id),
  name         TEXT NOT NULL,
  definition   JSONB NOT NULL,                   -- { scope, datePattern, filters }
  alert_enabled BOOLEAN NOT NULL DEFAULT false,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user
  ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_alert_enabled
  ON saved_searches(alert_enabled) WHERE alert_enabled = true;
```

**Rationale for single `definition` JSONB** over three columns: the scope/pattern/filters
shapes are validated by zod at the application boundary (not the DB), evolve together, and
are never queried by sub-field in the hot path (the alert scanner loads all
alert-enabled rows and matches in TS). One JSONB column keeps migrations trivial as the
shape grows (e.g. future geo radius). `provider`, `alert_enabled`, and `email_enabled` are
promoted to scalar columns because the scanner filters on them.

### Data-access module — `src/saved-search/store.ts` (new)

All reads/writes go through this module (mirrors the `availability-cache.ts` boundary
convention). Pure-SQL, no Next.js coupling.

```ts
listSavedSearches(userId?: string | null): Promise<SavedSearch[]>
getSavedSearch(id: string): Promise<SavedSearch | undefined>
createSavedSearch(input: SavedSearchInput): Promise<SavedSearch>   // assigns id + timestamps
updateSavedSearch(id: string, patch: Partial<SavedSearchInput>): Promise<SavedSearch>
deleteSavedSearch(id: string): Promise<void>
listAlertEnabledSavedSearches(): Promise<SavedSearch[]>            // alert_enabled = true
```

`SavedSearchInput` = `SavedSearchSchema` omitting `id`/`createdAt`/`updatedAt`. Each
function validates with the zod schema before writing; reads parse JSONB back through the
schema and skip rows that fail validation (defensive, mirrors `listAlerts`). `userId`
defaults to `null` everywhere in single-user mode; the param exists so the multi-user
path is a filter add, not a signature change.

A thin web re-export (`web/lib/saved-searches.ts`) wraps the store for Server Components /
route handlers, mirroring `web/lib/alerts.ts`.

---

## Migration — `data/targets.json` → `saved_searches` (Decision: legacy retirement)

One-time CLI command: `npm run db:migrate-targets` → `src/cli/commands/migrate-targets.ts`.

Mapping each legacy `Target`/`Alert` to a `SavedSearch`:

| Legacy Target field | Saved Search |
|---|---|
| `id`, `name` | preserved (`id` reused so re-running is idempotent) |
| `provider` (incl. legacy `yosemite-lottery`) | `provider`; `yosemite-lottery` rows are **skipped with a warning** (no scanner support) |
| `parkPageId` | `scope.parkPageIds = [parkPageId]`, `scope.region = null` |
| `dateMode: 'date_range'` + `rangeStart/rangeEnd` | `datePattern = { kind: 'fixed_range', from: rangeStart, to: rangeEnd }` |
| `dateMode: 'weekend_range'` / `'next_available_weekend'` / `weekendsOnly: true` | `datePattern = { kind: 'any_weekend', horizonDays }` (horizon = `rangeEnd - today` clamped to 180, or `nextWeeksCount*7`, default 90) |
| `dateMode: 'exact_dates'` | `datePattern = { kind: 'fixed_range', from: exactStartDate, to: exactEndDate ?? start+maxNights }` |
| `minNights` | `filters.minNights` clamped to 1–3 (legacy could exceed; clamp + warn) |
| `campingType: 'hike-in'` | `filters.access = ['hike_in']` (best-effort hint) |
| `acceptableSites` | **dropped from matching** by design (broad model), but **preserved** under `definition.legacy.acceptableSites` so a future "narrow to specific sites" feature can resurrect it, and so the migration is lossless. Documented as inert in v1. |
| `enabled` | `alert_enabled` |
| `emailEnabled` | `email_enabled` |
| `bookingRule`, `people`, `preferredSites`, `maxNights` | dropped (out of scope for saved-search matching); preserved under `definition.legacy` for losslessness |

**Decision on narrow legacy targets:** we preserve `acceptableSites` + the other dropped
fields under `definition.legacy` rather than building a first-class "specific sites"
saved-search variant in v1. Rationale: the single real legacy row (Angel Island group
day-use) is an edge case; a broad park-scoped search covers the user's intent (alert me
when *anything* bookable opens at Angel Island), and we lose no data. A future
`scope.siteNames` field can consume `definition.legacy.acceptableSites` if narrow watches
are ever wanted again.

After migration: `data/targets.json` is left on disk (not deleted) but the alert scanner
stops reading it. A follow-up doc-steward pass removes the legacy `config/alerts.ts` /
`config/schemas.ts` Target path once the saved-search scanner is verified in production.
The migration command is **idempotent** (upsert on `id`); re-running is safe.

---

## Matching semantics + "new since last check" (Decision 3)

### Reuse the existing cache read path, not a new matcher

A saved search is broad (any bookable site in scope), which is exactly what
`searchAvailableStays({ from, to, access, kinds, hide })` already computes against the
Postgres grid — including walk-up exclusion and the multi-night `HAVING COUNT(DISTINCT
date)` logic. We reuse it rather than the per-candidate `matchCandidates` path (which is
campground+site specific and built for the narrow Target model).

New module `src/saved-search/match.ts`:

```ts
// Expand a saved search into the concrete (from,to) stay windows to query.
expandStayWindows(search: SavedSearch, today: string): StayWindow[]
//   fixed_range  → one window per arrival date in [from, to - minNights],
//                  each spanning minNights nights.
//   any_weekend  → Fri/Sat arrivals within [today+1, today+horizonDays],
//                  spanning minNights nights (reuses the Fri/Sat logic from
//                  scan-candidates.ts generateNextAvailableWeekend, refactored
//                  into a shared pure helper so both call sites agree).

// Run a saved search against the cache → flat list of concrete openings.
matchSavedSearch(
  search: SavedSearch,
  deps: { searchAvailableStays: typeof searchAvailableStays;
          parkRegionOf: (parkPageId: string) => CampRegion | null;
          getEntriesForPark: typeof getEntriesForPark; },   // for availabilityAsOf
  today: string,
): Promise<SavedSearchOpening[]>
```

`SavedSearchOpening`:

```ts
interface SavedSearchOpening {
  savedSearchId: string;
  parkPageId: string;
  parkName: string;
  campgroundName: string;
  siteName: string;          // a specific bookable site that matched
  arrivalDate: string;       // YYYY-MM-DD
  departureDate: string;     // arrival + nights
  nights: number;
  bookingUrl: string | null;
  availabilityAsOf?: string; // oldest covering-window scannedAt (freshness, as today)
}
```

Matching algorithm per saved search:
1. `expandStayWindows` → list of `{ from, to, nights }`.
2. For each window, call `searchAvailableStays` once (it already dedupes across
   overlapping scan windows). Apply `filters.access/kinds/hide`.
3. Restrict parks to scope: keep a park if `scope.parkPageIds.includes(parkPageId)` OR
   (`parkPageIds` empty AND (`scope.region == null` OR `parkRegionOf(parkPageId) ==
   scope.region`)). Region classification reuses `web/lib/regions.ts` `classifyRegion`
   over catalog coords (same approach as `/api/search`). To keep `src/`-layer purity, the
   region resolver is injected as `parkRegionOf` (the web layer supplies the catalog-backed
   impl; tests supply a stub).
4. Each surviving `(park, campground, siteName, arrivalDate, nights)` becomes a
   `SavedSearchOpening`. `availabilityAsOf` = oldest covering-window `scannedAt`, computed
   exactly as `match-candidates.ts` does (extract that helper to
   `src/cache/freshness.ts` and share it).

This is **pure orchestration over existing read functions** — no new SQL, no network.

### "New since last check" — dedupe state

Reuse the existing hit-state machinery wholesale. The hit key gains a saved-search-scoped
form so saved-search openings and (during transition) any legacy hits never collide:

```
key = `ss:${savedSearchId}|${parkPageId}|${campgroundName}|${siteName}|${arrivalDate}|${departureDate}`
```

We extend `AvailabilityHitRecord` (already v2, already in
`src/state/scan-state.ts`) with optional fields needed to render a broad opening:
`savedSearchId?`, `parkPageId?`, `parkName?`, `campgroundName?`. The `reconcileHits`
function is **unchanged** — it is already key-agnostic, prunes past arrivals, sets
`disappearedAt` on checked-but-absent, re-notifies on reappear, and retries
never-notified. We feed it saved-search openings instead of Target hits.

`checkedKeys` for a saved search = the key of **every** `(park × campground × site ×
arrival)` that `searchAvailableStays` *could* have returned for that search's expanded
windows. Because the broad model has no fixed acceptable-site list, "checked but absent"
can only be asserted for sites we have *previously seen* (a site that has never appeared
has no prior record to mark disappeared). Concretely: `checkedKeys` = the set of keys of
**currently-stored** hits for this saved search whose window was re-evaluated this run,
union the incoming keys. This preserves disappear→reappear semantics without enumerating
the entire park catalog. (Documented precisely in the matcher; tested.)

A bumped state version (`version: 3`) marks saved-search-aware records; the v2→v3 loader
backfills exactly as the v1→v2 path did (no `notifiedAt` rewrite needed — v2 already has
it; v3 only adds the new optional opening fields, which are absent on old records and
simply render as the legacy shape).

### Scanner integration — `runScan` extension

`src/scanner/run-scan.ts` gains a second source feeding the *same* downstream pipeline:

```
runScan
  ├─ (legacy, transitional) listAlerts → matchCandidates …   [removed once migration verified]
  └─ listAlertEnabledSavedSearches → matchSavedSearch → SavedSearchOpening[]
        → openingsToHitRecords → allIncoming
  reconcileHits(existing, allIncoming, checkedKeys, now, today)   [unchanged]
  notify(...)                                                     [unchanged]
```

`openingsToHitRecords(openings, now)` (new, in `scan-state.ts`) mirrors
`resultsToHitRecords` but builds the saved-search-keyed records. `buildAvailabilityAlerts`
gains a branch: when `hit.savedSearchId` is set, it sources `parkName`/`campgroundName`
from the hit record (not from a legacy `Alert`), and `sourceUrl`/`bookingUrl` from the
opening's `bookingUrl`. The email body and `availabilityAsOf` freshness line are unchanged.

**Decision: alert default is OFF.** A saved search is created with `alertEnabled: false`.
Saving a search is a bookmark, not a commitment to be emailed. The user flips an "Alert me"
toggle to opt a search into scanning. This prevents accidental email floods the moment a
broad search is saved.

---

## Recurring date patterns — v1 scope (Decision 4)

v1 ships exactly two `datePattern.kind` values:

1. **`fixed_range`** — `{ from, to }`. The `/explore` case. Arrivals from `from` to
   `to - minNights`.
2. **`any_weekend`** — `{ horizonDays }` (default 90, max 180). Fri + Sat arrivals within
   `today+1 … today+horizonDays`, each spanning `minNights` nights. Mirrors the existing
   `/map` "weekends only" + horizon-preset behavior and the legacy
   `next_available_weekend` Target mode. This is the only "recurring" pattern in v1 and the
   natural fit for "alert me about any weekend trip this summer."

Deferred: arbitrary day-of-week rules, month/season windows, holiday weekends, N-th-weekend
patterns. These are additive `discriminatedUnion` members later; the schema is built to
extend without migration (JSONB `definition`).

---

## UI surface (Decision 5)

**Decision: a panel-driven flow anchored on `/explore`, plus a lightweight `/saved` index
page** — not a heavy standalone builder.

### Create-from-current-filters (`/explore`)
- Add a **"Save this search"** button to the `/explore` filter bar (`FindCampsitesClient`).
  It captures the live filter state (region, from/to, minNights if present, access/kinds/
  hide) into a `SavedSearchInput` and opens a small **Modal** (reuse `web/components/ui/
  Modal`) with: a name field (prefilled e.g. "Bay Area · Jul 4 weekend"), a date-pattern
  toggle (Fixed dates ↔ Any weekend within [horizon]), and an "Alert me by email" toggle
  (default off). Save → `POST /api/saved-searches` → toast + the search appears in the
  saved list.
- The fixed↔weekend toggle defaults to **fixed_range** when the user came from explicit
  date inputs; **any_weekend** is offered as a one-click alternative with a horizon select
  (30 / 60 / 90 / 180 days).

### Saved-search index — `/saved` (new page)
- Lists the user's saved searches as cards (reuse `ui/Card`, `ui/Badge`, `ui/StatusDot`):
  name · scope summary ("Bay Area" or "3 parks") · date-pattern summary ("Jul 1–7" / "Any
  weekend, next 90 days") · filter chips · an **Alert** `StatusDot` (green when
  `alertEnabled`).
- Per card: **Run** (primary), **Edit**, **Alert on/off** toggle, **Delete**.
- **Run** behavior (Decision 5a): navigates to `/explore` with the saved search's filters
  serialized into the URL query (`?from=&to=&region=&access=&kinds=&hide=&minNights=` for
  fixed_range; for any_weekend it routes to `/map` with `weekendsOnly=true` + horizon
  preset, since the weekend stay-tier UI lives there). This **reuses existing rendering**
  rather than building a third results view. A saved-search id is included
  (`?savedSearch=<id>`) so the page can show a "Showing: <name>" banner and an inline
  "Edit this search" link.
- Empty state (`ui/EmptyState`): "No saved searches yet — filter on Find Campsites and hit
  Save this search."
- A nav link to `/saved` is added to the app header.

### Recent openings reuse
The existing dashboard **RecentOpenings** panel already renders `AvailabilityHitRecord`s.
With saved-search hits flowing through the same store, it shows saved-search openings too;
each row links to the saved search (`/saved` highlight) and to the booking URL. No new
component — just the extended record fields rendered (park/campground come straight from
the record now).

---

## API routes (Decision 6)

All under `web/app/api/saved-searches/`. JSON in/out; zod-validated via the store; provider
logic untouched (no parsing here). `dynamic = 'force-dynamic'`.

| Method & path | Handler file | Body / params | Returns |
|---|---|---|---|
| `GET /api/saved-searches` | `route.ts` | — | `{ savedSearches: SavedSearch[] }` (current user; `userId=null`) |
| `POST /api/saved-searches` | `route.ts` | `SavedSearchInput` | `201 { savedSearch }` |
| `GET /api/saved-searches/[id]` | `[id]/route.ts` | — | `{ savedSearch }` or `404` |
| `PATCH /api/saved-searches/[id]` | `[id]/route.ts` | `Partial<SavedSearchInput>` | `{ savedSearch }` |
| `DELETE /api/saved-searches/[id]` | `[id]/route.ts` | — | `204` |
| `POST /api/saved-searches/[id]/run` | `[id]/run/route.ts` | — | `{ openings: SavedSearchOpening[] }` (live match against cache; used for inline preview / "test this alert") |

Route signatures (TypeScript, strict):

```ts
// web/app/api/saved-searches/route.ts
export async function GET(req: NextRequest):
  Promise<NextResponse<{ savedSearches: SavedSearch[] } | { error: string }>>;
export async function POST(req: NextRequest):
  Promise<NextResponse<{ savedSearch: SavedSearch } | { error: string }>>;

// web/app/api/saved-searches/[id]/route.ts
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }):
  Promise<NextResponse<{ savedSearch: SavedSearch } | { error: string }>>;
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }):
  Promise<NextResponse<{ savedSearch: SavedSearch } | { error: string }>>;
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }):
  Promise<NextResponse<null | { error: string }>>;

// web/app/api/saved-searches/[id]/run/route.ts
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }):
  Promise<NextResponse<{ openings: SavedSearchOpening[] } | { error: string }>>;
```

Validation errors → `400 { error }`; not-found → `404`; unexpected → `500` (matching the
`/api/search` pattern). The `/run` route is the same matcher the scanner uses, so UI
preview and email alerting can never diverge.

---

## File-level change map (for the planner)

**New (src):**
- `src/saved-search/types.ts` — zod schemas + types (above).
- `src/saved-search/store.ts` — Postgres CRUD (the read/write boundary).
- `src/saved-search/match.ts` — `expandStayWindows`, `matchSavedSearch`, `openingsToHitRecords` glue.
- `src/cache/freshness.ts` — extracted `oldestCoveringScan` (shared by `match-candidates.ts` and `match.ts`).
- `src/cli/commands/migrate-targets.ts` — one-time targets.json → saved_searches migration.
- `src/rules/weekend-arrivals.ts` — shared pure Fri/Sat arrival generator (extracted from `scan-candidates.ts`).

**Modified (src):**
- `src/cache/db.ts` — `saved_searches` table + indexes in `initDb()`.
- `src/state/scan-state.ts` — extend `AvailabilityHitRecord` (optional `savedSearchId`, `parkPageId`, `parkName`, `campgroundName`); add `openingsToHitRecords`; bump version to 3 with v2→v3 backfill in `readHitsState`.
- `src/scanner/run-scan.ts` — add saved-search source; branch `buildAvailabilityAlerts` on `savedSearchId`.
- `src/scanner/match-candidates.ts` — import shared freshness helper.
- `src/cli/index.ts`, `package.json` — register `db:migrate-targets` script.

**New (web):**
- `web/lib/saved-searches.ts` — store re-export for the web layer + a catalog-backed `parkRegionOf`.
- `web/app/api/saved-searches/route.ts`, `[id]/route.ts`, `[id]/run/route.ts`.
- `web/app/saved/page.tsx`, `web/app/saved/SavedSearchesClient.tsx`.
- `web/components/SaveSearchModal.tsx` (or co-located under `/explore`).

**Modified (web):**
- `web/app/explore/FindCampsitesClient.tsx` — "Save this search" button + modal wiring; read `?savedSearch=` banner.
- App header/nav — add `/saved` link.
- Dashboard `RecentOpenings` — render saved-search record fields (no structural change).

**Retired (after verification, separate doc-steward step — not in the build plan's hot path):**
- `src/config/alerts.ts`, `src/config/schemas.ts` Target path; `web/lib/alerts.ts`; the legacy `matchCandidates`/`generateScanCandidates` Target wiring in `runScan`. Kept until the saved-search scanner is confirmed working against migrated data.

---

## Testing & acceptance criteria

**Unit (Vitest):**
- `SavedSearchSchema` — accepts valid; rejects both `region` and `parkPageIds` non-empty; defaults applied (`alertEnabled=false`, `minNights=1`).
- `store.ts` — create→get→list→update→delete round-trip; JSONB parse-back equals input; `listAlertEnabledSavedSearches` returns only `alert_enabled=true`; bad-JSONB row skipped on list.
- `expandStayWindows` — `fixed_range` produces correct arrival set for minNights 1/2/3; `any_weekend` yields only Fri/Sat arrivals within horizon; horizon clamp at 180.
- `matchSavedSearch` (injected `searchAvailableStays`/`parkRegionOf` stubs) — region scope filters parks; explicit `parkPageIds` overrides region; access/kinds/hide passed through; walk-up never an opening; `availabilityAsOf` = oldest covering scan; empty cache → no openings.
- `openingsToHitRecords` + `reconcileHits` — new opening → notify; same opening next run → no re-notify; disappeared (checked, absent) → `disappearedAt`, no notify; reappeared → notify; past-arrival pruned; saved-search key never collides with a legacy Target key.
- `migrate-targets` — `date_range` Target → `fixed_range`; `weekendsOnly`/`next_available_weekend` → `any_weekend`; `yosemite-lottery` skipped with warning; `acceptableSites` preserved under `definition.legacy`; idempotent on re-run (no duplicate rows).
- v2→v3 hit-state loader — old records load unchanged; no notification burst (no `notifiedAt` rewrite needed).

**Integration / manual:**
- `npm run db:init` creates `saved_searches` idempotently.
- `npm run db:migrate-targets` imports the existing Angel Island row as a park-scoped saved search; re-running is a no-op.
- `/explore` → set filters → "Save this search" → appears on `/saved`.
- `/saved` → Run navigates to `/explore` (fixed) or `/map` (weekend) prefilled and showing the "Showing: <name>" banner.
- Enable Alert on a saved search whose scope currently has availability → `npm run worker` cycle (or `npm run scan`) produces an opening → email sent (with freshness line) → second cycle sends no duplicate → dashboard RecentOpenings shows the opening.
- `POST /api/saved-searches/[id]/run` returns the same openings the scanner would alert on.

**Gate:** `npm run typecheck`, `npm test`, and a clean `npm run dev` load of `/saved` and
`/explore` with no console/hydration errors. No `any`. Files kebab-case. No park-specific
constants outside seed/tests.

---

## Decision Log

**Decision 1 — Saved Search vs Target relationship.** *Decided upstream:* Option A —
Saved Search is primary, Target retired and migrated. (Rejected: B keep both models in
parallel — doubles the matching surface and confuses the user; C keep Target as the alert
substrate and bolt saved-search UI on top — keeps the narrow site-list friction the
delegate explicitly wanted gone.)

**Decision 2 — Storage.** *Chosen:* Postgres `saved_searches` table, single JSONB
`definition` + promoted scalar `provider`/`alert_enabled`/`email_enabled`, nullable
`user_id`. (Rejected: JSON file like `targets.json` — wrong direction given the hosted
future and we already have Postgres; three separate JSONB columns — needless schema churn
as the definition shape grows; fully normalized scope/filter tables — over-engineered for
a single-user MVP, YAGNI.)

**Decision 2a — Scope representation.** *Chosen:* `region` (nullable) XOR `parkPageIds`
(array); both empty = all parks; both non-empty rejected by schema. (Rejected: free-form
geo radius in v1 — deferred as a fast-follow to avoid coupling saved searches to the map's
distance machinery now.)

**Decision 3 — Matching engine + dedupe.** *Chosen:* reuse `searchAvailableStays` (the
`/explore` read path) for broad matching; reuse `reconcileHits` + the v2/v3 hit store for
"new since last check," with a saved-search-scoped hit key and a previously-seen-bounded
`checkedKeys` set. (Rejected: a brand-new scanner-side SQL matcher — duplicates the
grid-query logic that already handles walk-up exclusion and multi-night `HAVING COUNT`;
diffing full result snapshots run-over-run — more storage and reinvents the hit lifecycle
the alert-scanner spec already hardened.)

**Decision 3a — Alert default.** *Chosen:* `alertEnabled` defaults **false**; saving is a
bookmark, alerting is an explicit opt-in toggle. (Rejected: default-on — risks an email
flood the instant a broad search is saved.)

**Decision 4 — v1 date patterns.** *Chosen:* `fixed_range` + `any_weekend` (horizon) only.
(Rejected: arbitrary DOW / cron / holiday rules — large surface for a single-user MVP;
deferred as additive discriminated-union members needing no migration.)

**Decision 5 — UI surface.** *Chosen:* create-from-current-filters modal on `/explore` +
a lightweight `/saved` index; Run reuses `/explore` (fixed) or `/map` (weekend) by URL
prefill rather than a third results renderer. (Rejected: a dedicated full saved-search
builder page — more UI than an MVP needs and duplicates the existing filter controls; a
purely inline `/explore` panel with no index page — no good home for cross-search
management like enable-alert/delete.)

**Decision 6 — API.** *Chosen:* REST CRUD under `/api/saved-searches` + a `/[id]/run`
endpoint that shares the scanner's matcher so UI preview and email alerting can't diverge.
(Rejected: server actions only — the scanner (a non-Next process) needs the same store, so
the logic lives in `src/` and routes are thin; folding run into `GET` with a query flag —
muddies caching semantics, POST is clearer for a live cache hit.)

**Decision 7 — Legacy field losslessness.** *Chosen:* preserve dropped Target fields
(`acceptableSites`, `preferredSites`, `bookingRule`, `people`, `maxNights`) under
`definition.legacy` so migration is lossless and a future narrow-site variant can resurrect
them. (Rejected: hard-drop — irreversible; first-class narrow-site saved-search variant in
v1 — scope creep for one edge-case legacy row.)
