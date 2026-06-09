> ARCHIVED — historical intent, superseded by docs/reference/. Not current truth.

# Goal: Angel Island Ridge Availability Scanner

## Objective

Build a reliable first version of the CampBrain availability scanner for Angel Island State Park Ridge sites 4-6.

This goal is complete when `npm run verify` passes and the scan command can parse Angel Island Ridge availability from the saved HTML fixture and from a live fetch.

## Scope

Implement only:
- CaliforniaParksProvider parser
- scan candidate handling
- scan CLI output
- unit tests around the parser
- fixture-based tests
- safer debug HTML behavior

Do not implement:
- database
- email
- SMS
- Google Calendar
- cron
- web UI
- browser automation
- login automation
- auto-booking
- CAPTCHA bypassing
- queue evasion

## Known HTML Rules

The Angel Island availability page has this structure:

- Campground sections are inside `section.card` elements.
- Campground name is in `header.card-header h4`.
- Ridge section h4 text is exactly `Ridge (sites 4-6)`.
- Ridge booking link looks like:
  `https://reservecalifornia.com/park/614/408?date=YYYY-MM-DD&night=N`
- The availability table has headers:
  `Unit`, then dates like `8/14/2026`, `8/15/2026`, etc.
- Each campsite row has `td.unit-name`.
- Target site rows:
  - `Hike in Campsite #4`
  - `Hike in Campsite #5`
  - `Hike in Campsite #6`

Available cells:
- `td` has class `availability`, OR
- `span` has class `fa-check`, OR
- `span` title includes `Available`

Unavailable cells:
- `td` has class `unavailable`, OR
- `span` has class `fa-xmark`, OR
- `span` title includes `Uavailable` or `Unavailable`

## Candidate-Level Match Logic

For a 1-night scan:
- arrival date must be available.

For a 2-night scan:
- arrival date and the next night must both be available.
- Checkout day does not need to be available.

Example:
For Fri Aug 14 to Sun Aug 16, 2 nights:
- Require 8/14/2026 available
- Require 8/15/2026 available
- Do not require 8/16/2026 available

## Required Types

Implement or refine typed structures for:

- `AvailabilityStatus = "available" | "unavailable" | "unknown"`
- `AvailabilityConfidence = "high" | "medium" | "low"`
- `DailySiteStatus`
- `SiteAvailability`
- `AvailabilityHit`
- `ScanResult`

Avoid `any`.

## Required Parser Behavior

The parser should:

1. Find the `section.card` whose `h4` text exactly matches `target.campgroundName`.
2. Extract the campground booking URL from the section header.
3. Parse table headers into date strings.
4. For each acceptable site:
   - find the row where `td.unit-name` equals the site name
   - parse date cells into daily statuses
   - classify status as available, unavailable, or unknown
5. Return a full parsed status table even when there are no matching hits.
6. Return `AvailabilityHit` only when a target site is available for every required night.
7. Include source URL and booking URL in output.
8. Save debug HTML only when:
   - the campground section cannot be found
   - target site rows cannot be found
   - status is unknown
   - `--debug` is passed

## Required Tests

Add fixture-based parser tests using the saved Angel Island HTML file.

Tests should verify:

1. Parser finds Ridge section.
2. Parser finds sites #4, #5, and #6.
3. Parser reads date columns.
4. Parser classifies unavailable cells correctly.
5. Parser returns zero hits for the 2026-08-14 2-night fixture if all target Ridge sites are unavailable.
6. Match logic works on a small synthetic HTML fixture where site #5 is available for both required nights.
7. Match logic does not require checkout day availability.
8. Unknown statuses are handled without crashing.

## Required CLI Behavior

`npm run scan` should print:

- target name
- candidate date range
- source URL
- Ridge booking URL
- per-site, per-date status
- `MATCH` when a full candidate stay is available
- clear message when no matches are found

## Verification

The goal is complete only when this passes:

`npm run verify`

Manual acceptance:
- `npm run scan` produces readable output.
- `npm run typecheck` passes.
- `npm test` passes.
- The parser is modular and provider-specific.
