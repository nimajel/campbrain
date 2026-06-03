import type { ParkCatalogEntry, CatalogBookingRule } from './types.js';
import { upsertCatalogPark } from './catalog-store.js';

const RIDB_BASE_URL = 'https://ridb.recreation.gov/api/v1';
const PAGE_SIZE = 50;

const REC_GOV_DEFAULT_RULE: CatalogBookingRule = {
  type: 'rolling_months_before',
  monthsBefore: 6,
  releaseTime: '07:00',
  timezone: 'America/Los_Angeles',
  source: 'known',
  confidence: 'medium',
};

// Exported for tests
export function buildRidbFacilitiesUrl(apiKey: string, offset: number): string {
  const params = new URLSearchParams({
    apikey: apiKey,
    state: 'CA',
    activity: '9',
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  return `${RIDB_BASE_URL}/facilities?${params}`;
}

export interface RidbFacility {
  FacilityID: string;
  FacilityName: string;
  FacilityLatitude: number;
  FacilityLongitude: number;
  FacilityTypeDescription?: string;
}

function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Exported for tests
export function parseRidbFacilities(facilities: RidbFacility[]): ParkCatalogEntry[] {
  return facilities.map((f): ParkCatalogEntry => {
    const entry: ParkCatalogEntry = {
      provider: 'recreation-gov',
      parkName: titleCase(f.FacilityName),
      parkPageId: String(f.FacilityID),
      campgrounds: [],
      defaultBookingRule: REC_GOV_DEFAULT_RULE,
      discoveryStatus: 'not_started',
    };
    // Omit coordinates if zero (unset in RIDB) — exactOptionalPropertyTypes forbids lat: undefined
    if (f.FacilityLatitude) entry.lat = f.FacilityLatitude;
    if (f.FacilityLongitude) entry.lon = f.FacilityLongitude;
    return entry;
  });
}

export interface DiscoverRecGovOptions {
  apiKey: string;
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
  let total = 0;
  let written = 0;
  let errors = 0;

  log('Fetching CA camping facilities from RIDB API…');

  while (true) {
    const url = buildRidbFacilitiesUrl(opts.apiKey, offset);
    let facilities: RidbFacility[];

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'campbrain/1.0 (personal-use catalog discovery)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        RECDATA: RidbFacility[];
        METADATA: { Results: { CURRENT_COUNT: number; TOTAL_COUNT: number } };
      };
      facilities = json.RECDATA ?? [];
      if (offset === 0) {
        log(`  Total facilities available: ${json.METADATA?.Results?.TOTAL_COUNT ?? '?'}`);
      }
    } catch (err) {
      log(`  Error fetching offset ${offset}: ${err instanceof Error ? err.message : String(err)}`);
      errors++;
      break;
    }

    if (facilities.length === 0) break;

    const entries = parseRidbFacilities(facilities);
    for (const entry of entries) {
      try {
        upsertCatalogPark(entry, opts.dataDir);
        written++;
      } catch (err) {
        log(`  Failed to write ${entry.parkName}: ${err instanceof Error ? err.message : String(err)}`);
        errors++;
      }
    }

    total += facilities.length;
    log(`  Fetched ${total} facilities so far…`);
    offset += PAGE_SIZE;

    // Politeness delay between pages
    await new Promise((r) => setTimeout(r, 1000));
  }

  return { facilitiesFound: total, written, errors };
}
