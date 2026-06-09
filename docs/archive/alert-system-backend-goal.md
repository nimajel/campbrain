> ARCHIVED — historical intent, superseded by docs/reference/. Not current truth.

# Goal: Alert System Backend

## Objective

Finish the backend alerting model so CampBrain can support user-configured campsite alerts from the UI.

A user should be able to define an alert like:

"Watch Angel Island Ridge for the next 12 weekends for 1-2 nights, 2 people, sites #4-#6, and notify me by email when a matching campsite opens."

This goal is complete when:
- npm run verify passes
- alerts are first-class backend objects
- alerts can be created, edited, disabled, and deleted
- scans use active alerts/targets
- notification preferences are configurable per alert
- worker scans active alerts
- duplicate alerts are avoided
- UI can later consume clean APIs for alert management

## Current Context

CampBrain already has:
- configurable targets
- California Parks provider
- scan candidate generation
- local JSON state/history
- email notification service
- scheduled worker
- Google Calendar sync

Now refactor/consolidate the backend so "alerts" are the user-facing object.

## Scope

Implement:
- Alert model
- Alert config storage
- Alert CRUD backend functions
- Alert API routes if web API structure already exists
- Active/inactive alerts
- Notification preferences per alert
- Scan frequency per alert
- Alert summary/status helpers
- Tests for alert CRUD and scan integration

Do not implement:
- new provider types
- SMS
- Supabase
- auth
- cloud deployment
- browser automation
- login automation
- auto-booking
- CAPTCHA bypassing
- queue evasion

## Data Model

Add or refine an Alert object.

Suggested fields:

- id
- name
- enabled
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
- nextAvailableWeekendWeeks
- bookingRule
- notificationChannels
- emailEnabled
- calendarEnabled
- scanIntervalMinutes
- createdAt
- updatedAt

Keep compatibility with existing target config if possible.

It is acceptable to treat existing targets as alerts internally or migrate targets to alerts, but avoid breaking existing commands.

## Storage

Use local JSON storage.

Preferred options:

Option A:
- data/alerts.json becomes the new canonical config
- data/targets.json remains supported as legacy seed/import

Option B:
- data/targets.json remains canonical but fields are renamed/treated as alerts

Pick the simpler, safer option.

Do not add SQLite or Supabase yet.

## Required Backend Behavior

1. Alert CRUD
   - create alert
   - update alert
   - delete alert
   - enable/disable alert
   - list alerts
   - get alert by id

2. Validation
   - use zod
   - reject unsupported providers
   - require parkPageId for california-parks
   - require campgroundName
   - require at least one acceptable site
   - require people >= 1
   - require minNights >= 1
   - require maxNights >= minNights

3. Scanning
   - worker scans only enabled alerts
   - CLI scan can scan all enabled alerts or one alert by id
   - disabled alerts are skipped
   - scan summary reports skipped/disabled alerts clearly

4. Notifications
   - send notifications only if alert is enabled
   - send email only if alert.emailEnabled is true
   - console notifications can remain default
   - duplicate hits must not notify again

5. Calendar
   - calendar sync should use alerts with calendarEnabled true if available
   - otherwise preserve existing behavior

6. State
   - latest scan results should be keyed by alertId/targetId
   - historical hits should preserve alert name, park, campground, dates, site, booking URL, and source URL

## API Routes

If the web app already has API routes, add or update local API routes:

- GET /api/alerts
- POST /api/alerts
- GET /api/alerts/[id]
- PUT /api/alerts/[id]
- DELETE /api/alerts/[id]
- POST /api/alerts/[id]/enable
- POST /api/alerts/[id]/disable
- POST /api/alerts/[id]/scan

If dynamic route setup is too much, a simpler API shape is acceptable:

- GET /api/alerts
- POST /api/alerts
- PUT /api/alerts
- DELETE /api/alerts?id=...

## Tests

Add tests for:

1. Create valid alert
2. Reject invalid alert with no acceptable sites
3. Reject maxNights less than minNights
4. Disable alert excludes it from worker scan
5. CLI scan skips disabled alerts
6. Email notification respects emailEnabled
7. Calendar sync respects calendarEnabled if implemented
8. Existing Angel Island seed still works
9. data/targets.json compatibility if preserved
10. Dedupe still works with alert IDs

## CLI Behavior

Keep or add:

- campbrain alerts list
- campbrain alerts enable <id>
- campbrain alerts disable <id>
- campbrain scan --target <id>
- campbrain scan --alert <id> if target naming changes

Do not break existing npm scripts:
- npm run upcoming
- npm run scan
- npm run worker
- npm run sync-calendar
- npm run verify

## Verification

Goal complete only when:
- npm run typecheck passes
- npm test passes
- npm run upcoming passes
- npm run scan passes
- npm run verify passes
