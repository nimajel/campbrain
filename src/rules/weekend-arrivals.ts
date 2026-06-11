import dayjs from 'dayjs';

export interface WeekendArrival {
  arrivalDate: string;
  nights: number;
}

/**
 * Generates Fri + Sat arrival candidates within [today+1, today+horizonDays].
 *
 * - Friday arrivals: exactly minNights nights.
 * - Saturday arrivals: always 1N (Sat→Sun); dropped when minNights > 1.
 */
export function weekendArrivals(
  today: string,
  horizonDays: number,
  minNights: 1 | 2 | 3,
): WeekendArrival[] {
  const base = dayjs(today);
  const horizon = base.add(horizonDays, 'day');
  const results: WeekendArrival[] = [];
  let current = base.add(1, 'day');

  while (current.isBefore(horizon) || current.isSame(horizon, 'day')) {
    const dow = current.day();

    if (dow === 5) {
      results.push({ arrivalDate: current.format('YYYY-MM-DD'), nights: minNights });
    } else if (dow === 6 && minNights <= 1) {
      results.push({ arrivalDate: current.format('YYYY-MM-DD'), nights: 1 });
    }

    current = current.add(1, 'day');
  }

  return results;
}
