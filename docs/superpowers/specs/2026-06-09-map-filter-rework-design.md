# Map Filter Bar Rework + Site Type Taxonomy — Design

**Date:** 2026-06-09
**Status:** approved (user walkthrough + mockup review, 2026-06-09)
**Backlog:** slots between P2 (pins, shipped) and P3 (detail panel) in
[2026-06-09-map-view-improvements.md](2026-06-09-map-view-improvements.md)
**Builds on:** the P2 pin redesign (summary counts API, `web/lib/map-pins.ts`)

---

## Problems being solved

1. **Two unrelated "weekend" controls.** The "Weekends / All dates" tab is a
   day-of-week constraint (sends `weekendsOnly`, switches panel layout); the
   "Weekend" date chip is a horizon preset (this Fri–Mon). On default load both
   light green simultaneously.
2. **Inconsistent filter scopes.** Nights filter never reaches the pin query;
   "All nights" ≡ "1N" in the All-dates view (identical output incl. Book links);
   clearing the date range paints every pin solid green with no query behind it;
   Reset shows on fresh load but disappears in the weirder cleared state and
   doesn't restore defaults; the match count renders twice.
3. **Site filters are a category grab-bag.** Five "Exclude X" chips + one
   "Hike-in sites only" include, all styled identically. Car camping (the most
   common access type) is not selectable. Client regexes and `FILTER_SQL` have
   already drifted (`day.?use` vs `day.use`, `hike.?in` vs `hike.in`). Rec.gov
   site names are bare numbers ("047", "B027") so name filters silently never
   match 18k of 25k sites. Day-use and walk-up are category errors presented as
   preferences.

## Approved decisions

1. Persist site type metadata at scan time (new columns on `sites`).
2. Site kind chips (Tent / Hookups / Cabin) ship in v1.
3. "Primitive/Environmental" names fold into access = hike-in.
4. Day-use sites leave the bookable pool everywhere (incl. `/explore`).
5. Default load: This weekend + Weekends only on; nothing hidden; all access
   types and site kinds on.
6. Min stay reaches the pins (consecutive-nights SQL in the summary query).
7. Park dropdown leaves the filter bar; becomes a find-a-park search on the map.
8. `/explore` adopts the same grouped filter panel in the same change.
9. Weekend = Fri/Sat arrivals (unchanged). Holiday-Monday awareness → backlog.
10. Control language: everything is a pill. Green = selected; slate + eye-off
    icon = hidden. No checkboxes, no switches.

---

## Part 1 — Site type taxonomy (engine)

### Schema: new columns on `sites`

Site types are orthogonal dimensions, not one enum ("Group Tent Primitive
Campsite" is group + tent + hike-in):

```sql
access        text NOT NULL DEFAULT 'drive_in'  -- 'drive_in' | 'hike_in' | 'boat_in'
site_kind     text                              -- 'tent' | 'hookup' | 'cabin' | NULL (unspecified)
is_group      boolean NOT NULL DEFAULT false
is_equestrian boolean NOT NULL DEFAULT false
is_walk_up    boolean NOT NULL DEFAULT false    -- first-come hike/bike; never bookable
is_day_use    boolean NOT NULL DEFAULT false    -- excluded from every user-facing surface
```

Added in `initDb` (`src/cache/db.ts`) via `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` so `npm run db:init` stays idempotent.

### Classifier: one pure function, single source of truth

New module `src/catalog/site-classifier.ts`:

```ts
classifySite(siteName: string, campgroundName: string, recGovCampsiteType?: string): SiteTypeInfo
```

- **CA parks (name patterns, in priority order):**
  - `hike\s*[/&]?\s*bike` → `is_walk_up` (existing `isWalkUpSite` rule moves here)
  - `\bgroup\b` → `is_group`; `\b(equestrian|horse)\b` → `is_equestrian`
  - `\b(day.?use|dailyuse|picnic)\b` → `is_day_use`
  - `\b(hike.?in|walk.?in|environmental|primitive)\b` → `access = hike_in`
  - `\bboat[\s-]?(in|to|access)?\b` → `access = boat_in`
  - `\bhook.?up\b` or `\(E/W` → `site_kind = hookup`; `\btent\b` → `tent`;
    `\b(cabin|yurt|cottage)\b` → `cabin`
  - default: `access = drive_in`, `site_kind = null`
- **Rec.gov:** prefer the `campsite_type` string from the month-availability
  payload (add the field to `RecGovCampsite` — it is already in the response we
  fetch and currently dropped): `TENT ONLY` → tent; `RV`/`ELECTRIC` → hookup
  (`NONELECTRIC` excluded from hookup per shipped classifier); `WALK TO`/`HIKE TO` → hike_in;
  `BOAT` → boat_in; `GROUP` → is_group; `EQUESTRIAN` → is_equestrian; `CABIN`/`YURT` → cabin;
  `DAY USE` → is_day_use (shipped as `t.includes('DAY USE')`, not bare `'DAY'` — avoids
  false positives on other types containing "DAY");
  fall back to name patterns when absent.

These regexes live **only** in the classifier. `FILTER_SQL` and the per-query
name regexes in `src/cache/availability-cache.ts` are deleted; queries filter on
the typed columns. The drift class disappears structurally.

### Scanner + backfill

- Scanner upserts set the type columns on insert **and update them on conflict**
  (so reclassification heals existing rows).
- One-off backfill script (`npm run db:backfill-types`): classify every existing
  `sites` row by name. CA is fully accurate immediately; Rec.gov rows get name
  fallback (mostly `drive_in`) until the next worker scan supplies
  `campsite_type`.
- **Rescan note:** after this lands, restarting `npm run worker` repopulates
  Rec.gov types within one full scan cycle. The user is told when to do this.

### Query changes (`src/cache/availability-cache.ts`)

`buildAvailabilityClauses` / `getParkAvailabilityCounts` new signature inputs:

- `access?: ('drive_in'|'hike_in'|'boat_in')[]` — empty/omitted = all;
  otherwise `s.access = ANY(...)`
- `kinds?: ('tent'|'hookup'|'cabin')[]` — empty = all; otherwise
  `(s.site_kind = ANY(...))`. Note: selecting kinds excludes NULL-kind sites by
  design (you asked for tent sites; unspecified sites don't qualify).
- `hide?: ('group'|'equestrian'|'walk_up')[]` → `NOT s.is_group` etc.
  Hiding walk-up zeroes `walkUpCount` (replaces `excludeWalkUp` flag).
- `is_day_use = false` always.
- `minNights?: 1|2|3` — a site matches if some arrival date `d` exists with
  `d ≥ from`, `d + minNights - 1 ≤ to`, all nights `d … d+minNights-1`
  available, and (when `weekendsOnly`) `DOW(d) ∈ (5,6)`. Implement with
  gaps-and-islands (`date - ROW_NUMBER() OVER (PARTITION BY site ORDER BY date)`
  islands, keep islands of length ≥ minNights, check arrival window/DOW).
  `minNights` absent → current any-available-date behavior.
- `mv_available_stays` and the `/explore` search query also gain
  `is_day_use = false` and lose their name-regex filter arms (`npm run
  db:rebuild-mv` required after).

### API changes

- `GET /api/map/availability/summary` — new params `access`, `kinds`, `hide`
  (csv), `minNights` (int). `filters` (legacy csv ids) is deleted — internal
  API, no external consumers.
- `GET /api/map/availability` (detail) — accepts the same params and filters
  **server-side**; the client-side `passesSiteFilters` name-filtering in
  `MapClient` is removed. Panel and pins consume identical semantics. Response
  gains per-site `walkUp` marking where needed by the panel (existing
  `walkUpSites` arrays stay).
- `GET /api/search` (`/explore`) — same `access`/`kinds`/`hide` params replace
  the old filter ids; `exclude_walk_up` special-casing is retired (walk-up
  display handled by `hide=walk_up`).

---

## Part 2 — Filter bar (web/app/map)

Four labeled rows; all controls are pills (green active / slate+eye-off for
Hide). See conversation mockup `map_filter_bar_v2_taxonomy`.

**Row 1 — When**
- Horizon presets: `This weekend` · `Next 2 weeks` · `Next month` · `Anytime`
  (exactly one active; presets fill the date inputs; manual date edits
  deselect presets unless they happen to match — keep current equality logic)
- Date inputs (from – to), native for now (P6 restyles them)
- `Weekends only` pill (replaces the Weekends/All dates tab; also drives the
  detail-panel layout: weekend tiers when on, date rows when off). Forced on +
  visually locked while "This weekend" is the preset.
- `Anytime` = no date clamp: query the whole cached horizon (`from = today`,
  `to` omitted). Pins always reflect a real query — the `availByFacility =
  null` all-green state is unreachable; the ✕ clear button is removed.

**Row 2 — Min stay + Near**
- `Min stay`: `Any` · `1 night` · `2 nights` · `3 nights` (≥N consecutive
  nights; sent to summary + detail). Replaces "All nights/1N/2N". In the
  date-rows view, Book links inject `max(minNights, 1)` nights.
- `Near`: location input + locate button; distance pills `Any/25/50/100/200 mi`
  rendered disabled (reduced opacity, no error toast) until a location
  resolves. Behavior otherwise unchanged (distance still hard-filters pins).

**Row 3 — Access · Site kind · Hide**
- `Access` (multi-select, none = all): `Drive-in` · `Hike-in` · `Boat-in`
- `Site kind` (multi-select, none = all): `Tent` · `Hookups (RV)` · `Cabin / yurt`
- `Hide` (multi-select): `Group` · `Equestrian` · `Walk-up (first-come)` —
  active style is slate with `eye-off` glyph, distinct from green selections
- The old six-filter `SiteFilterPanel` chip row and `web/lib/site-filters.ts`
  filter list are replaced by taxonomy groups exported from a new
  `web/lib/site-taxonomy.ts` (ids, labels, param mapping). `isWalkUpSite`
  re-exports from the classifier for any remaining display logic.

**Row 4 — Summary sentence + Reset**
- One plain-language line replacing both counts: e.g. **"8 of 141 parks** have
  a 2-night drive-in weekend stay Jun 9 – 23 within 50 mi of Santa Cruz".
  Composed from active state; omits clauses at defaults.
- `Reset` restores the **default state** (This weekend, weekends only, min stay
  Any, nothing hidden, no location) and renders only when state ≠ default.

**Park finder**
- The "All parks" dropdown leaves the bar. A small search box overlays the map
  (top-right): type-ahead over park names; selecting opens the panel + flies to
  the park (selection ≠ filter, unchanged). Not part of Reset.

**Defaults on load**: preset This weekend, weekends-only on, min stay Any, all
access + kinds, nothing hidden. Active controls render green consistently,
including defaults (revised 2026-06-09 on user review — the original
"green means I changed this" rule read as inconsistent highlighting). Reset
visibility still keys off deviation from the default state.

**Copy fixes**
- Empty panel states account for `minNights` (no more "Next opening: X" based
  on a 1-night date when min stay is 2).
- Weekends-only + a range containing no Fri/Sat: "No weekend days in this date
  range" instead of all-grey "no availability".

**`/explore` parity**: the explore page swaps `SiteFilterPanel` for the same
Access/Site kind/Hide groups (no When/Near rows — explore keeps its own date
pickers and region chips). Server params as above.

---

## Out of scope

Holiday-weekend awareness, styled date picker (P6), mobile bottom sheets (P5),
synced results list (P4), capacity/people filters (Rec.gov `max_num_people` is
persisted-adjacent but unused).

## Verification gates

- `npm run typecheck`, `npm test` (extend suites: classifier table-driven tests
  incl. real sampled names; gaps-and-islands minNights tests incl. TTL/window
  dedupe interplay; clause builder tests updated; summary API param parsing)
- `npm run db:init` + `npm run db:backfill-types` + `npm run db:rebuild-mv`
  run clean against the local DB
- `/map` and `/explore` load with no console errors or hydration warnings;
  pins, panel, and explore counts agree for the same filter state
- Live checks: default load shows no Reset and each group highlights its
  active option; min stay 2 changes pin counts; clearing to Anytime keeps
  real counts

## Sequencing

1. **Engine** (schema, classifier, scanner, backfill, queries, APIs, tests) —
   after this merges: user restarts worker → Rec.gov rescan.
2. **UI** (`/map` bar, park search, `/explore` panel, copy) — can start once
   API shapes land; final visual verification after a fresh scan.
