> ARCHIVED — historical intent, superseded by docs/reference/. Not current truth.

# Goal: Local CampBrain UI

## Objective

Build a minimal local web UI for CampBrain so I can view camping targets, upcoming booking windows, and Angel Island scan results without using only the CLI.

This goal is complete when:
- npm run verify passes
- npm run dev starts a local UI
- the UI displays targets from data/targets.json
- the UI displays upcoming booking windows
- the UI can run or display Angel Island Ridge scan results
- no booking automation, login automation, CAPTCHA bypassing, or checkout automation is implemented

## Scope

Implement:
- Minimal local web UI
- Target list view
- Upcoming booking window view
- Scan results view
- Basic target creation/editing if simple
- Reuse existing scanner/types/parser logic

Do not implement:
- authentication
- database
- Supabase
- email
- SMS
- Google Calendar
- cron
- auto-booking
- browser automation
- CAPTCHA bypassing
- queue evasion
- commercial SaaS features

## Stack

Use a simple local web stack.

Preferred:
- Next.js
- React
- TypeScript

Keep styling simple:
- plain CSS or minimal Tailwind if already easy
- no design-system rabbit holes
- no shadcn setup unless necessary

## Required UI Pages

### Dashboard

Show:
- app name: CampBrain
- active targets
- next booking windows
- latest scan summary
- clear status states

### Target Detail

For each target, show:
- target name
- park
- campground
- acceptable sites
- people
- date range
- min nights
- max nights
- weekend-only setting
- booking rule

### Upcoming Booking Windows

Show:
- candidate stay
- booking opens date/time
- reminders:
  - 7 days before
  - night before
  - 10 minutes before release

### Scan Results

Show:
- target name
- candidate date range
- source URL
- booking URL
- per-site/per-date availability table
- MATCH badge when available
- no matches message when unavailable

## API / Server Behavior

If using Next.js:
- Add server route or server action to run scans.
- Do not expose secrets.
- Do not run scans automatically on page load if it would create excessive requests.
- Prefer a manual "Run Scan" button for now.

## Data

Read targets from:
- data/targets.json

For now, scan results can be:
- generated on demand
- kept in memory
- or written to a local JSON file

No database yet.

## Verification

Goal is complete only when:

- npm run typecheck passes
- npm test passes
- npm run upcoming passes
- npm run scan passes
- npm run dev starts successfully

If adding a UI-specific test command, include it in npm run verify.
