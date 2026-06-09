> ARCHIVED — historical intent, superseded by docs/reference/. Not current truth.

# Goal: Alerts UI

## Objective

Build the CampBrain UI around campsite alerts.

The UI should let me create, edit, enable, disable, scan, and monitor campsite alerts for campgrounds.

This goal is complete when:
- npm run verify passes
- npm run dev starts
- I can create an alert from the UI
- I can scan an alert from the UI
- I can see whether alerts are enabled
- I can see latest scan state and historical hits
- I can see email/calendar setup status

## Scope

Implement:
- Alerts dashboard
- Alert create/edit form
- Alert detail page or expandable alert cards
- Manual scan button per alert
- Alert enable/disable toggle
- Latest scan results
- Historical hits
- Setup/status panel
- Clear empty/loading/error states

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

## Navigation

Main navigation:

- Dashboard
- Alerts
- Scan History
- Calendar
- Settings

## Dashboard

Show:
- total alerts
- enabled alerts
- latest scan time
- number of historical hits
- latest hits
- next booking reminders
- setup status summary:
  - email configured
  - calendar configured
  - worker command

## Alerts Page

Show alert cards/table with:

- alert name
- enabled/disabled
- park
- campground
- date mode
- people
- min/max nights
- notification settings
- last checked
- latest match count
- actions:
  - scan now
  - edit
  - enable/disable
  - delete

## Alert Form

Fields:

- alert name
- enabled
- provider
- park name
- California Parks page_id
- campground name
- acceptable sites textarea, one per line
- preferred sites textarea, one per line
- camping type
- people
- date mode
- exact dates if exact_dates
- range dates if date_range or weekend_range
- next available weekend weeks if next_available_weekend
- min nights
- max nights
- weekends only
- email alerts enabled
- calendar reminders enabled
- scan interval minutes

Keep it simple. Do not over-design.

## Scan History Page

Show:
- latest scan results by alert
- historical availability hits
- booking URL
- source URL
- checked time
- site name
- arrival/departure

## Calendar Page

Show:
- dry-run preview if simple
- existing local calendar event records
- setup instructions if Google credentials missing

## Settings Page

Show:
- email setup status
- calendar setup status
- worker setup command
- local state file status
- safety notes

Do not expose raw secrets.

## UX Requirements

Add clear states for:
- no alerts yet
- no scan results yet
- no hits yet
- scan running
- scan failed
- email not configured
- calendar not configured
- worker is local command

## Verification

Goal complete only when:
- npm run verify passes
- npm run dev starts
- UI pages render without errors
