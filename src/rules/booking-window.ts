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

export function calculateBookingWindows(target: Target): BookingWindowInfo[] {
  const { rangeStart, rangeEnd, bookingRule, weekendsOnly } = target;
  const start = dayjs(rangeStart);
  const end = dayjs(rangeEnd);

  const results: BookingWindowInfo[] = [];
  let current = start;

  while (current.isSameOrBefore(end)) {
    let shouldInclude = true;

    if (weekendsOnly) {
      const dayOfWeek = current.day(); // 0 = Sunday, 6 = Saturday
      shouldInclude = dayOfWeek === 5 || dayOfWeek === 6;
    }

    if (shouldInclude) {
      const arrivalDate = current.format('YYYY-MM-DD');
      const bookingWindowTime = getBookingWindowTime(
        arrivalDate,
        bookingRule.monthsBefore,
        bookingRule.releaseTime,
        bookingRule.timezone
      );

      const reminders = getReminderTimes(bookingWindowTime);

      results.push({
        arrivalDate,
        bookingOpenTime: bookingWindowTime.format('YYYY-MM-DD HH:mm:ss Z'),
        reminderSevenDaysBefore: reminders.sevenDaysBefore.format('YYYY-MM-DD HH:mm:ss Z'),
        reminderNightBefore: reminders.nightBefore.format('YYYY-MM-DD HH:mm:ss Z'),
        reminderTenMinutesBefore: reminders.tenMinutesBefore.format('YYYY-MM-DD HH:mm:ss Z'),
      });
    }

    current = current.add(1, 'day');
  }

  return results;
}
