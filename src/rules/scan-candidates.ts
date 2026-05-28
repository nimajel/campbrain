import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import type { Target } from '../config/schemas.js';
import type { ScanCandidate } from '../types/scanner.js';

dayjs.extend(isSameOrBefore);

function assertNever(x: never): never {
  throw new Error(`Unhandled date mode: ${String(x)}`);
}

export function generateScanCandidates(target: Target, today?: string): ScanCandidate[] {
  switch (target.dateMode) {
    case 'exact_dates':
      return generateExactDates(target);
    case 'date_range':
      return generateDateRange(target);
    case 'weekend_range':
      return generateWeekendRange(target);
    case 'next_available_weekend':
      return generateNextAvailableWeekend(target, today);
    default:
      return assertNever(target.dateMode);
  }
}

function generateExactDates(target: Target): ScanCandidate[] {
  const { exactStartDate, exactEndDate, minNights, maxNights } = target;
  if (!exactStartDate) return [];

  const start = dayjs(exactStartDate);

  if (exactEndDate) {
    const nights = dayjs(exactEndDate).diff(start, 'day');
    return [{ arrivalDate: exactStartDate, nights, endDate: exactEndDate }];
  }

  // No end date — generate one candidate per valid night count
  const candidates: ScanCandidate[] = [];
  for (let n = minNights; n <= maxNights; n++) {
    candidates.push({
      arrivalDate: exactStartDate,
      nights: n,
      endDate: start.add(n, 'day').format('YYYY-MM-DD'),
    });
  }
  return candidates;
}

function generateDateRange(target: Target): ScanCandidate[] {
  const { rangeStart, rangeEnd, minNights, maxNights, weekendsOnly } = target;
  if (!rangeStart || !rangeEnd) return [];

  const candidates: ScanCandidate[] = [];
  const start = dayjs(rangeStart);
  const end = dayjs(rangeEnd);
  let current = start;

  while (current.isSameOrBefore(end)) {
    const dow = current.day();
    const isWeekendDay = dow === 5 || dow === 6;

    if (!weekendsOnly || isWeekendDay) {
      for (let n = minNights; n <= maxNights; n++) {
        candidates.push({
          arrivalDate: current.format('YYYY-MM-DD'),
          nights: n,
          endDate: current.add(n, 'day').format('YYYY-MM-DD'),
        });
      }
    }

    current = current.add(1, 'day');
  }

  return candidates;
}

function generateWeekendRange(target: Target): ScanCandidate[] {
  const { rangeStart, rangeEnd, minNights, maxNights } = target;
  if (!rangeStart || !rangeEnd) return [];

  const candidates: ScanCandidate[] = [];
  const start = dayjs(rangeStart);
  const end = dayjs(rangeEnd);
  let current = start;

  while (current.isSameOrBefore(end)) {
    const dow = current.day();

    if (dow === 5) {
      // Friday arrivals: minNights to maxNights
      for (let n = minNights; n <= maxNights; n++) {
        candidates.push({
          arrivalDate: current.format('YYYY-MM-DD'),
          nights: n,
          endDate: current.add(n, 'day').format('YYYY-MM-DD'),
        });
      }
    } else if (dow === 6 && minNights <= 1) {
      // Saturday arrivals: 1N only (Sat-Sun)
      candidates.push({
        arrivalDate: current.format('YYYY-MM-DD'),
        nights: 1,
        endDate: current.add(1, 'day').format('YYYY-MM-DD'),
      });
    }

    current = current.add(1, 'day');
  }

  return candidates;
}

export function generateNextAvailableWeekend(target: Target, today?: string): ScanCandidate[] {
  const { nextWeeksCount = 12, minNights, maxNights } = target;
  const base = today ? dayjs(today) : dayjs();
  const candidates: ScanCandidate[] = [];
  let current = base.add(1, 'day');
  let weeksFound = 0;

  while (weeksFound < nextWeeksCount) {
    const dow = current.day();

    if (dow === 5) {
      // Friday arrivals: minNights to maxNights
      for (let n = minNights; n <= maxNights; n++) {
        candidates.push({
          arrivalDate: current.format('YYYY-MM-DD'),
          nights: n,
          endDate: current.add(n, 'day').format('YYYY-MM-DD'),
        });
      }

      // Saturday arrivals: 1N (Sat-Sun) if allowed by minNights
      if (minNights <= 1) {
        const saturday = current.add(1, 'day');
        candidates.push({
          arrivalDate: saturday.format('YYYY-MM-DD'),
          nights: 1,
          endDate: saturday.add(1, 'day').format('YYYY-MM-DD'),
        });
      }

      weeksFound++;
      current = current.add(7, 'day'); // jump to next Friday
    } else {
      current = current.add(1, 'day');
    }
  }

  return candidates;
}
