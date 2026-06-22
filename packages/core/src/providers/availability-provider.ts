import type { AvailabilityWindowEntry } from '../availability/types';
import type { CampgroundCatalogEntry } from '../catalog/types';

export interface CacheWindow {
  windowStart: string; // YYYY-MM-DD — first day of the window
  windowEnd: string;   // YYYY-MM-DD — last day of the window (inclusive)
}

/**
 * Called by the scanner when a provider fetch returns a page that is
 * neither a parseable availability table nor a known "no availability" card.
 * The callback is injected by the caller so @campbrain/core stays Workers-pure.
 */
export type OnUnexpectedHtml = (
  html: string,
  ctx: { parkPageId: string; arrivalDate: string; url: string }
) => Promise<void>;

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

  /**
   * Return the list of cache windows that should exist to cover rangeStart–rangeEnd.
   * CA Parks: 8-day sliding windows. Rec.gov: monthly windows (first of month through EOM).
   */
  generateCacheWindows(rangeStart: string, rangeEnd: string): CacheWindow[];

  /**
   * Returns:
   *   AvailabilityWindowEntry  — success, data written to cache
   *   'unsupported'            — permanent: this park has no availability endpoint (400/404);
   *                             the scanner will mark it in the catalog and skip it forever
   *   null                     — temporary failure; retry next cycle
   */
  proactiveScanWindow(
    parkPageId: string,
    window: CacheWindow,
    parkName: string,
    campgrounds: CampgroundCatalogEntry[],
    options?: { onUnexpectedHtml?: OnUnexpectedHtml }
  ): Promise<AvailabilityWindowEntry | 'unsupported' | null>;
}
