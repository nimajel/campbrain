import { getAvailableSitesForStay } from '../cache/availability-cache.js';
import type { AvailabilityWindowEntry } from '../cache/types.js';
import { classifySite } from '../catalog/site-classifier.js';
import type { Target } from '../config/schemas.js';
import type { ScanCandidate, ScanResult } from '../types/scanner.js';

function stayDates(arrivalDate: string, nights: number): string[] {
  const dates: string[] = [];
  const d = new Date(arrivalDate + 'T00:00:00');
  for (let i = 0; i < nights; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/** Oldest scannedAt among windows overlapping the stay — most conservative freshness. */
function oldestCoveringScan(
  windows: AvailabilityWindowEntry[],
  dates: string[],
): string | undefined {
  const covering = windows.filter((w) =>
    dates.some((d) => d >= w.windowStart && d <= w.windowEnd)
  );
  if (covering.length === 0) return undefined;
  return covering.map((w) => w.scannedAt).sort()[0];
}

/**
 * Pure, cache-backed candidate matcher. No network, no filesystem.
 * Walk-up sites are filtered defensively even though the cache should
 * already exclude them from bookable pools.
 */
export function matchCandidates(
  target: Target,
  candidates: ScanCandidate[],
  windows: AvailabilityWindowEntry[],
  now: string = new Date().toISOString(),
): ScanResult[] {
  return candidates.map((candidate) => {
    const dates = stayDates(candidate.arrivalDate, candidate.nights);
    const stays = getAvailableSitesForStay(windows, candidate.arrivalDate, candidate.nights);
    const cg = stays.find((s) => s.campgroundName === target.campgroundName);

    const available = (cg?.availableSites ?? []).filter(
      (name) => !classifySite(name, target.campgroundName).isWalkUp
    );
    const acceptable = new Set(target.acceptableSites);
    const hits = available
      .filter((name) => acceptable.has(name))
      .map((siteName) => ({ siteName, status: 'available', confidence: 'high' as const }));

    const result: ScanResult = {
      targetId: target.id,
      targetName: target.name,
      candidate,
      sourceUrl: windows[0]?.sourceUrl ?? '',
      debugHtmlPath: '',
      hits,
      parsingNotes: 'cache-backed',
      scannedAt: now,
    };
    if (cg?.bookingUrl !== undefined) result.bookingUrl = cg.bookingUrl;
    const asOf = oldestCoveringScan(windows, dates);
    if (asOf !== undefined) result.availabilityAsOf = asOf;
    return result;
  });
}
