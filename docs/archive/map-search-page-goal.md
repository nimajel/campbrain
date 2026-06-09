> ARCHIVED — historical intent, superseded by docs/reference/. Not current truth.

# Goal: CampBrain Map Search Page

## Objective

Create a Campflare-style map page for CampBrain where I can visually explore campgrounds, see which parks/campgrounds are in the local catalog, filter by trip criteria, and create alerts from the map.

Reference inspiration:
- Campflare has an interactive map experience for campground discovery and alert creation, but CampBrain should implement its own local version using our catalog and alert system. The page should be user-facing and should not expose provider internals like page IDs or raw booking rules. Campflare’s public map page is an interactive map entry point with navigation for Map, Permits, Info, API, Search, and Login. :contentReference[oaicite:0]{index=0}

## Product Intent

The user should be able to:

1. Open a map.
2. See campground/park markers.
3. Filter by dates, number of people, nights, and camping type.
4. Click a park/campground marker.
5. See available catalog info: park, campground names, site count, last refreshed, alert status.
6. Select one or more campgrounds/sites.
7. Create an alert directly from the map.

The user should not need to know:
- ReserveCalifornia page IDs
- provider IDs
- campground IDs
- raw booking URLs
- booking rule internals
- scraper/discovery details

---

## Scope

Implement:
- `/map` page
- Map UI with markers for catalog parks/campgrounds
- Map/list split view
- Filtering controls
- Park/campground detail panel
- “Create Alert” flow from selected map item
- User-friendly empty/loading/error states
- Basic catalog metadata required for map display
- Tests where practical
- Navigation link for Map

Do not implement:
- auto-booking
- login automation
- CAPTCHA bypassing
- queue evasion
- aggressive polling
- Supabase
- auth
- cloud deployment
- paid/commercial features
- new provider integration unless needed for map display

---

## UX Goal

The page should feel like a campground discovery page, not a data admin page.

Primary flow:

1. User opens `/map`.
2. User can filter by trip criteria:
   - dates or date mode
   - people
   - nights
   - weekends only
   - camping type
3. User sees relevant parks/campgrounds on map and list.
4. User clicks a marker or list card.
5. User selects campground/sites.
6. Upon clicking campground / sites, user can see the next next availability for that campsite

---

## Page Layout

Route:

- `/map`

Navigation:

- Add `Map` to the main nav.
- Keep `Data Sources` hidden from the main nav or rename it to admin/debug if still present.

Recommended layout:

```txt
┌────────────────────────────────────────────────────────────┐
│ CampBrain                                                  │
│ Dashboard | Map | Alerts | Scan History | Calendar | Settings │
├────────────────────────────────────────────────────────────┤
│ Filters                                                    │
│ Dates / Date Mode | People | Nights | Camping Type | Search │
├───────────────────────┬────────────────────────────────────┤
│ Results List          │ Map                                │
│ - Park/Campground     │ markers                            │
│ - distance/status     │                                    │
│ - alert button        │                                    │
├───────────────────────┴────────────────────────────────────┤
│ Selected Park / Campground Detail Panel                    │
└────────────────────────────────────────────────────────────┘

The map should work well even if the user has only the seed catalog.

Map Library

Use a simple, free map solution.

Preferred:

Leaflet + OpenStreetMap
React Leaflet if compatible with Next.js

Install only what is necessary.

If Leaflet creates SSR issues in Next.js:

dynamically import the map component with ssr: false
keep map-only code inside a client component

Do not use paid map APIs unless explicitly configured.

Data Model Requirements

The catalog currently has parks/campgrounds/sites. Add optional location metadata needed for map rendering.

Add or support these fields:

ParkCatalogEntry
provider
parkName
parkPageId
latitude optional
longitude optional
region optional
bookingSystem
campgrounds
defaultBookingRule
lastUpdatedAt
lastDiscoveryAttemptAt
discoveryStatus
discoveryError
sourceUrl
CampgroundCatalogEntry
id
name
latitude optional
longitude optional
bookingUrl
sites
siteTypes
bookingRule
lastDiscoveredAt

If campground coordinates are unknown:

fall back to park coordinates
show campground list under the park marker

Seed coordinates for initial known parks where easy, especially:

Angel Island SP
Pfeiffer Big Sur SP
Julia Pfeiffer Burns SP
Big Basin Redwoods SP
Samuel P. Taylor SP
Mount Tamalpais SP
Salt Point SP
MacKerricher SP
Prairie Creek Redwoods SP
Malibu Creek SP
Leo Carrillo SP
Crystal Cove SP
Point Mugu SP
Gaviota SP
Henry W. Coe SP

Do not block the map if some parks lack coordinates. Show them in a separate “Missing coordinates” list.

Backend/API Requirements

Add or update API endpoints:

GET /api/map/catalog

Returns map-ready catalog entries.

Shape:

type MapCatalogResponse = {
  parks: MapPark[];
};

type MapPark = {
  provider: string;
  parkName: string;
  parkPageId: string;
  latitude?: number;
  longitude?: number;
  discoveryStatus?: string;
  lastUpdatedAt?: string;
  campgroundCount: number;
  siteCount: number;
  campgrounds: MapCampground[];
};

type MapCampground = {
  id: string;
  name: string;
  latitude?: number;
  longitude?: number;
  siteCount: number;
  siteTypes: string[];
  sites: MapSite[];
};

type MapSite = {
  id: string;
  name: string;
  type?: string;
  capacity?: number;
};
POST /api/alerts

Reuse the existing alert creation API.

The map page should call the existing alert API when the user creates an alert from a selected park/campground/sites.

Filtering Requirements

The map page should include filters for:

Search text
park name
campground name
Date mode:
next available weekends
exact dates
date range
People
Min nights
Max nights
Weekends only
Camping type
Has discovered campgrounds
Has sites
Email alerts enabled default
Calendar reminders enabled default

Filters can be client-side for now.

Do not fetch live availability automatically when filters change. Avoid aggressive polling.

Marker Behavior

Markers should represent parks initially.

Marker click opens a detail panel with:

park name
campground count
site count
discovery status
last updated
list of campgrounds
button: Create Alert

If a park has multiple campgrounds:

show campground checkboxes or cards
selecting a campground populates site checkboxes
default to all sites in selected campground

If multiple campground support is too complex for alert creation:

allow only one campground selection for now
clearly structure code so multi-campground support can be added later
Detail Panel Requirements

When a user selects a park/campground, show:

Park name
Campground name
Site count
Site list
Inferred booking rule summary
Last catalog refresh
Discovery status
Source/reservation link if available
Alert setup controls:
date mode
weeks ahead
exact dates/date range
min nights
max nights
people
weekends only
email alerts
calendar reminders
acceptable sites
preferred sites optional

Button:

Create Alert
Create Alert & Scan if easy and existing API supports it
Alert Creation From Map

When creating an alert from the map, infer:

provider
parkName
parkPageId
campgroundName
acceptableSites
preferredSites optional
bookingRule from catalog
campingType from selected campground/site type if available

User supplies:

date mode
dates/date range/weeks ahead
min nights
max nights
people
weekends only
emailEnabled
calendarEnabled
enabled

Default alert name:

{Park Name} — {Campground Name}

Example:

Angel Island SP — Ridge (sites 4-6)
Empty States

Handle:

No catalog parks:
Show “No parks in catalog yet.”
Suggest running npm run catalog:refresh.
Parks with no coordinates:
Show them in a side list.
Do not crash map.
Parks with no discovered campgrounds:
Show “Campground data not loaded yet.”
Do not ask the user for page ID.
Suggest backend catalog refresh.
No filter results:
Show “No parks match these filters.”
Alert creation success:
Show success message.
Link to /alerts.
Alert creation failure:
Show readable error.
Styling

Keep styling consistent with existing CampBrain UI.

Do:

clean cards
readable filter bar
sticky side panel if simple
badges for discovery status
clear buttons

Do not spend excessive time on polish.

Tests

Add tests for:

Map catalog API returns parks.
Map catalog API includes campground/site counts.
Parks without coordinates are handled.
Alert payload from map selection is valid.
Booking rule is inferred from catalog.
Park page ID is not required from the user.
Empty catalog state renders or is handled.
Angel Island Ridge map alert creation payload is valid.
Existing npm run verify passes.

If UI component tests are not already set up, focus on pure helper functions and API route tests.

Verification

Goal is complete only when:

npm run typecheck passes
npm test passes
npm run upcoming passes
npm run scan passes
npm run verify passes
npm run dev starts
/map renders locally
user can create an alert from Angel Island Ridge through the map flow
Important UX Rule

Do not expose provider internals in the normal map flow.

The user should not need to enter:

park page ID
booking rule
provider-specific IDs
source URLs
raw campground IDs

Those can exist in the backend/catalog/debug views, but not in the primary map alert creation flow.
