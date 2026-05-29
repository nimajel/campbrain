import fs from 'fs';
import path from 'path';
import type { ProviderCatalog, ParkCatalogEntry, CampgroundCatalogEntry } from './types.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function catalogDir(dataDir?: string): string {
  return path.join(dataDir ?? path.join(process.cwd(), 'data'), 'catalog');
}

function californiaParksPath(dataDir?: string): string {
  return path.join(catalogDir(dataDir), 'california-parks.json');
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function readCaliforniaParksRaw(dataDir?: string): ProviderCatalog {
  const p = californiaParksPath(dataDir);
  if (!fs.existsSync(p)) {
    return { provider: 'california-parks', parks: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ProviderCatalog;
  } catch {
    return { provider: 'california-parks', parks: [] };
  }
}

export function listCatalogParks(dataDir?: string): ParkCatalogEntry[] {
  return readCaliforniaParksRaw(dataDir).parks;
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
    californiaParksPath(dataDir),
    JSON.stringify(catalog, null, 2) + '\n',
    'utf-8'
  );
}

export function upsertCatalogPark(park: ParkCatalogEntry, dataDir?: string): void {
  const catalog = readCaliforniaParksRaw(dataDir);
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
  const catalog = readCaliforniaParksRaw(dataDir);
  const idx = catalog.parks.findIndex((p) => p.parkPageId === parkPageId);
  if (idx === -1) return;
  const merged = { ...catalog.parks[idx], ...patch } as ParkCatalogEntry;
  for (const key of Object.keys(merged) as (keyof ParkCatalogEntry)[]) {
    if (merged[key] === undefined) delete merged[key];
  }
  catalog.parks[idx] = merged;
  writeCatalog(catalog, dataDir);
}
