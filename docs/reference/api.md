# CampBrain — API Routes

**Status:** shipped

Contract reference for all Next.js route handlers under `web/app/api/`. Three core routes back the primary surfaces; the rest are supporting or possibly-legacy.

For request/response shapes that reference database types, see [data-model.md](data-model.md).

---

## Core routes

### `GET /api/search`

- **Purpose:** Find parks with available campsites in a date range. Backs the `/explore` "Find Campsites" surface.
- **Params (query string):**
  - `from` — `YYYY-MM-DD`, required. Start of desired arrival window (inclusive).
  - `to` — `YYYY-MM-DD`, required. End of arrival window (exclusive — `from` must be before `to`).
  - `access` — optional CSV: `drive_in`, `hike_in`, `boat_in`. Empty = all access types.
  - `kinds` — optional CSV: `tent`, `hookup`, `cabin`. Empty = all site kinds.
  - `hide` — optional CSV: `group`, `equestrian`, `walk_up`. Walk-up hides walk-up rows.
  - `region` — optional, one of the `CampRegion` slugs (`norcal`, `socal`, `central`, etc.). Restricts to parks in that geographic region.
  - Legacy `filters` param is **removed**; use `access`/`kinds`/`hide` instead.
- **Response:** `SearchApiResponse`
  ```typescript
  {
    parks: SearchParkResponse[];  // sorted descending by bookable site count
    fallback: { alternateDates: FallbackPark[] } | null;
    // fallback is non-null only when every park has zero bookable sites in range;
    // it suggests the nearest dates with any availability (within 60 days).
  }
  type SearchParkResponse = {
    parkPageId: string;
    parkName: string;
    provider: string;       // 'california-parks' | 'recreation-gov'
    region: CampRegion;
    campgrounds: SearchCampground[];
    totalAvailable: number; // bookable sites only (walk-up excluded)
  };
  ```
- **Backed by:** `searchAvailableStays()` in `web/lib/availability-cache.ts`, which reads `mv_available_stays`. Day-use sites are always excluded. Filter params are parsed by `web/lib/filter-params.ts`.
- **Consumed by:** `/explore` (`web/app/explore/FindCampsitesClient.tsx`).

---

### `GET /api/map/availability`

- **Purpose:** Per-park availability detail for the map popover panel. Returns the next available dates and weekend tiers for a given park.
- **Params (query string):**
  - `parkPageId` — the canonical park identifier (for CA parks and grouped Rec.gov parks).
  - `facilityIds` — comma-separated list of facility page IDs (for Rec.gov multi-facility groups). Either `parkPageId` or `facilityIds` is required.
  - `provider` — optional, scopes query to prevent cross-provider ID collisions.
  - `from` — optional `YYYY-MM-DD`, constrains the dates and weekends returned.
  - `to` — optional `YYYY-MM-DD`.
  - `access` — optional CSV: `drive_in`, `hike_in`, `boat_in`.
  - `kinds` — optional CSV: `tent`, `hookup`, `cabin`.
  - `hide` — optional CSV: `group`, `equestrian`, `walk_up`.
  - `minNights` is **not** accepted here — min-stay is applied client-side in the dates view and via tier logic in the weekends view.
- **Response:** `ParkAvailabilityResponse`
  ```typescript
  {
    parkPageId: string;
    parkName: string;
    asOf: string | null;                   // most recent scannedAt across all windows
    nextAvailableDates: AvailableDateEntry[];
    nextAvailableWeekends: WeekendEntry[];
    earliestAvailableDate: string | null;  // global earliest (ignores from/to filter)
  }
  type WeekendEntry = {
    label: string;          // e.g. "Fri, Jun 6–Sun, Jun 8"
    fridayDate: string;
    saturdayDate: string;
    sundayDate: string;
    campgrounds: {
      name: string;
      bookingUrl?: string;
      sites3Night: string[];      // Fri+Sat+Sun (bookable only)
      sites2NightFri: string[];   // Fri+Sat
      sites2NightSat: string[];   // Sat+Sun
      sites1NightFri: string[];   // Fri only
      sites1NightSat: string[];   // Sat only
      walkUpSites: string[];      // non-reservable (walk-up); never in the tier arrays above
    }[];
  };
  ```
- **Backed by:** `getEntriesForParks()` in `web/lib/availability-cache.ts`, reads `scan_windows` + `availability` directly. Taxonomy filtering is applied server-side via `classifySite()` from `src/catalog/site-classifier.ts` (a `passesTaxonomy` predicate in the route). Site names are deduped across overlapping windows via a `Set`-based `buildDateSiteMap`. Day-use sites are always excluded.
- **Consumed by:** `/map` (`web/app/map/MapClient.tsx`, client-side fetch on pin click).

---

### `GET /api/map/availability/summary`

- **Purpose:** Bulk park-level availability summary for map pin-lighting. Returns the set of `park_page_id`s that have at least one bookable available site matching the given filters.
- **Params (query string):**
  - `from` — optional `YYYY-MM-DD`.
  - `to` — optional `YYYY-MM-DD`.
  - `access` — optional CSV: `drive_in`, `hike_in`, `boat_in`.
  - `kinds` — optional CSV: `tent`, `hookup`, `cabin`.
  - `hide` — optional CSV: `group`, `equestrian`, `walk_up`.
  - `minNights` — optional `1|2|3`. Requires ≥N consecutive available nights (gaps-and-islands).
  - `weekendsOnly` — optional `"true"`. When set, only Friday and Saturday arrivals count.
  - Legacy `filters` param is **removed**.
- **Response:**
  ```typescript
  { parks: { parkPageId: string; siteCount: number; walkUpCount: number }[] }
  // siteCount = bookable matching sites; walkUpCount = walk-up sites (0 when walk_up is hidden)
  ```
- **Backed by:** `getParkAvailabilityCounts()` in `web/lib/availability-cache.ts`. Filters on typed `sites` columns (no name regexes). Day-use sites always excluded (`is_day_use = false`). Walk-up sites never count as bookable. Filter params parsed by `web/lib/filter-params.ts`.
- **Consumed by:** `/map` (`web/app/map/MapClient.tsx`, to colour pins blue/grey).

---

## Supporting routes

### `GET /api/map/catalog`

- **Purpose:** Returns the full park catalog (lat/lon, campgrounds, site counts) for use by external consumers or tools that need the catalog separately.
- **Note:** The `/map` page itself does **not** call this route — it loads catalog data server-side in `web/app/map/page.tsx` via `listParksWeb()` and passes it as props to `MapClient`. This route exists for external access.
- **Response:** `MapCatalogResponse` — `{ parks: MapPark[] }`.
- **Backed by:** `listParksWeb()` from `web/lib/catalog.ts`.

---

## Other / possibly-legacy routes

These routes exist in the codebase and are served. They may be pruned during the planned surface consolidation. They are listed here for inventory, not deep-documented.

| Route | Method(s) | One-line purpose |
|---|---|---|
| `GET/POST /api/alerts` | GET, POST | List alerts; create a new alert |
| `GET/PUT/DELETE /api/alerts/[id]` | GET, PUT, DELETE | Read, update, or delete a single alert |
| `POST /api/alerts/[id]/scan` | POST | Trigger an immediate scan for a specific alert |
| `POST /api/alerts/[id]/disable` | POST | Disable an alert |
| `POST /api/alerts/[id]/enable` | POST | Enable a disabled alert |
| `GET /api/scan` | — | (see `POST /api/scan` below) |
| `POST /api/scan` | POST | Trigger an on-demand scan for a target (legacy scan API) |
| `GET /api/state` | GET | Returns latest scan state + hits state from file (`getLatestScanState`, `getHitsState`) |
| `GET /api/scan-state` | GET | Returns latest scan state only (`getLatestScanState`) — possibly superseded by `/api/state` |
| `GET /api/status` | GET | Returns setup status (Postgres, catalog, token file checks) |
| `GET /api/catalog` | GET | Lists all parks from catalog JSON |
| `GET /api/catalog/discover` | GET | Triggers a catalog discovery run |
| `GET /api/catalog/parks` | GET | Lists all parks with campground detail |
| `GET/PUT/DELETE /api/catalog/parks/[parkPageId]` | GET, PUT, DELETE | Read/update/delete a catalog park entry |
| `GET/POST /api/targets` | GET, POST | List or create scan targets |
| `GET/PUT/DELETE /api/targets/[id]` | GET, PUT, DELETE | Read, update, or delete a target |

---

## Dependencies

- [data-model.md](data-model.md) — schema types referenced by response shapes
- [engines/cache.md](engines/cache.md) — query functions backing most routes
- [surfaces/explore.md](surfaces/explore.md) — consumes `/api/search`
- [surfaces/map.md](surfaces/map.md) — consumes `/api/map/availability` and `/api/map/availability/summary`
