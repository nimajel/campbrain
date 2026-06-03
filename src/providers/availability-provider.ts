import type { Target } from '../config/schemas.js';
import type { ScanCandidate, ScanResult } from '../types/scanner.js';
import type { AvailabilityWindowEntry } from '../cache/types.js';
import type { CampgroundCatalogEntry } from '../catalog/types.js';

export interface CacheWindow {
  windowStart: string; // YYYY-MM-DD — first day of the window
  windowEnd: string;   // YYYY-MM-DD — last day of the window (inclusive)
}

export interface AvailabilityProvider {
  name: string;

  /**
   * Max simultaneous proactiveScanWindow calls the scanner should make for
   * this provider. Defaults to 5 if not set. Rec.gov is strict — use 1.
   */
  proactiveConcurrency?: number;

  /**
   * Milliseconds to wait between task batches. Rec.gov needs 2000ms
   * (≈30 req/min) to stay under its rate limit. CA Parks default: 500ms.
   */
  batchDelayMs?: number;

  /** Alert-based scanning — check specific date candidates against a target. */
  scan(
    target: Target,
    candidates: ScanCandidate[],
    debugMode?: boolean
  ): Promise<ScanResult[]>;

  /**
   * Return the list of cache windows that should exist to cover rangeStart–rangeEnd.
   * CA Parks: 8-day sliding windows. Rec.gov: monthly windows (first of month through EOM).
   */
  generateCacheWindows(rangeStart: string, rangeEnd: string): CacheWindow[];

  /**
   * Fetch a single cache window and return a populated AvailabilityWindowEntry,
   * or null if the fetch failed (caller will retry on next scan cycle).
   */
  proactiveScanWindow(
    parkPageId: string,
    window: CacheWindow,
    parkName: string,
    campgrounds: CampgroundCatalogEntry[]
  ): Promise<AvailabilityWindowEntry | null>;
}
