# CampBrain — Data Model

**Status:** shipped

Single source of truth for the Postgres schema, materialized view, and shared TypeScript types. All engines and surfaces reference this doc rather than duplicating schema details.

Source files: `src/cache/db.ts` (DDL), `src/cache/types.ts` (TS types), `src/cache/availability-cache.ts` (queries and invariants).

---

## Tables

### `providers`

```sql
CREATE TABLE providers (
  provider_id   TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  base_url      TEXT
)
```

Seeded with two rows at `initDb()` time:
- `'california-parks'` — California State Parks
- `'recreation-gov'` — Recreation.gov

---

### `parks`

```sql
CREATE TABLE parks (
  provider_id   TEXT NOT NULL REFERENCES providers(provider_id),
  park_page_id  TEXT NOT NULL,
  park_name     TEXT NOT NULL,
  PRIMARY KEY (provider_id, park_page_id)
)
```

`park_page_id` is the provider's external identifier: an integer string for CA Parks (`page_id` in the `AvailabilityInfo` endpoint), a facility ID string for Rec.gov.

---

### `campgrounds`

```sql
CREATE TABLE campgrounds (
  provider_id     TEXT NOT NULL,
  park_page_id    TEXT NOT NULL,
  campground_name TEXT NOT NULL,
  campground_id   TEXT NOT NULL,
  nightly_fee     NUMERIC(8,2),
  booking_url     TEXT,
  PRIMARY KEY (provider_id, park_page_id, campground_name),
  FOREIGN KEY (provider_id, park_page_id) REFERENCES parks(provider_id, park_page_id)
)
```

---

### `sites`

```sql
CREATE TABLE sites (
  site_id        SERIAL PRIMARY KEY,
  provider_id    TEXT NOT NULL,
  park_page_id   TEXT NOT NULL,
  campground_name TEXT NOT NULL,
  site_name      TEXT NOT NULL,
  access         TEXT NOT NULL DEFAULT 'drive_in',  -- 'drive_in' | 'hike_in' | 'boat_in'
  site_kind      TEXT,                               -- 'tent' | 'hookup' | 'cabin' | NULL
  is_group       BOOLEAN NOT NULL DEFAULT false,
  is_equestrian  BOOLEAN NOT NULL DEFAULT false,
  is_walk_up     BOOLEAN NOT NULL DEFAULT false,     -- first-come hike/bike; never bookable
  is_day_use     BOOLEAN NOT NULL DEFAULT false,     -- excluded from every user-facing surface
  UNIQUE (provider_id, park_page_id, campground_name, site_name),
  FOREIGN KEY (provider_id, park_page_id, campground_name)
    REFERENCES campgrounds(provider_id, park_page_id, campground_name)
)
```

`site_id` is a Postgres serial used as the FK in `availability`. Site names are the raw text strings from the provider (e.g. `"Hike/Bike"`, `"Site 001"`). The six type columns are added idempotently by `initDb()` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) and populated at upsert time by `classifySite()` in `src/catalog/site-classifier.ts`. Use `npm run db:backfill-types` to classify existing rows after a schema migration.

---

### `scan_windows`

```sql
CREATE TABLE scan_windows (
  provider_id   TEXT NOT NULL,
  park_page_id  TEXT NOT NULL,
  window_start  DATE NOT NULL,
  window_end    DATE NOT NULL,
  scanned_at    TIMESTAMPTZ NOT NULL,
  source_url    TEXT NOT NULL,
  PRIMARY KEY (provider_id, park_page_id, window_start),
  FOREIGN KEY (provider_id, park_page_id) REFERENCES parks(provider_id, park_page_id)
)
```

One row per `(provider_id, park_page_id, window_start)`. `window_end = window_start + 7 days` (8-day span, 0-indexed). Because the scanner generates window starts from `today+2` stepping by 8, and the base shifts by one day each run, windows **overlap** across daily runs — see the dedupe invariant below.

---

### `availability`

```sql
CREATE TABLE availability (
  site_id  INTEGER NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  date     DATE NOT NULL,
  status   TEXT NOT NULL CHECK (status IN ('available', 'unavailable', 'unknown')),
  PRIMARY KEY (site_id, date)
)
```

The core grid: one row per (site, date). Status values:
- `available` — site open on this date
- `unavailable` — site booked or blocked
- `unknown` — provider returned no data for this date

**Hosted-launch note:** on the `hosted-launch` branch (`packages/db`, migration `0008_available_only.sql`) the CHECK constraint is tightened to `status IN ('available', 'unknown')` — `unavailable` rows are no longer persisted; unavailability is implied by row-absence within a covered `scan_windows` date range.

---

## Materialized view — `mv_available_stays`

Precomputes 1-night and 2-night stays so the `/explore` page never has to re-derive them at query time.

```sql
CREATE MATERIALIZED VIEW mv_available_stays AS
SELECT
  provider_id, park_page_id, park_name, campground_name,
  nightly_fee::numeric(8,2), booking_url,
  arrival_date, nights,
  coalesce(array_agg(site_name ORDER BY site_name)
    FILTER (WHERE NOT is_walk_up), '{}'::text[]) AS available_sites,
  coalesce(array_agg(DISTINCT site_name ORDER BY site_name)
    FILTER (WHERE is_walk_up), '{}'::text[]) AS walk_up_sites
FROM stays ...
GROUP BY provider_id, park_page_id, park_name, campground_name,
         nightly_fee, booking_url, arrival_date, nights
WITH NO DATA
```

**Two array columns per row:**

| Column | Contents |
|---|---|
| `available_sites text[]` | Reservable (bookable) site names for this arrival date + night count |
| `walk_up_sites text[]` | First-come / non-reservable sites. Walk-up sites are **never** in `available_sites`. |

**Walk-up / day-use invariants:**
- Walk-up sites (`is_walk_up = true`) are excluded from `available_sites` in the MV and from bookable counts everywhere. They appear in `walk_up_sites` for badge display only.
- Day-use sites (`is_day_use = true`) are excluded from both columns (`WHERE s.is_day_use = false` in the MV).
- Classification is done by `src/catalog/site-classifier.ts`; the MV reads the persisted columns (no inline name regexes).

**2-night stay note:** The MV only generates 2-night rows for non-walk-up sites (walk-up sites cannot be reserved across multiple nights).

**Unique index:** `(provider_id, park_page_id, campground_name, arrival_date, nights)`

**Refresh semantics:**
- `refreshMaterializedView()` — `REFRESH MATERIALIZED VIEW CONCURRENTLY` when populated; plain refresh otherwise.
- `rebuildMaterializedView()` — `DROP` + recreate (use after MV schema changes).
- CLI: `npm run db:rebuild-mv`

---

## Shared TypeScript types

```typescript
export interface SiteDailyAvailability {
  name: string;
  /** Keys are YYYY-MM-DD dates within the window */
  dates: Record<string, 'available' | 'unavailable' | 'unknown'>;
  /** Rec.gov campsite_type string when available — used by classifySite() at upsert. */
  recGovCampsiteType?: string;
}

export interface CampgroundWindow {
  id: string;
  name: string;
  nightlyFee?: number;
  bookingUrl?: string;
  sites: SiteDailyAvailability[];
}

export interface AvailabilityWindowEntry {
  parkPageId: string;
  parkName: string;
  windowStart: string;    // YYYY-MM-DD, inclusive
  windowEnd: string;      // YYYY-MM-DD, inclusive (= windowStart + 7 days)
  scannedAt: string;
  sourceUrl: string;
  campgrounds: CampgroundWindow[];
}

export interface AvailableStay {
  providerId: string;
  parkPageId: string;
  parkName: string;
  campgroundName: string;
  nightlyFee: number | null;
  bookingUrl: string | null;
  arrivalDate: string;
  nights: number;
  /** Reservable online sites. Walk-up / first-come sites are in walkUpSites. */
  availableSites: string[];
  /** Walk-up / first-come sites (e.g. hike/bike) — cannot be reserved online. */
  walkUpSites: string[];
}

/** Number of days the parks.ca.gov endpoint returns per fetch. */
export const WINDOW_DAYS = 8;
```

`AvailabilityWindowEntry` is rebuilt from Postgres rows by `buildEntriesFromRows()` in `src/cache/availability-cache.ts`.

---

## Invariants

### Window overlap and dedupe

`generateWindowStarts` steps forward from `today+2` in increments of `WINDOW_DAYS` (8). Because the daily run shifts the base by 1 day, `scan_windows` accumulates **overlapping** windows over time. Any code that flattens availability across windows must **dedupe site names** per (date, campground). The `/api/map/availability` route implements this with a `Set`-based `buildDateSiteMap`. Failure to dedupe inflates site counts.

### TTL tiers (keyed on `window_start`)

| Days until `window_start` | TTL |
|---|---|
| < 7 | 30 minutes |
| 7–29 | 2 hours |
| 30–89 | 4 hours |
| ≥ 90 | 8 hours |

Implemented in `ttlMinutes()` (`src/cache/availability-cache.ts`). Used by `findStaleWindows()` to select which windows to re-scan. Expired windows are pruned by `evictExpired()`.

### Walk-up / day-use detection

Site type is determined once at upsert time by `classifySite()` in `src/catalog/site-classifier.ts` and persisted on the `sites` row. The JavaScript helper `isWalkUpSite()` (re-exported via `web/lib/site-filters.ts`) is still available for display logic that only needs the walk-up boolean without a full DB lookup.

There are no query-time name regexes for filtering. `FILTER_SQL` and `WALK_UP_SQL` have been deleted; all queries filter on the typed columns.

### Typed-column filtering

Map pin-lighting (`getParkAvailabilityCounts`) and explore search (`searchAvailableStays`) accept:

| Param | Column | Semantics |
|---|---|---|
| `access` CSV | `s.access` | `= ANY(...)` — empty = all |
| `kinds` CSV | `s.site_kind` | `= ANY(...)` — empty = all; selecting a kind excludes NULL-kind sites |
| `hide` items | `s.is_group`, `s.is_equestrian`, `s.is_walk_up` | `NOT s.is_*` per item |
| (always) | `s.is_day_use` | `= false` — unconditional |

---

---

### `saved_searches`

```sql
CREATE TABLE IF NOT EXISTS saved_searches (
  id            TEXT PRIMARY KEY,                 -- uuid (crypto.randomUUID)
  user_id       TEXT,                             -- nullable; multi-user-ready, no FK yet
  provider      TEXT NOT NULL DEFAULT 'california-parks'
                  REFERENCES providers(provider_id),
  name          TEXT NOT NULL,
  definition    JSONB NOT NULL,                   -- { scope, datePattern, filters }
  alert_enabled BOOLEAN NOT NULL DEFAULT false,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user
  ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_alert_enabled
  ON saved_searches(alert_enabled) WHERE alert_enabled = true;
```

`definition` JSONB shape (validated by zod at the application boundary):
```ts
{
  scope: {
    region: 'north-coast' | 'bay-area' | 'sierra' | 'central-coast' | 'socal' | null,
    parkPageIds: string[]   // XOR with region; both empty = all parks
  },
  datePattern:
    | { kind: 'fixed_range', from: string, to: string }    // YYYY-MM-DD
    | { kind: 'any_weekend', horizonDays: number },         // 1–180
  filters: {
    access: ('drive_in' | 'hike_in' | 'boat_in')[],
    kinds: ('tent' | 'hookup' | 'cabin')[],
    hide: ('group' | 'equestrian' | 'walk_up')[],
    minNights: 1 | 2 | 3
  },
  legacy?: { ... }   // losslessly preserved fields from migrated Target rows
}
```

Reads/writes go through `src/saved-search/store.ts` (mirrors the `availability-cache.ts` boundary). The `alert_enabled` partial index keeps `listAlertEnabledSavedSearches()` fast. The `saved_searches` table is created idempotently by `initDb()` (`npm run db:init`). `npm run db:migrate-targets` promotes `data/targets.json` rows into this table (idempotent; flips `alert_enabled = true` for previously-active targets).

---

## Dependencies

- [engines/cache.md](engines/cache.md) — the read/write layer that owns all queries against this schema
- [engines/scanner.md](engines/scanner.md) — the writer that populates `scan_windows` and `availability`
