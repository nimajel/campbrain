# CampBrain

## Project

Personal-use camping reservation assistant for California campgrounds, wilderness permits, and high-demand reservation systems.

Purpose:
- Track desired camping trips
- Calculate reservation and lottery windows
- Monitor campsite availability
- Generate alerts when matching campsites become available
- Browse availability across all CA state parks with instant filtering

This is NOT an automated booking bot.

Do not implement:
- CAPTCHA bypassing
- Queue evasion
- Automated checkout
- Login automation
- Proxy rotation
- High-frequency abusive scraping

The system assists in finding and preparing for reservations, while the user completes bookings manually.

---

## Current MVP

Fully operational two-tier system:

**1. Proactive Scanner** (`npm run worker`)
- Scans all 88 CA state parks every 2 hours
- Covers 180-day booking window in 8-day windows (matches parks.ca.gov API limit)
- Stores per-site per-day availability grid
- ~2,024 cache entries total; ~871 have availability
- Full scan takes ~11 minutes on startup, then every 2 hours thereafter

**2. Web UI** (`npm run dev` → `http://localhost:3001/available` — "What's Available")
- Real-time multi-park availability search with filters
- Date range picker (from / to)
- Multi-site filter panel (e.g., "Exclude group", "Hike-in only")
- Night count selector (1N, 2N, All)
- Weekend-only toggle
- Campground pricing display (nightly + total cost)
- Park cards collapsed by default
- Pagination: 10 date groups initially, "Show more" for additional weeks
- Filter response: <200ms
- Manual "Refresh now" to trigger on-demand scan
- Book buttons pre-populate arrival date and nights on ReserveCalifornia

Provider:
- California State Parks / ReserveCalifornia
- Endpoint: `https://www.parks.ca.gov/AvailabilityInfo?arrival_date=YYYY-MM-DD&length=8&page_id=PARKID`
- Note: `length` param is ignored by the API; always returns exactly 8 days regardless

Reservation rules:
- Reservations open 6 months to the day before arrival
- Release time: 8:00 AM America/Los_Angeles

---

## Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript (strict, no `any`)
- **CLI**: commander
- **Validation**: zod
- **HTML parsing**: cheerio
- **Scheduling**: node-cron
- **Date handling**: dayjs
- **Execution**: tsx
- **Config**: JSON
- **Cache**: File-based JSON (`.campbrain/state/availability-cache.json`)
- **Web**: Next.js 14, React 18
- **UI**: Tailwind CSS + light custom CSS

Future (not yet built):
- SQLite / Supabase for persistence
- Google Calendar API for reminders
- Email / SMS / Slack notifications

---

## Project Structure

```
src/
  cli/              CLI commands (worker, scan, etc.)
  config/           Configuration loading and validation
  providers/        Provider adapters (California Parks parser + URL builder)
  rules/            Reservation window logic
  scanner/          Proactive availability scanner
  catalog/          Park/campground metadata loading
  cache/            Availability cache (v2: window-based)
  utils/            Shared utilities (concurrency, etc.)

web/
  app/
    available/      "What's Available" page + AvailableClient
    api/            API routes (data fetch, refresh trigger)
    components/     Shared React components (SiteFilterPanel, ParkMapPopover)
  lib/              Client-safe utilities (queries, filters, booking URL, catalog)

data/
  catalog/          CA parks seed data (california-parks.json)

.campbrain/
  state/            Runtime cache (availability-cache.json)
  logs/             Debug logs
  debug/            HTML snapshots saved on parsing uncertainty
```

---

## Core Architecture

### Three Engines

1. **Trip Target Engine** — What do I want?
   - Currently: filter controls on the web page
   - Later: user-defined saved searches

2. **Reservation Window Engine** — When should I act?
   - Calculates 6-month booking window + 8 AM release time
   - Drives `npm run upcoming` output

3. **Availability Scanner Engine** — Is anything available now?
   - Proactive: background 8-day window scan of all parks
   - Reactive: alert scanner for specific saved targets (future)

Provider-specific logic stays isolated behind adapters. Do not mix parsing logic into CLI or business logic.

---

## Cache Architecture (v2)

**Key design**: One cache entry per `(parkPageId, windowStart)` storing a full per-site per-day grid. Any night-count query (1N, 2N, 3N…) is answered at read time from the stored grid — no extra fetches needed.

**Before (v1)**: Separate entries for each `(arrivalDate, nights)` pair → 23,040 entries to cover 180 days × 88 parks × {1N, 2N}.
**Now (v2)**: One entry per park × 8-day window → ~2,024 entries total.

Entry shape:
```typescript
interface AvailabilityWindowEntry {
  parkPageId: string;
  parkName: string;
  windowStart: string;        // e.g. "2026-06-05"
  windowEnd: string;          // windowStart + 7 days (8 days inclusive)
  scannedAt: string;
  sourceUrl: string;
  campgrounds: {
    id: string;
    name: string;
    nightlyFee?: number;
    bookingUrl?: string;
    sites: {
      name: string;
      dates: Record<string, 'available' | 'unavailable' | 'unknown'>;
    }[];
  }[];
}
```

Cache key: `${parkPageId}::${windowStart}`

TTL by days-until-windowStart:
- `< 7 days`: 30 min
- `7–30 days`: 2 hours
- `30–90 days`: 4 hours
- `> 90 days`: 8 hours

---

## Web Performance

**Problem**: 88 parks × 180 dates × filter checks was slow (~800ms per toggle).

**Solution** (in order of impact):
1. **Park cards collapsed by default** — Only header row renders; biggest single win
2. **Early-exit pagination** — `groupFromLookup` stops after PAGE_SIZE (10) date groups; skips ~170 dates
3. **Pre-computed flat lookup** — Built once on entries change: `parkId → campground → site → date → status`
4. **Synchronous useMemo** — Replaces `useEffect + startTransition`; early-exit computation is fast enough that async scheduling only added latency
5. **Campground filter cache** — Regex results memoized per (name, filterSet) within each call
6. **React.memo** on `DateSection`, `ParkCard`, `CampgroundRow`

**Result**: 102–173ms per filter toggle (target: <200ms).

---

## Commands

Available:
- `npm run worker` — Start proactive scanner (runs immediately on startup + every 2h)
- `npm run dev` — Start Next.js dev server (port 3001)
- `npm run typecheck` — TypeScript check
- `npm run upcoming` — Print upcoming booking windows for configured targets

Planned:
- `npm run scan --target <name>` — Alert-based target scanning
- `npm run notify-test` — Send test notification

---

## Conventions

- TypeScript only, strict mode, no `any` — prefer `unknown` and narrow the type
- Files: kebab-case
- Classes/types: PascalCase
- Variables/functions: camelCase
- Database columns (future): snake_case
- Pure functions where possible
- async/await consistently
- Early returns over nested conditionals
- Provider adapters must be modular and independently testable
- Save raw HTML snapshots when parser confidence is low
- Do not hardcode park-specific values (Angel Island, page_id 468, sites #4–#6) outside seed data and tests

---

## Parsing Rules

Provider parsers must:
- Be resilient to HTML structure changes
- Save debug HTML when parsing fails or confidence is low (`.campbrain/debug/`)
- Return structured typed results
- Include the source URL in scan results

Polling limits:
- Normal: every 60–120 minutes
- Close to target date: every 15–30 minutes
- Never poll every few seconds

---

## Verification

After every meaningful change, run:
- `npm run typecheck`
- Test the relevant CLI command or web page manually

Before committing:
- TypeScript must pass
- Web page loads and renders without console errors
- Filters respond in <200ms
- No hydration warnings or React errors
- No duplicate alert notifications

---

## MVP Acceptance Criteria

✓ Version 1 complete:

1. ✓ `npm run worker` populates 8-day windows across 180 days for all 88 CA parks
2. ✓ `/available` page shows parks with availability, filterable in <200ms
3. ✓ Pricing (nightly + total) displayed per campground
4. ✓ Book buttons pre-populate dates on ReserveCalifornia
5. ✓ System does NOT book, log in, bypass CAPTCHA, or automate checkout

---

## Next Steps

- [ ] Alert scanner for saved targets (email/Slack when a matching site opens up)
- [ ] Google Calendar sync for booking window reminders
- [ ] Persistent target storage (SQLite / Supabase)
- [ ] User-defined saved searches
- [ ] Lottery window calculator (Yosemite, Death Valley, etc.)
- [ ] Recreation.gov and other provider adapters
- [ ] SMS notifications

---

## Design Philosophy

Reliable. Deterministic. Understandable. Modular. Easy to debug. Useful before fancy.

Parse once, cache in windows. Early-exit on filters. Collapse cards by default. MVP first.
