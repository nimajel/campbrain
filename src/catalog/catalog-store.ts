import fs from 'fs';
import path from 'path';
import type { ProviderCatalog, ParkCatalogEntry, CampgroundCatalogEntry } from './types.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const SUPPORTED_PROVIDERS = ['california-parks', 'recreation-gov'] as const;

function catalogDir(dataDir?: string): string {
  return path.join(dataDir ?? path.join(process.cwd(), 'data'), 'catalog');
}

function catalogPath(provider: string, dataDir?: string): string {
  return path.join(catalogDir(dataDir), `${provider}.json`);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function readProviderCatalogRaw(provider: string, dataDir?: string): ProviderCatalog {
  const p = catalogPath(provider, dataDir);
  if (!fs.existsSync(p)) return { provider, parks: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ProviderCatalog;
  } catch {
    return { provider, parks: [] };
  }
}

export function readCaliforniaParksRaw(dataDir?: string): ProviderCatalog {
  return readProviderCatalogRaw('california-parks', dataDir);
}

export function readRecreationGovRaw(dataDir?: string): ProviderCatalog {
  return readProviderCatalogRaw('recreation-gov', dataDir);
}

export function listCatalogParks(dataDir?: string): ParkCatalogEntry[] {
  return SUPPORTED_PROVIDERS.flatMap((p) => readProviderCatalogRaw(p, dataDir).parks);
}

/**
 * Returns a human-readable summary of what the proactive scanner will cover,
 * grouped by provider. Uses the same eligibility rules as the scanner itself.
 * Use this anywhere we display "X CA parks + Y Rec.gov campgrounds" so the
 * count stays in sync with the actual catalog automatically.
 *
 * Example: "88 CA state parks · 878 Recreation.gov campgrounds"
 */
export function describeScanCoverage(dataDir?: string): string {
  const all = listCatalogParks(dataDir);

  const counts: Record<string, number> = {};
  for (const p of all) {
    const eligible =
      p.provider === 'recreation-gov'
        ? !!p.parkPageId
        : p.campgrounds.some((c) => c.sites.length > 0);
    if (eligible) {
      counts[p.provider] = (counts[p.provider] ?? 0) + 1;
    }
  }

  const labels: Record<string, string> = {
    'california-parks': 'CA state park',
    'recreation-gov': 'Recreation.gov campground',
  };

  return Object.entries(counts)
    .map(([provider, n]) => {
      const label = labels[provider] ?? provider;
      return `${n} ${label}${n !== 1 ? 's' : ''}`;
    })
    .join(' · ');
}

export function getCatalogPark(parkPageId: string, dataDir?: string): ParkCatalogEntry | undefined {
  return listCatalogParks(dataDir).find((p) => p.parkPageId === parkPageId);
}

export function getCatalogParkByName(parkName: string, dataDir?: string): ParkCatalogEntry | undefined {
  return listCatalogParks(dataDir).find((p) => p.parkName === parkName);
}

export function getCatalogCampground(
  parkPageId: string,
  campgroundId: string,
  dataDir?: string
): CampgroundCatalogEntry | undefined {
  return getCatalogPark(parkPageId, dataDir)?.campgrounds.find((c) => c.id === campgroundId);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function writeCatalog(catalog: ProviderCatalog, dataDir?: string): void {
  const dir = catalogDir(dataDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    catalogPath(catalog.provider, dataDir),
    JSON.stringify(catalog, null, 2) + '\n',
    'utf-8'
  );
}

export function upsertCatalogPark(park: ParkCatalogEntry, dataDir?: string): void {
  const catalog = readProviderCatalogRaw(park.provider, dataDir);
  const idx = catalog.parks.findIndex((p) => p.parkPageId === park.parkPageId);
  if (idx === -1) {
    catalog.parks.push(park);
  } else {
    catalog.parks[idx] = park;
  }
  writeCatalog(catalog, dataDir);
}

// Merge metadata fields into an existing park entry without replacing its
// campgrounds. Keys explicitly set to undefined are removed (so callers can
// clear stale errors). No-op if the park is not present.
export function updateParkMetadata(
  parkPageId: string,
  patch: { [K in keyof ParkCatalogEntry]?: ParkCatalogEntry[K] | undefined },
  dataDir?: string
): void {
  for (const provider of SUPPORTED_PROVIDERS) {
    const catalog = readProviderCatalogRaw(provider, dataDir);
    const idx = catalog.parks.findIndex((p) => p.parkPageId === parkPageId);
    if (idx === -1) continue;
    const merged = { ...catalog.parks[idx], ...patch } as ParkCatalogEntry;
    for (const key of Object.keys(merged) as (keyof ParkCatalogEntry)[]) {
      if (merged[key] === undefined) delete merged[key];
    }
    catalog.parks[idx] = merged;
    writeCatalog(catalog, dataDir);
    return;
  }
}
