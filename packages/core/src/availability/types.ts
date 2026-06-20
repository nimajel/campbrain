// ---------------------------------------------------------------------------
// Availability cache — v2
//
// One entry = one park × one 14-day window.
// Stores raw per-site per-day availability so any night-count query can be
// answered at read time without additional fetches.
// ---------------------------------------------------------------------------

export interface SiteDailyAvailability {
  name: string;
  /** Keys are YYYY-MM-DD dates within the window */
  dates: Record<string, 'available' | 'unavailable' | 'unknown'>;
  /** Rec.gov campsite_type string when available — used to classify site type at upsert. */
  recGovCampsiteType?: string;
}

export interface CampgroundWindow {
  id: string;
  name: string;
  nightlyFee?: number;
  bookingUrl?: string;
  sites: SiteDailyAvailability[];
}

export interface AvailabilityWindowEntry {
  parkPageId: string;
  parkName: string;
  /** First date in the window, inclusive (YYYY-MM-DD) */
  windowStart: string;
  /** Last date in the window, inclusive (YYYY-MM-DD = windowStart + 13 days) */
  windowEnd: string;
  scannedAt: string;
  sourceUrl: string;
  campgrounds: CampgroundWindow[];
}

export interface AvailabilityCache {
  version: 2;
  /** Key: `${parkPageId}::${windowStart}` */
  entries: Record<string, AvailabilityWindowEntry>;
}

export function cacheKey(parkPageId: string, windowStart: string): string {
  return `${parkPageId}::${windowStart}`;
}

/** Number of days the parks.ca.gov endpoint returns per fetch. */
export const WINDOW_DAYS = 8;

export interface AvailableStay {
  providerId: string;
  parkPageId: string;
  parkName: string;
  campgroundName: string;
  nightlyFee: number | null;
  bookingUrl: string | null;
  arrivalDate: string;
  nights: number;
  /** Bookable (reservable online) sites. Walk-up / first-come sites are in walkUpSites. */
  availableSites: string[];
  /** Walk-up / first-come sites that cannot be reserved online (e.g. hike/bike campsites). */
  walkUpSites: string[];
}
