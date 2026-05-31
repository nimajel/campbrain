// ---------------------------------------------------------------------------
// Availability cache — proactive scanner writes here; UI reads from here
// ---------------------------------------------------------------------------

export interface CachedCampground {
  id: string;
  name: string;
  availableSites: string[];
  nightlyFee?: number;
  bookingUrl?: string;
}

export interface AvailabilityCacheEntry {
  // Lookup key fields
  parkPageId: string;
  parkName: string;
  arrivalDate: string;   // YYYY-MM-DD
  nights: number;
  departureDate: string; // YYYY-MM-DD
  // Scan metadata
  scannedAt: string;     // ISO 8601
  sourceUrl: string;
  // Results — all campgrounds for this park/date/nights combo
  campgrounds: CachedCampground[];
}

export interface AvailabilityCache {
  version: 1;
  // Key: `${parkPageId}::${arrivalDate}::${nights}`
  entries: Record<string, AvailabilityCacheEntry>;
}

export function cacheKey(parkPageId: string, arrivalDate: string, nights: number): string {
  return `${parkPageId}::${arrivalDate}::${nights}`;
}
