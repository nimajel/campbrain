import type { AvailabilityWindowEntry } from './types';

/** Oldest scannedAt among windows overlapping the stay — most conservative freshness. */
export function oldestCoveringScan(
  windows: AvailabilityWindowEntry[],
  dates: string[],
): string | undefined {
  const covering = windows.filter((w) =>
    dates.some((d) => d >= w.windowStart && d <= w.windowEnd),
  );
  if (covering.length === 0) return undefined;
  return covering.map((w) => w.scannedAt).sort()[0];
}
