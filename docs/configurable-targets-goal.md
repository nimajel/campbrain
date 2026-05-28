# Goal: Configurable Camping Targets

## Objective

Generalize CampBrain from an Angel Island-specific tool into a configurable camping target system.

Angel Island Ridge remains the first seeded example, but the app should allow creating and scanning other configured California State Parks targets by park, campground, dates, number of nights, number of people, and camping type.

This goal is complete when:
- npm run verify passes
- npm run dev starts the UI
- the UI allows configuring a scan target
- the scanner no longer assumes Angel Island except through seed data
- Angel Island Ridge still works end-to-end

## Scope

Implement:
- Generic target model
- Seed data for Angel Island Ridge
- Configurable target form in the UI
- Flexible date modes
- Generic California Parks provider support based on page_id and campgroundName
- Reusable scan candidate generation
- “next available weekend” scan mode
- Tests for candidate generation and generic target scanning

Do not implement:
- database
- Supabase
- auth
- email
- SMS
- Google Calendar
- cron
- browser automation
- login automation
- auto-booking
- CAPTCHA bypassing
- queue evasion

## Target Model

A target should support:

- id
- name
- provider
- parkName
- parkPageId
- campgroundName
- acceptableSites
- preferredSites
- campingType
- people
- dateMode
- exactStartDate
- exactEndDate
- rangeStart
- rangeEnd
- minNights
- maxNights
- weekendsOnly
- nextAvailableWeekend
- bookingRule

Supported date modes:

1. exact_dates
   - scan one exact stay

2. date_range
   - scan all stays within a date range
   - allow minNights and maxNights

3. weekend_range
   - scan Friday-Sunday, Friday-Saturday, and Saturday-Sunday combinations

4. next_available_weekend
   - starting from today, scan upcoming weekends for a configurable number of weeks
   - default: next 12 weekends
   - generate Friday-Sunday, Friday-Saturday, and Saturday-Sunday candidates

## UI Requirements

Add or update UI so I can:

1. View existing targets
2. Create a new target
3. Edit a target
4. Choose provider
5. Enter park name
6. Enter California Parks page_id
7. Enter campground name
8. Enter acceptable site names
9. Enter number of people
10. Select camping type
11. Choose date mode
12. Enter exact dates or range dates
13. Choose min nights and max nights
14. Toggle weekends only
15. Run scan for one target
16. View scan results for that target

## UX Principle

Keep the UI simple.

This is a local personal tool, not a SaaS app.

A single “New Target” form is fine.

Use basic inputs:
- text input
- date input
- number input
- textarea for acceptable sites, one per line
- select for date mode
- checkbox for weekends only

## Provider Behavior

CaliforniaParksProvider must not hardcode Angel Island.

It should use:
- target.parkPageId for page_id
- target.campgroundName to find the campground section
- target.acceptableSites to identify site rows
- target.minNights / target.maxNights / dateMode to generate candidates

The provider can still assume the California Parks availability page structure.

## Seed Data

Keep Angel Island Ridge as seed/default data:

- provider: california-parks
- parkName: Angel Island SP
- parkPageId: 468
- campgroundName: Ridge (sites 4-6)
- acceptableSites:
  - Hike in Campsite #4
  - Hike in Campsite #5
  - Hike in Campsite #6
- campingType: hike-in
- people: 2
- dateMode: next_available_weekend
- minNights: 1
- maxNights: 2
- weekendsOnly: true

## Storage

For now, targets can be stored in:
- data/targets.json

When the UI creates or edits a target, it may update data/targets.json through a local API route.

This is acceptable because this is a local-only tool.

Do not add a database yet.

## Tests

Add tests for:

1. Candidate generation for exact_dates
2. Candidate generation for date_range
3. Candidate generation for weekend_range
4. Candidate generation for next_available_weekend
5. minNights and maxNights behavior
6. CaliforniaParksProvider uses target.parkPageId, not hardcoded 468
7. CaliforniaParksProvider uses target.campgroundName, not hardcoded Ridge
8. CaliforniaParksProvider uses target.acceptableSites, not hardcoded sites #4-#6

## Verification

Goal is complete only when:

- npm run typecheck passes
- npm test passes
- npm run upcoming passes
- npm run scan passes
- npm run verify passes
- npm run dev starts the UI
