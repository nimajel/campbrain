# Exclude Boat-In Sites Filter — Design (Retroactive)

**Date:** 2026-06-09
**Status:** Retroactive — documents a feature already shipped without a spec.
**Parent spec:** [2026-06-02-find-campsites-design.md](2026-06-02-find-campsites-design.md)
  (established the site-filter framework and the original four filters)

## Why this doc exists

The site-filter framework was specced in the Find Campsites design with four filters
(`exclude_group`, `exclude_walk_up`, `hike_in_only`, `exclude_equestrian`). Two more
(`exclude_day_use`, `exclude_boat_in`) were later added directly to the filter modules
without a spec amendment. This doc closes the gap for `exclude_boat_in` so the spec trail
matches shipped reality. It describes the filter as built; it is not a forward-looking
proposal.

## Problem

Some CA State Park campsites are **boat-in / boat-access** — reachable only by watercraft
(e.g. across a reservoir or along a waterway). A user without a boat cannot use them, yet
they appear in availability results alongside drive-up and hike-in sites, creating noise.
The user needs a way to hide them, consistent with the other site-type exclusions.

## Solution

Add `exclude_boat_in` to the existing `SiteFilter` set. It follows the established filter
contract exactly — a client-side predicate plus a matching server-side SQL pattern — so it
plugs into `SiteFilterPanel`, `/explore`, and `/map` pin-lighting with no new wiring.

### Behavior

- **Filter ID:** `exclude_boat_in`
- **Label:** "Exclude boat-in sites"
- **Description:** "Hide boat-in / boat-access sites reachable only by watercraft"
- **Match semantics:** a site is treated as boat-in when its name or campground name
  matches the pattern *boat* followed (optionally hyphen/space separated) by *in*, *to*, or
  *access* — e.g. "Boat-In", "Boat In Sites", "Boat Access", "Boat-to Camp".
- When the filter is **on**, matching sites are hidden from results and excluded from counts;
  when **off**, they appear normally. (Unlike `exclude_walk_up`, boat-in sites are still
  reservable — this is purely a visibility preference, not a bookability rule.)

### Implementation (as shipped)

Two parallel definitions, mirroring every other filter:

- **Client** — `web/lib/site-filters.ts`:
  ```ts
  {
    id: 'exclude_boat_in',
    label: 'Exclude boat-in sites',
    description: 'Hide boat-in / boat-access sites reachable only by watercraft',
    test: (site, cg) => !/\bboat[\s-]?(in|to|access)\b/i.test(`${site} ${cg}`),
  }
  ```
- **Server** — `FILTER_SQL` in `src/cache/availability-cache.ts`, for `/map` pin-lighting:
  ```ts
  exclude_boat_in: { exclude: true, pattern: '\\yboat[ -]?(in|to|access)\\y' }
  ```
  (`\y` is the Postgres word-boundary escape, the SQL equivalent of the client regex `\b`.)

The client `\b…\b` regex and the server `\y…\y` pattern must stay semantically equivalent —
a change to one requires the same change to the other.

## Non-goals

- No new UI beyond the existing `SiteFilterPanel` checkbox row.
- No change to bookability or counts logic beyond standard filter exclusion (boat-in sites
  remain reservable; they are not treated as walk-up).
- No per-park data flagging — detection is name-pattern based, consistent with the other
  filters.

## Verification

- Toggling `exclude_boat_in` on `/explore` hides sites/campgrounds whose name matches the
  pattern and updates counts accordingly.
- `/map` pin-lighting respects the filter server-side via `FILTER_SQL`.
- Client regex and server pattern produce equivalent matches on representative names
  ("Boat-In Campsites", "Boat Access Sites", "Boatright Campground" must NOT match —
  word-boundary guards against the "Boatright" false positive).

## Dependencies

- `web/lib/site-filters.ts` (client predicate + `SiteFilter` type)
- `src/cache/availability-cache.ts` (`FILTER_SQL`)
- Reference: [docs/reference/design-system.md](../../reference/design-system.md) (site-filter
  catalog), [docs/reference/surfaces/explore.md](../../reference/surfaces/explore.md)
