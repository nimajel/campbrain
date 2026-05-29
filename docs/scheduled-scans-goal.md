# Goal: Scheduled Scan Worker

## Objective

Add a local scheduled scan worker so CampBrain can automatically scan active targets on an interval and send notifications for new availability hits.

This goal is complete when:
- npm run verify passes
- a worker command can run scheduled scans locally
- scan interval is configurable
- the worker uses the existing scan/state/notification logic
- duplicate hits do not re-alert

## Scope

Implement:
- reusable scan orchestration function shared by CLI and worker
- local worker command
- interval configuration
- graceful startup/shutdown
- tests for worker/orchestration behavior where practical

Do not implement:
- cloud deployment
- Supabase
- auth
- Google Calendar
- browser automation
- login automation
- auto-booking
- CAPTCHA bypassing
- queue evasion

## Required Behavior

Add command:

- campbrain worker
- npm run worker

The worker should:
1. Load active targets from data/targets.json.
2. Run scans on a configurable interval.
3. Persist latest scan results.
4. Persist new availability hits.
5. Send notifications for new hits only.
6. Log:
   - worker start time
   - scan interval
   - target count
   - each scan start/end
   - match count
   - notification count
7. Handle Ctrl+C cleanly.

## Configuration

Support environment variables:

- CAMPBRAIN_SCAN_INTERVAL_MINUTES
- CAMPBRAIN_SCAN_ON_START

Defaults:
- CAMPBRAIN_SCAN_INTERVAL_MINUTES=60
- CAMPBRAIN_SCAN_ON_START=true

Also add CLI flags if simple:
- --interval-minutes
- --no-scan-on-start
- --target

## Reuse

Do not duplicate scan logic.

Extract shared scan orchestration from CLI scan into something like:

- src/scanner/run-scan.ts

Both CLI scan and worker should call the same function.

## Safety

Do not scan aggressively.

Minimum allowed interval:
- 15 minutes

If the user sets lower than 15, clamp to 15 and log a warning.

## Verification

Goal complete only when:
- npm run typecheck passes
- npm test passes
- npm run upcoming passes
- npm run scan passes
- npm run verify passes
