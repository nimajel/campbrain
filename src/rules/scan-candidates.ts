import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import type { Target } from '../config/schemas.js';
import type { ScanCandidate } from '../types/scanner.js';

dayjs.extend(isSameOrBefore);

export function generateScanCandidates(target: Target): ScanCandidate[] {
  const candidates: ScanCandidate[] = [];
  const start = dayjs(target.rangeStart);
  const end = dayjs(target.rangeEnd);

  let current = start;

  while (current.isSameOrBefore(end)) {
    const dayOfWeek = current.day(); // 0 = Sunday, 6 = Saturday

    // Only process weekends if weekendsOnly is true
    if (!target.weekendsOnly || dayOfWeek === 5 || dayOfWeek === 6) {
      // Skip Sundays for multi-night stays
      if (dayOfWeek !== 0) {
        // For Fridays and Saturdays, generate multiple candidates
        if (dayOfWeek === 5) {
          // Friday
          // Friday to Sunday (2 nights)
          candidates.push({
            arrivalDate: current.format('YYYY-MM-DD'),
            nights: 2,
            endDate: current.add(2, 'day').format('YYYY-MM-DD'),
          });

          // Friday to Saturday (1 night)
          candidates.push({
            arrivalDate: current.format('YYYY-MM-DD'),
            nights: 1,
            endDate: current.add(1, 'day').format('YYYY-MM-DD'),
          });
        } else if (dayOfWeek === 6) {
          // Saturday
          // Saturday to Sunday (1 night)
          candidates.push({
            arrivalDate: current.format('YYYY-MM-DD'),
            nights: 1,
            endDate: current.add(1, 'day').format('YYYY-MM-DD'),
          });
        }
      }
    }

    current = current.add(1, 'day');
  }

  return candidates;
}
