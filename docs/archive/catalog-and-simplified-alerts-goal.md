> ARCHIVED — historical intent, superseded by docs/reference/. Not current truth.

# Goal: Campground Catalog and Simplified Alert Creation

## Objective

Simplify alert creation by introducing a campground catalog layer.

Users should not manually enter park page IDs, exact campground names, site names, or booking rules.

The app should infer:
- park page ID from selected park
- campground options from selected park
- site options from selected campground
- booking rules from provider/park/campground metadata where possible

This goal is complete when:
- npm run verify passes
- the backend has a catalog model
- California Parks park/campground/site discovery works for Angel Island
- the alert UI uses dropdowns/multiselects instead of raw text for park, campground, and sites
- booking rules are no longer user-configurable in the normal alert form
- Angel Island Ridge still works end-to-end

## Scope

Implement:
- catalog data model
- California Parks catalog discovery
- park dropdown
- campground dropdown/multiselect
- site multiselect
- preferred site optional multiselect/order field
- inferred booking rules
- simplified alert form
- advanced section only for unusual overrides
- tests for catalog discovery and alert creation

Do not implement:
- new providers
- Supabase
- auth
- cloud deployment
- browser automation
- login automation
- auto-booking
- CAPTCHA bypassing
- queue evasion

## Catalog Model

Add types:

ProviderCatalog
- provider
- parks

ParkCatalogEntry
- provider
- parkName
- parkPageId
- bookingSystem
- campgrounds
- defaultBookingRule
- lastUpdatedAt
- sourceUrl

CampgroundCatalogEntry
- id
- name
- bookingUrl
- sites
- siteTypes
- bookingRule
- lastDiscoveredAt

SiteCatalogEntry
- id
- name
- type
- capacity
- attributes
- bookingUrl

BookingRule
- type
- monthsBefore
- weeksBefore
- releaseTime
- timezone
- source
- confidence
- lastVerifiedAt

## Storage

Use local JSON files for now:

data/catalog/california-parks.json

or:

.campbrain/catalog/california-parks.json

Pick the simpler structure, but document it.

## Seed Catalog

Add a seed catalog for Angel Island SP:

Park:
- name: Angel Island SP
- provider: california-parks
- parkPageId: 468

Campgrounds:
- East Bay (sites 1-3)
- Ridge (sites 4-6)
- Sunrise (sites 7-9)
- West Garrison (sites 10 & Kayak)
- North Garrison Group Camp
- other campgrounds discovered from the availability page if present

Ridge sites:
- Hike in Campsite #4
- Hike in Campsite #5
- Hike in Campsite #6

Default California Parks booking rule:
- rolling_months_before
- monthsBefore: 6
- releaseTime: 08:00
- timezone: America/Los_Angeles

## California Parks Catalog Discovery

Implement a discovery function:

discoverCaliforniaParkCatalog(parkPageId, sampleDate, nights)

It should:
1. Fetch the California Parks availability page.
2. Find campground sections.
3. Extract campground names.
4. Extract booking URLs.
5. Extract site rows.
6. Extract site names.
7. Save/update catalog metadata.
8. Preserve source URL and lastUpdatedAt.

Use the existing parser logic where possible.

For Angel Island, this should discover:
- Ridge (sites 4-6)
- Hike in Campsite #4/#5/#6

## Rule Inference

Do not let users configure booking rules in the normal form.

For California Parks:
- infer default rolling 6-month window at 8:00 AM America/Los_Angeles
- store source/confidence in the catalog

If campground-specific rules are unknown:
- fall back to provider default
- mark confidence as medium
- expose as read-only in the UI

## Alert Model Changes

Alerts should store:
- selected parkName
- parkPageId
- selected campground IDs/names
- acceptable sites
- preferred sites
- inferred bookingRule
- user intent fields:
  - people
  - dateMode
  - minNights
  - maxNights
  - weekendsOnly
  - nextAvailableWeekendWeeks
  - emailEnabled
  - calendarEnabled

Support multiple selected campgrounds if feasible.

If multi-campground support is too large:
- allow only one campground in the first pass
- structure the data so multiple campgrounds can be added later

## UI Requirements

Replace raw fields with:

Park:
- dropdown from catalog

Campground:
- dropdown or multiselect populated from selected park

Acceptable Sites:
- multiselect populated from selected campground
- default to all sites

Preferred Sites:
- optional multiselect populated from selected acceptable sites
- if ordering is difficult, allow textarea for now but prefill options

Hide advanced implementation fields:
- provider
- parkPageId
- booking rule
- timezone
- months before arrival
- release time

Show booking rule as read-only:
- "California Parks reservations usually open 6 months before arrival at 8:00 AM Pacific"
- include confidence/source if available

Advanced section:
- provider
- parkPageId
- raw campground name
- booking rule override
Only show if user expands Advanced.

## API Routes

Add or update:

GET /api/catalog
GET /api/catalog/parks
GET /api/catalog/parks/[parkPageId]
POST /api/catalog/discover

The discover endpoint should be local-only and safe:
- accepts parkPageId
- accepts sampleDate
- accepts nights
- updates local catalog

## Tests

Add tests for:

1. Angel Island catalog seed loads
2. California Parks discovery extracts campground names
3. California Parks discovery extracts Ridge sites
4. Alert creation can infer parkPageId from parkName
5. Alert creation can infer bookingRule from catalog
6. Alert creation rejects unknown park unless advanced/manual mode is used
7. UI/API alert payload no longer requires manual booking rule fields
8. Existing Angel Island alert still scans successfully
9. Calendar reminders still use inferred booking rule
10. npm run verify passes

## Verification

Goal complete only when:
- npm run typecheck passes
- npm test passes
- npm run upcoming passes
- npm run scan passes
- npm run verify passes
