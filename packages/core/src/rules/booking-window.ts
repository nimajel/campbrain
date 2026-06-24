import dayjs from "dayjs";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore.js";
import type { TargetDatePattern, BookingRule, BookingWindow } from "@campbrain/types";
import { getBookingWindowTime, getReminderTimes } from "../utils/dates";

dayjs.extend(isSameOrBefore);

function assertNever(x: never): never {
  throw new Error(`expandArrivalDates: unhandled pattern kind '${String((x as { kind?: unknown }).kind)}'`);
}

function iterateDays(from: string, to: string, weekendsOnly: boolean): string[] {
  const dates: string[] = [];
  let cur = dayjs(from);
  const end = dayjs(to);
  while (cur.isSameOrBefore(end)) {
    const dow = cur.day();
    if (!weekendsOnly || dow === 5 || dow === 6) dates.push(cur.format("YYYY-MM-DD"));
    cur = cur.add(1, "day");
  }
  return dates;
}

export function expandArrivalDates(pattern: TargetDatePattern, today: string): string[] {
  switch (pattern.kind) {
    case "exact":
      return [pattern.date];
    case "range":
      return iterateDays(pattern.from, pattern.to, pattern.weekendsOnly);
    case "rolling_weekends": {
      const dates: string[] = [];
      let cur = dayjs(today).add(1, "day");
      let found = 0;
      while (found < pattern.weeks) {
        if (cur.day() === 5) {
          dates.push(cur.format("YYYY-MM-DD"));
          dates.push(cur.add(1, "day").format("YYYY-MM-DD"));
          found++;
          cur = cur.add(7, "day");
        } else {
          cur = cur.add(1, "day");
        }
      }
      return dates;
    }
    default:
      return assertNever(pattern);
  }
}

export function computeBookingWindows(
  pattern: TargetDatePattern,
  rule: BookingRule,
  today: string
): BookingWindow[] {
  return expandArrivalDates(pattern, today).map((arrivalDate) => {
    const open = getBookingWindowTime(arrivalDate, rule.monthsBefore, rule.releaseTime, rule.timezone);
    const r = getReminderTimes(open);
    return {
      arrivalDate,
      bookingOpensAt: open.toISOString(),
      reminders: {
        sevenDaysBefore: r.sevenDaysBefore.toISOString(),
        nightBefore: r.nightBefore.toISOString(),
        tenMinutesBefore: r.tenMinutesBefore.toISOString(),
      },
    };
  });
}
