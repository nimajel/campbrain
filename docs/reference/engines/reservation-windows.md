# CampBrain — Reservation Windows Engine

**Status:** shipped

The reservation-windows engine answers the question "when do I need to act?" It computes the exact date and time a booking window opens for any target arrival date, along with reminder times. This is distinct from availability scanning — it operates entirely on dates and rules, with no network calls.

---

## Purpose

Calculate the reservation opening time for a configured trip target, accounting for the provider's booking-lead rule (months before arrival) and release time (time of day in a specified timezone). Drives `npm run upcoming` and Google Calendar sync.

---

## Responsibilities

- Given a `Target` and its `bookingRule`, compute `bookingOpenTime` for each arrival date.
- Derive three reminder times per arrival: 7 days before, night before (20:00), and 10 minutes before.
- Support all four date modes: `exact_dates`, `date_range`, `weekend_range`, `next_available_weekend`.
- Surface upcoming booking windows via `npm run upcoming` (CLI).

---

## Key files

| Path | Role |
|---|---|
| `src/rules/booking-window.ts` | `calculateBookingWindows(target)` — primary entry point |
| `src/utils/dates.ts` | `getBookingWindowTime()`, `getReminderTimes()` — pure date math |
| `src/cli/commands/upcoming.ts` | `upcomingCommand()` — CLI renderer for upcoming windows |

---

## Algorithms & invariants

### Booking window calculation

`getBookingWindowTime(arrivalDate, monthsBefore, releaseTime, tz)` in `src/utils/dates.ts`:

```
bookingDate = arrivalDate - monthsBefore months   // dayjs .subtract(monthsBefore, 'month')
bookingOpenTime = bookingDate at releaseTime in tz
```

For California State Parks:
- `monthsBefore = 6` — reservations open exactly 6 calendar months to the day before arrival.
- `releaseTime = "08:00"`, `timezone = "America/Los_Angeles"`.

Example: arrival 2026-12-25 → booking opens 2026-06-25 at 08:00 America/Los_Angeles.

The `timezone` parameter is used with `dayjs.tz()` so the resulting timestamp is correct across DST transitions.

### Reminder times

`getReminderTimes(bookingWindowTime)` in `src/utils/dates.ts`:

| Reminder | Rule |
|---|---|
| `sevenDaysBefore` | `bookingWindowTime - 7 days`, clamped to 09:00 |
| `nightBefore` | `bookingWindowTime - 1 day`, clamped to 20:00 |
| `tenMinutesBefore` | `bookingWindowTime - 10 minutes` (exact) |

### Booking rule shape

The `bookingRule` field on a `Target` (from `src/config/schemas.ts`):

```typescript
bookingRule: {
  monthsBefore: number;   // 6 for CA State Parks
  releaseTime: string;    // "HH:MM" (24-hour)
  timezone: string;       // IANA tz name, e.g. "America/Los_Angeles"
}
```

### Date modes

`calculateBookingWindows` delegates arrival-date generation to `getArrivalDates(target)` which handles all four modes:

| Mode | Logic |
|---|---|
| `exact_dates` | Single date from `target.exactStartDate` |
| `date_range` | Every day in `[rangeStart, rangeEnd]`; filtered by `weekendsOnly` if set |
| `weekend_range` | Same as `date_range` but always weekends-only |
| `next_available_weekend` | Next `nextWeeksCount` (default 12) Friday + Saturday pairs from tomorrow |

### `calculateBookingWindows` return shape

```typescript
export interface BookingWindowInfo {
  arrivalDate: string;
  bookingOpenTime: string;          // "YYYY-MM-DD HH:mm:ss ±HH:MM"
  reminderSevenDaysBefore: string;
  reminderNightBefore: string;
  reminderTenMinutesBefore: string;
}
```

---

## Reproduction checklist

1. Add a target to your config (or use an existing one in `.campbrain/config/targets.json`).
2. Run `npm run upcoming` — verify the output shows booking open times and reminder times.
3. Spot-check: choose an arrival date 6 months out. Confirm `bookingOpenTime` is exactly 6 months prior at 08:00 America/Los_Angeles. Account for DST if near a spring/fall transition.
4. Verify reminder times: `sevenDaysBefore` = 7 days before booking open at 09:00; `nightBefore` = day before at 20:00; `tenMinutesBefore` = 10 min before booking open.
5. Run `npm run typecheck && npm test`.

> Future: the Google Calendar sync (`npm run sync-calendar`) uses these booking windows to create calendar events and reminder notifications. The sync is wired but target-matching is WIP.

---

## Dependencies

- No upstream engine dependencies — operates on configured `Target` objects and pure date math.
- Consumed by `src/cli/commands/upcoming.ts` (CLI output) and `src/cli/commands/sync-calendar.ts` (Google Calendar sync).
- If targets are stored in [../data-model.md](../data-model.md) in a future schema change, this engine would depend on that; currently targets are loaded from JSON config only.
