> ARCHIVED — historical intent, superseded by docs/reference/. Not current truth.

# Goal: Local Scan State and History

## Objective

Add local persistence for scan results so CampBrain can show the latest scan status and previous availability hits in the UI without requiring a fresh scan every page load.

This goal is complete when:
- npm run verify passes
- npm run dev starts the UI
- npm run scan writes latest scan results to local state
- the dashboard shows latest scan status from local state
- the scan page shows last checked time and previous hits

## Scope

Implement:
- Local JSON state files under .campbrain/state/
- Latest scan result persistence
- Availability hit persistence with deduping
- UI display for latest scan result
- UI display for historical hits
- CLI scan should write state by default

Do not implement:
- SQLite
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

## Required State Files

Use:

.campbrain/state/latest-scan-results.json
.campbrain/state/availability-hits.json

Create directories automatically if missing.

## Required Behavior

When npm run scan runs:
1. Run scan normally.
2. Write latest scan results to .campbrain/state/latest-scan-results.json.
3. If any availability hits are found:
   - write them to .campbrain/state/availability-hits.json
   - dedupe by targetId + siteName + arrivalDate + departureDate

When UI loads:
1. Dashboard reads latest scan state.
2. Dashboard shows:
   - last checked time
   - number of candidates scanned
   - number of matches
   - latest matches if any
3. Scan page shows:
   - latest scan result
   - previous hits

## Verification

Goal is complete only when:
- npm run typecheck passes
- npm test passes
- npm run upcoming passes
- npm run scan passes
- npm run build:web passes if available
- npm run verify passes
