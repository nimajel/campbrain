cat > CLAUDE.md <<'EOF'
# CampBrain

## Project

Personal-use camping reservation assistant for California campgrounds, wilderness permits, and high-demand reservation systems.

Purpose:
- Track desired camping trips
- Calculate reservation and lottery windows
- Generate Google Calendar reminders
- Monitor campsite availability
- Send alerts when matching campsites become available

This is NOT an automated booking bot.

Do not implement:
- CAPTCHA bypassing
- Queue evasion
- Automated checkout
- Login automation
- Proxy rotation
- High-frequency abusive scraping

The system should assist me in finding and preparing for reservations, while I complete bookings manually.

---

## Current MVP

First use case:
- Angel Island State Park
- Ridge campground / Ridge sites 4-6
- Hike-in campsites #4, #5, #6
- Weekend reservation tracking and availability alerts

Provider:
- California State Parks / ReserveCalifornia

Known public availability endpoint:
- https://www.parks.ca.gov/AvailabilityInfo?arrival_date=YYYY-MM-DD&length=N&page_id=468

Known reservation rule:
- Reservations open 6 months to the day before arrival
- Release time: 8:00 AM America/Los_Angeles

---

## MVP Stack

- Runtime: Node.js
- Language: TypeScript
- CLI: commander
- Validation: zod
- HTML parsing: cheerio
- Scheduling: node-cron
- Date handling: dayjs
- Execution: tsx
- Config: JSON first
- Persistence: SQLite later
- Calendar: Google Calendar API later
- Notifications: Email/SMS later

Do not prematurely build a web app.

Future possible stack:
- Next.js
- React
- Supabase
- Tailwind
- shadcn/ui
- Vercel

But for now, build the local CLI first.

---

## Project Structure

src/
  cli/              CLI commands
  config/           config loading and validation
  providers/        provider-specific adapters and parsers
  rules/            reservation and lottery window logic
  notifications/    email/SMS/slack integrations
  calendar/         Google Calendar integration
  db/               SQLite persistence
  utils/            shared utilities

data/
  target definitions and local config

.campbrain/
  logs
  debug HTML snapshots
  runtime state

---

## Core Architecture Principles

Separate the system into three engines:

1. Trip Target Engine
   - What do I want?

2. Reservation Window Engine
   - When should I act?

3. Availability Scanner Engine
   - Is anything available now?

Provider-specific logic must stay isolated behind provider adapters.

Examples:
- CaliforniaParksProvider
- RecreationGovProvider
- YosemiteLotteryProvider

Do not mix provider parsing logic into CLI or business logic.

---

## Conventions

- TypeScript only
- No `any`
- Prefer `unknown` and narrow the type
- Prefer deterministic logic over AI-generated guessing
- Keep provider adapters modular and testable
- Save raw HTML snapshots when parser confidence is low
- Add useful logging around parsing behavior
- Avoid unnecessary dependencies
- Use environment variables for secrets/config
- Prefer pure functions when possible
- Use async/await consistently
- Keep the MVP simple

Naming:
- Files: kebab-case
- Classes/types: PascalCase
- Variables/functions: camelCase
- Database columns later: snake_case

---

## Parsing Rules

Provider parsers must:
- Be resilient to HTML structure changes
- Save debug HTML when parsing fails or confidence is low
- Return structured typed results
- Avoid brittle selector assumptions when possible
- Include the source URL in scan results

Do not aggressively poll providers.

Reasonable scan frequencies:
- Normal: every 60-120 minutes
- Close to target date: every 15-30 minutes
- Never poll every few seconds

---

## Commands

Current intended commands:
- npm run upcoming
- npm run scan
- npm run sync-calendar
- npm run typecheck

CLI commands should eventually include:
- campbrain upcoming
- campbrain scan
- campbrain scan --target angel-island-ridge-weekends
- campbrain sync-calendar
- campbrain notify-test

---

## Verification

After every meaningful change, run:
- npm run typecheck

Then run the relevant CLI command manually, such as:
- npm run upcoming
- npm run scan

Before considering a change done:
- TypeScript must pass
- CLI command must run
- Output should be understandable
- Parser behavior should be inspectable
- No duplicate alerts should be generated

---

## MVP Acceptance Criteria

Version 1 is successful when:

1. `npm run upcoming` prints upcoming booking windows and reminder times for Angel Island Ridge weekend targets.
2. `npm run scan` checks Angel Island Ridge sites #4, #5, and #6 for configured weekend dates.
3. The scanner returns structured results.
4. Raw/debug HTML is saved when parsing is uncertain.
5. The system does not attempt to book, log in, bypass CAPTCHA, or automate checkout.

---

## Design Philosophy

This project should be:
- reliable
- deterministic
- understandable
- modular
- easy to debug
- useful before it is fancy

MVP first.
Fancy architecture later.

The first useful version only needs:
- target definitions
- booking window calculations
- Angel Island availability scanning
- basic console alerts
- calendar reminders later
EOF