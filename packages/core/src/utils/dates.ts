import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrBefore);

export function getWeekendDatesInRange(
  startDate: string,
  endDate: string
): string[] {
  const start = dayjs(startDate);
  const end = dayjs(endDate);

  const weekends: string[] = [];
  let current = start;

  while (current.isSameOrBefore(end)) {
    const dayOfWeek = current.day(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      // Saturday or Sunday
      weekends.push(current.format('YYYY-MM-DD'));
    }
    current = current.add(1, 'day');
  }

  return weekends;
}

export function parseTimeInTimezone(
  timeStr: string,
  timezone: string
): dayjs.Dayjs {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return dayjs.tz(`1970-01-01 ${hours}:${minutes}`, 'YYYY-MM-DD HH:mm', timezone);
}

export function getBookingWindowTime(
  arrivalDate: string,
  monthsBefore: number,
  releaseTime: string,
  tz: string
): dayjs.Dayjs {
  const arrival = dayjs(arrivalDate);
  const bookingDate = arrival.subtract(monthsBefore, 'month');

  const [hours, minutes] = releaseTime.split(':').map(Number);
  return dayjs.tz(
    `${bookingDate.format('YYYY-MM-DD')} ${hours}:${minutes}`,
    'YYYY-MM-DD HH:mm',
    tz
  );
}

export function getReminderTimes(
  bookingWindowTime: dayjs.Dayjs
): {
  sevenDaysBefore: dayjs.Dayjs;
  nightBefore: dayjs.Dayjs;
  tenMinutesBefore: dayjs.Dayjs;
} {
  return {
    sevenDaysBefore: bookingWindowTime.subtract(7, 'day').hour(9).minute(0).second(0),
    nightBefore: bookingWindowTime.subtract(1, 'day').hour(20).minute(0).second(0),
    tenMinutesBefore: bookingWindowTime.subtract(10, 'minute'),
  };
}

export function formatDateTime(dt: dayjs.Dayjs): string {
  return dt.format('YYYY-MM-DD HH:mm:ss Z');
}
