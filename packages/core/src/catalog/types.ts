// ---------------------------------------------------------------------------
// Catalog types — provider / park / campground / site hierarchy
// ---------------------------------------------------------------------------

export interface CatalogBookingRule {
  type: 'rolling_months_before';
  monthsBefore: number;
  releaseTime: string; // HH:MM
  timezone: string;
  source: 'known' | 'inferred' | 'default';
  confidence: 'high' | 'medium' | 'low';
  lastVerifiedAt?: string;
}

export interface SiteCatalogEntry {
  id: string;
  name: string;
  type?: string;
  capacity?: number;
  attributes?: string[];
}

export interface CampgroundCatalogEntry {
  id: string;
  name: string;
  bookingUrl?: string;
  sites: SiteCatalogEntry[];
  bookingRule?: CatalogBookingRule;
  // Nightly fee in USD. Not available from the parks.ca.gov availability
  // endpoint — must be populated manually or via a future enrichment step.
  nightlyFee?: number;
  lastDiscoveredAt?: string;
}

export type DiscoveryStatus = 'success' | 'failed' | 'pending' | 'not_started';

export interface ParkCatalogEntry {
  provider: 'california-parks' | 'recreation-gov' | 'yosemite-lottery';
  parkName: string;
  parkPageId: string;
  campgrounds: CampgroundCatalogEntry[];
  defaultBookingRule: CatalogBookingRule;
  // True only when parkPageId is confirmed to resolve against the provider.
  // Auto-refresh only attempts verified parks; unverified parks populate the
  // dropdown but are skipped unless explicitly targeted or forced.
  pageIdVerified?: boolean;
  // For recreation-gov: the parent rec-area ID and name (e.g. "Death Valley National Park").
  // parkPageId remains the facility ID used for availability API calls so Option A
  // (one pin per facility) is a one-line change — just ignore these fields.
  parentId?: string;
  parentName?: string;
  // Managing agency, e.g. "National Park Service", "USDA Forest Service", "Bureau of Land Management".
  // Used for map pin color categorisation.
  orgName?: string;
  // Geographic coordinates — populated by catalog refresh via Nominatim geocoding.
  // Once set they are preserved across refreshes (never overwritten with undefined).
  lat?: number;
  lon?: number;
  // Freshness metadata — maintained by the backend catalog refresh process
  lastUpdatedAt?: string;
  lastDiscoveryAttemptAt?: string;
  discoveryStatus?: DiscoveryStatus;
  discoveryError?: string;
  sourceUrl?: string;
}

export interface ProviderCatalog {
  provider: string;
  parks: ParkCatalogEntry[];
}

// Converts a CatalogBookingRule to the leaner Alert-level BookingRule
export function catalogRuleToAlertRule(rule: CatalogBookingRule): {
  type: 'rolling_months_before';
  monthsBefore: number;
  releaseTime: string;
  timezone: string;
} {
  return {
    type: rule.type,
    monthsBefore: rule.monthsBefore,
    releaseTime: rule.releaseTime,
    timezone: rule.timezone,
  };
}
