import { load } from 'cheerio';
import type {
  ParkCatalogEntry,
  CampgroundCatalogEntry,
  SiteCatalogEntry,
  CatalogBookingRule,
} from './types.js';
import { buildAvailabilityUrl } from '../providers/california-parks-provider.js';
import { upsertCatalogPark } from './catalog-store.js';

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
  if (existing?.bookingRule) entry.bookingRule = existing.bookingRule;

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

  return discoverFromHtml(html, { ...opts, nights }, sourceUrl);
}

// Separate function for testability — accepts pre-fetched HTML
export function discoverFromHtml(
  html: string,
  opts: DiscoverOptions,
  sourceUrl?: string
): DiscoverResult {
  const campgrounds = parseCampgroundsFromHtml(html);
  const now = new Date().toISOString();

  // Load existing park entry if any (to preserve existing IDs / rules)
  // We build the updated ParkCatalogEntry
  const updatedPark: ParkCatalogEntry = {
    provider: 'california-parks',
    parkName: opts.parkName,
    parkPageId: opts.parkPageId,
    campgrounds: campgrounds.map((c) => discoveredToCatalogEntry(c)),
    defaultBookingRule: CALIFORNIA_PARKS_DEFAULT_RULE,
    lastUpdatedAt: now,
    sourceUrl: sourceUrl ?? '',
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
