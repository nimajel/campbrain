import { type Target } from '../config/schemas.js';
import { getBookingWindowTime, getReminderTimes } from '../utils/dates.js';
import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';

dayjs.extend(isSameOrBefore);

export interface BookingWindowInfo {
  arrivalDate: string;
  bookingOpenTime: string;
  reminderSevenDaysBefore: string;
  reminderNightBefore: string;
  reminderTenMinutesBefore: string;
}

function assertNever(x: never): never {
  throw new Error(`Unhandled date mode: ${String(x)}`);
}

function getArrivalDates(target: Target, today?: string): string[] {
  switch (target.dateMode) {
    case 'exact_dates': {
      if (!target.exactStartDate) return [];
      return [target.exactStartDate];
    }
    case 'date_range': {
      if (!target.rangeStart || !target.rangeEnd) return [];
      return iterateDays(target.rangeStart, target.rangeEnd, target.weekendsOnly);
    }
    case 'weekend_range': {
      if (!target.rangeStart || !target.rangeEnd) return [];
      return iterateDays(target.rangeStart, target.rangeEnd, true);
    }
    case 'next_available_weekend': {
      const count = target.nextWeeksCount ?? 12;
      const base = today ? dayjs(today) : dayjs();
      const dates: string[] = [];
      let current = base.add(1, 'day');
      let weeksFound = 0;

      while (weeksFound < count) {
        if (current.day() === 5) {
          dates.push(current.format('YYYY-MM-DD')); // Friday
          dates.push(current.add(1, 'day').format('YYYY-MM-DD')); // Saturday
          weeksFound++;
          current = current.add(7, 'day');
        } else {
          current = current.add(1, 'day');
        }
      }

      return dates;
    }
    default:
      return assertNever(target.dateMode);
  }
}

function iterateDays(rangeStart: string, rangeEnd: string, weekendsOnly: boolean): string[] {
  const start = dayjs(rangeStart);
  const end = dayjs(rangeEnd);
  const dates: string[] = [];
  let current = start;

  while (current.isSameOrBefore(end)) {
    const dow = current.day();
    if (!weekendsOnly || dow === 5 || dow === 6) {
      dates.push(current.format('YYYY-MM-DD'));
    }
    current = current.add(1, 'day');
  }

  return dates;
}

export function calculateBookingWindows(target: Target, today?: string): BookingWindowInfo[] {
  const arrivalDates = getArrivalDates(target, today);

  return arrivalDates.map((arrivalDate) => {
    const bookingWindowTime = getBookingWindowTime(
      arrivalDate,
      target.bookingRule.monthsBefore,
      target.bookingRule.releaseTime,
      target.bookingRule.timezone
    );
    const reminders = getReminderTimes(bookingWindowTime);

    return {
      arrivalDate,
      bookingOpenTime: bookingWindowTime.format('YYYY-MM-DD HH:mm:ss Z'),
      reminderSevenDaysBefore: reminders.sevenDaysBefore.format('YYYY-MM-DD HH:mm:ss Z'),
      reminderNightBefore: reminders.nightBefore.format('YYYY-MM-DD HH:mm:ss Z'),
      reminderTenMinutesBefore: reminders.tenMinutesBefore.format('YYYY-MM-DD HH:mm:ss Z'),
    };
  });
}
