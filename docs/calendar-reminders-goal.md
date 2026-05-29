# Goal: Google Calendar Booking Reminders

## Objective

Add Google Calendar integration so CampBrain can create booking-window reminder events for configured camping targets.

This goal is complete when:
- npm run verify passes
- a calendar sync command creates or updates reminder events
- duplicate calendar events are avoided
- missing Google credentials fail gracefully
- calendar reminders are based on the same booking-window logic used by npm run upcoming

## Scope

Implement:
- Google Calendar sync command
- OAuth local token flow
- local calendar event state
- idempotent event creation
- calendar event formatting
- tests for event generation and dedupe logic

Do not implement:
- Supabase
- auth
- SMS
- browser automation
- login automation
- auto-booking
- CAPTCHA bypassing
- queue evasion

## Command

Add or complete:

- campbrain sync-calendar
- npm run sync-calendar

## Reminder Events

For each candidate stay, create:

1. Prep reminder
   - 7 days before booking opens
   - 9:00 AM local time

2. Night-before reminder
   - night before booking opens
   - 8:00 PM local time

3. Booking reminder
   - 10 minutes before release time

## Event Content

Title format:

CampBrain: Book {parkName} — {campgroundName}

Description should include:
- target name
- park
- campground
- target stay dates
- people
- camping type
- acceptable sites
- preferred sites
- booking opens time
- booking URL if available
- source availability URL if available
- checklist:
  - log into reservation site early
  - confirm payment method
  - open target page
  - have backup dates/sites ready
  - complete booking manually on official site

## Idempotency

Do not create duplicate events.

Store local calendar sync state in:

.campbrain/state/calendar-events.json

Dedupe key:

targetId + candidateArrivalDate + candidateDepartureDate + reminderType

If an event already exists, update it if content changed.

## Google Credentials

Use environment variables or local files:

- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI

Store OAuth token at:

.campbrain/google-token.json

If credentials are missing:
- do not crash
- print setup instructions
- allow dry-run output

## Dry Run

Add:

campbrain sync-calendar --dry-run

Dry run should print events that would be created/updated without calling Google.

## Tests

Add tests for:
1. reminder event generation
2. dedupe key generation
3. dry-run behavior
4. missing credentials behavior
5. update vs create decision logic

## Verification

Goal complete only when:
- npm run typecheck passes
- npm test passes
- npm run upcoming passes
- npm run scan passes
- npm run verify passes
