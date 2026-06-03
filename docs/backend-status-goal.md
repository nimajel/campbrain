# Goal: Backend Setup and Status

## Objective

Expose backend setup/status information so the UI can clearly show whether CampBrain is ready to send alerts, sync calendar reminders, and run scheduled scans.

This goal is complete when:
- npm run verify passes
- UI can call an API route to inspect setup status
- backend reports email/calendar/worker configuration safely
- no secrets are exposed

## Scope

Implement:
- setup/status service
- API route for status
- safe environment variable checks
- worker config summary
- calendar config summary
- email config summary
- tests

Do not implement:
- SMS
- Supabase
- auth
- cloud deployment
- browser automation
- login automation
- auto-booking
- CAPTCHA bypassing
- queue evasion

## Required Status Fields

Expose:

email:
- configured: boolean
- hasResendApiKey: boolean
- hasAlertEmailTo: boolean
- hasAlertEmailFrom: boolean
- safeDestinationLabel, e.g. masked email

calendar:
- configured: boolean
- hasGoogleClientId: boolean
- hasGoogleClientSecret: boolean
- hasGoogleRedirectUri: boolean
- hasSavedToken: boolean

worker:
- alertIntervalMinutes
- proactiveIntervalMinutes
- scanOnStart
- minimumIntervalMinutes
- recommendedCommand

state:
- latestScanResultsExists
- availabilityHitsExists
- calendarEventsExists

targetsOrAlerts:
- count
- enabledCount
- disabledCount

Do not return raw secrets.

## API Route

Add:

- GET /api/status

## Tests

Add tests for:
1. missing email env vars
2. configured email env vars
3. missing calendar env vars
4. saved token detection
5. no raw secrets in output
6. alert counts

## Verification

Goal complete only when:
- npm run verify passes
