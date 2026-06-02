import { load } from 'cheerio';
import type {
  ParkCatalogEntry,
  CampgroundCatalogEntry,
  SiteCatalogEntry,
  CatalogBookingRule,
} from './types.js';
import { buildAvailabilityUrl } from '../providers/california-parks-provider.js';
import { upsertCatalogPark, getCatalogPark, updateParkMetadata } from './catalog-store.js';
import { geocodeParkName } from './geocode.js';

// ---------------------------------------------------------------------------
// Default California Parks booking rule
// ---------------------------------------------------------------------------

export const CALIFORNIA_PARKS_DEFAULT_RULE: CatalogBookingRule = {
  type: 'rolling_months_before',
  monthsBefore: 6,
  releaseTime: '08:00',
  timezone: 'America/Los_Angeles',
  source: 'known',
  confidence: 'high',
  lastVerifiedAt: '2026-05-28',
};

// ---------------------------------------------------------------------------
// Parse HTML into campground/site list
// ---------------------------------------------------------------------------

export interface DiscoveredCampground {
  name: string;
  bookingUrl: string;
  sites: string[];
}

export function parseCampgroundsFromHtml(html: string): DiscoveredCampground[] {
  const $ = load(html);
  const campgrounds: DiscoveredCampground[] = [];

  $('section.card').each((_i, section) => {
    const name = $(section).find('header.card-header h4').text().trim();
    if (!name) return;

    const bookingUrl =
      ($(section).find('header.card-header a').first().attr('href') as string | undefined) ?? '';

    const sites: string[] = [];
    $(section)
      .find('tbody tr td.unit-name')
      .each((_j, td) => {
        const siteName = $(td).text().trim();
        if (siteName) sites.push(siteName);
      });

    campgrounds.push({ name, bookingUrl, sites });
  });

  return campgrounds;
}

// ---------------------------------------------------------------------------
// Convert discovered campground to catalog entry
// ---------------------------------------------------------------------------

function toCampgroundId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function toSiteId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function discoveredToCatalogEntry(
  discovered: DiscoveredCampground,
  existing?: CampgroundCatalogEntry
): CampgroundCatalogEntry {
  const sites: SiteCatalogEntry[] = discovered.sites.map((name) => ({
    id: toSiteId(name),
    name,
  }));

  const entry: CampgroundCatalogEntry = {
    id: existing?.id ?? toCampgroundId(discovered.name),
    name: discovered.name,
    sites,
    lastDiscoveredAt: new Date().toISOString(),
  };

  const bookingUrl = discovered.bookingUrl || existing?.bookingUrl;
  if (bookingUrl) entry.bookingUrl = bookingUrl;
  // Preserve hand-curated or previously discovered values — never overwrite with undefined
  if (existing?.bookingRule) entry.bookingRule = existing.bookingRule;
  if (existing?.nightlyFee !== undefined) entry.nightlyFee = existing.nightlyFee;

  return entry;
}

// ---------------------------------------------------------------------------
// Main discovery function
// ---------------------------------------------------------------------------

export interface DiscoverOptions {
  parkPageId: string;
  parkName: string;
  sampleDate: string; // YYYY-MM-DD
  nights?: number;
  dataDir?: string;
}

export interface DiscoverResult {
  parkPageId: string;
  parkName: string;
  campgrounds: DiscoveredCampground[];
  sourceUrl: string;
  savedAt: string;
}

export async function discoverCaliforniaParkCatalog(
  opts: DiscoverOptions
): Promise<DiscoverResult> {
  const nights = opts.nights ?? 1;
  const candidate = { arrivalDate: opts.sampleDate, nights, endDate: '' };
  const sourceUrl = buildAvailabilityUrl(opts.parkPageId, candidate);

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Fetch failed: HTTP ${response.status} for ${sourceUrl}`);
  }
  const html = await response.text();

  const result = discoverFromHtml(html, { ...opts, nights }, sourceUrl);

  // Geocode if coordinates aren't already stored for this park.
  // Only attempt when campgrounds were found (i.e. the page ID is valid).
  if (result.campgrounds.length > 0) {
    const existing = getCatalogPark(opts.parkPageId, opts.dataDir);
    if (existing && existing.lat === undefined) {
      const coords = await geocodeParkName(opts.parkName);
      if (coords) {
        updateParkMetadata(opts.parkPageId, { lat: coords.lat, lon: coords.lon }, opts.dataDir);
      }
    }
  }

  return result;
}

// Separate function for testability — accepts pre-fetched HTML
export function discoverFromHtml(
  html: string,
  opts: DiscoverOptions,
  sourceUrl?: string
): DiscoverResult {
  const campgrounds = parseCampgroundsFromHtml(html);
  const now = new Date().toISOString();

  // Read existing entry so we can preserve hand-curated fields
  const existing = getCatalogPark(opts.parkPageId, opts.dataDir);

  const updatedPark: ParkCatalogEntry = {
    provider: 'california-parks',
    parkName: opts.parkName,
    parkPageId: opts.parkPageId,
    // Preserve existing campgrounds when probe returns nothing — parks fully
    // booked on all probe dates no longer show the per-site table in HTML.
    campgrounds:
      campgrounds.length > 0
        ? campgrounds.map((c) =>
            discoveredToCatalogEntry(
              c,
              existing?.campgrounds.find((ec) => ec.name === c.name)
            )
          )
        : (existing?.campgrounds ?? []),
    defaultBookingRule: existing?.defaultBookingRule ?? CALIFORNIA_PARKS_DEFAULT_RULE,
    lastUpdatedAt: now,
    sourceUrl: sourceUrl ?? '',
    // Mark as verified when we successfully get campground data back
    ...(campgrounds.length > 0 ? { pageIdVerified: true } : existing?.pageIdVerified !== undefined ? { pageIdVerified: existing.pageIdVerified } : {}),
  };

  upsertCatalogPark(updatedPark, opts.dataDir);

  return {
    parkPageId: opts.parkPageId,
    parkName: opts.parkName,
    campgrounds,
    sourceUrl: sourceUrl ?? '',
    savedAt: now,
  };
}
