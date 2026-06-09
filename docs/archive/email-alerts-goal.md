> ARCHIVED — historical intent, superseded by docs/reference/. Not current truth.

# Goal: Email Alerts for New Availability Hits

## Objective

Add email notifications when CampBrain finds a new availability hit.

This goal is complete when:
- npm run verify passes
- npm run scan persists hits
- new hits trigger an email notification when email env vars are configured
- repeated hits do not re-alert due to dedupe
- scan still works when email env vars are missing

## Scope

Implement:
- NotificationService interface
- ConsoleNotificationService
- EmailNotificationService
- email alert formatting
- dedupe-aware alert sending
- tests for notification behavior

Do not implement:
- SMS
- Google Calendar
- cron
- Supabase
- auth
- browser automation
- login automation
- auto-booking
- CAPTCHA bypassing
- queue evasion

## Email Provider

Use Resend unless there is already another provider configured.

Environment variables:
- RESEND_API_KEY
- ALERT_EMAIL_TO
- ALERT_EMAIL_FROM

Behavior:
- If env vars are missing, do not crash.
- Print a clear message that email is skipped.
- Console alerts should still work.

## Alert Trigger Rules

Send an email only when:
- a new AvailabilityHit is found
- the hit was not previously stored in .campbrain/state/availability-hits.json

Do not send duplicate alerts for the same:
- targetId
- siteName
- arrivalDate
- departureDate

## Email Content

Subject:
CampBrain: campsite opening found

Body should include:
- target name
- park
- campground
- site name
- arrival date
- departure date
- number of nights
- booking URL
- source URL
- checked time

Include a warning:
Availability can disappear quickly. Complete booking manually on the official reservation site.

## CLI Behavior

npm run scan should:
1. run scan
2. write state
3. identify newly persisted hits
4. send notifications for new hits only

Add optional flags if simple:
- --no-notify
- --notify

Default:
- console notification always
- email notification only if configured

## Tests

Add tests for:
1. new hit triggers notification
2. duplicate hit does not trigger notification
3. missing email env vars does not crash
4. email body includes booking URL and source URL
5. console notification formats useful output

## Verification

Goal complete only when:
- npm run typecheck passes
- npm test passes
- npm run upcoming passes
- npm run scan passes
- npm run verify passes
