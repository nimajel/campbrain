// ---------------------------------------------------------------------------
// Recreation.gov catalog discovery — uses the recreation.gov public search API
// (the same endpoint the website uses). No API key required.
//
// Approach: fetch pages of campground search results, collect all with
// state_code === 'California', stop when pages run dry.
// ---------------------------------------------------------------------------

import type { ParkCatalogEntry, CatalogBookingRule } from './types.js';
import { upsertCatalogPark } from './catalog-store.js';

const SEARCH_BASE = 'https://www.recreation.gov/api/search';
const PAGE_SIZE = 100;
// Stop after this many total records fetched (10k = 100 pages — well beyond actual count)
const MAX_RECORDS = 10_000;

const REC_GOV_DEFAULT_RULE: CatalogBookingRule = {
  type: 'rolling_months_before',
  monthsBefore: 6,
  releaseTime: '07:00',
  timezone: 'America/Los_Angeles',
  source: 'known',
  confidence: 'medium',
};

// Exported for tests
export function buildSearchUrl(offset: number): string {
  const params = new URLSearchParams({
    q: 'campground',
    entity_type: 'campground',
    size: String(PAGE_SIZE),
    start: String(offset),
  });
  return `${SEARCH_BASE}?${params}`;
}

export interface RecGovSearchResult {
  entity_id: string;
  name: string;
  state_code?: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  reservable?: boolean;
  parent_id?: string;
  parent_name?: string;
  parent_type?: string;
  org_name?: string;
}

function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Name fragments that identify non-campground facilities the availability API
// doesn't serve. These slip through the "campground" entity_type filter.
const NON_CAMPGROUND_PATTERNS = [
  /\bday use\b/i,
  /\bvisitor center\b/i,
  /\bboat ramp\b/i,
  /\bpicnic\b/i,
  /\btrailhead\b/i,
  /\bohv\b/i,
  /\boff.highway\b/i,
  /\bwilderness permit\b/i,
  /\bbackpack permit\b/i,
  /\blong term visitor area\b/i,
  /\briver access\b/i,
  /\bnatural area\b/i,
  /\bmanagement area\b/i,
  /\brecreation area\b/i,
  /\bwild & scenic\b/i,
  /\bchristmas tree permit\b/i,
  /put.in$/i,
];

function isLikelyCampground(name: string, reservable?: boolean): boolean {
  // Must be reservable to have a campground availability endpoint
  if (reservable === false) return false;
  // Exclude by name pattern
  return !NON_CAMPGROUND_PATTERNS.some((re) => re.test(name));
}

// Exported for tests
export function parseSearchResults(results: RecGovSearchResult[]): ParkCatalogEntry[] {
  return results
    .filter((r) => r.state_code === 'California' && r.entity_id && isLikelyCampground(r.name, r.reservable))
    .map((r): ParkCatalogEntry => {
      const lat = r.latitude ? Number(r.latitude) : 0;
      const lon = r.longitude ? Number(r.longitude) : 0;
      const entry: ParkCatalogEntry = {
        provider: 'recreation-gov',
        parkName: titleCase(r.name),
        parkPageId: String(r.entity_id),
        campgrounds: [],
        defaultBookingRule: REC_GOV_DEFAULT_RULE,
        discoveryStatus: 'not_started',
      };
      if (lat) entry.lat = lat;
      if (lon) entry.lon = lon;
      if (r.parent_id) entry.parentId = r.parent_id;
      if (r.parent_name) entry.parentName = titleCase(r.parent_name);
      if (r.org_name) entry.orgName = r.org_name;
      return entry;
    });
}

export interface DiscoverRecGovOptions {
  dataDir?: string;
  logger?: (msg: string) => void;
}

export interface DiscoverRecGovSummary {
  facilitiesFound: number;
  written: number;
  errors: number;
}

export async function discoverRecreationGovCatalog(
  opts: DiscoverRecGovOptions
): Promise<DiscoverRecGovSummary> {
  const log = opts.logger ?? (() => {});
  let offset = 0;
  let totalFetched = 0;
  let written = 0;
  let errors = 0;
  const seen = new Set<string>(); // deduplicate by entity_id

  log('Discovering CA campgrounds from recreation.gov search API…');

  while (totalFetched < MAX_RECORDS) {
    const url = buildSearchUrl(offset);
    let results: RecGovSearchResult[];

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'campbrain/1.0 (personal-use catalog discovery)' },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 100)}` : ''}`);
      }
      const json = (await res.json()) as { results: RecGovSearchResult[] };
      results = json.results ?? [];
    } catch (err) {
      log(`  Error fetching offset ${offset}: ${err instanceof Error ? err.message : String(err)}`);
      errors++;
      break;
    }

    if (results.length === 0) break;

    const caEntries = parseSearchResults(results).filter((e) => !seen.has(e.parkPageId));
    for (const entry of caEntries) {
      seen.add(entry.parkPageId);
      try {
        upsertCatalogPark(entry, opts.dataDir);
        written++;
      } catch (err) {
        log(`  Failed to write ${entry.parkName}: ${err instanceof Error ? err.message : String(err)}`);
        errors++;
      }
    }

    totalFetched += results.length;
    if (caEntries.length > 0) {
      log(`  Fetched ${totalFetched} records, ${written} CA campgrounds written so far…`);
    }

    if (results.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;

    // Politeness delay between pages
    await new Promise((r) => setTimeout(r, 500));
  }

  log(`  Discovery complete: ${written} CA campgrounds written, ${errors} errors`);
  return { facilitiesFound: written, written, errors };
}
