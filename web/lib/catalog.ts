import path from 'path';
import {
  listCatalogParks,
  getCatalogPark,
  getCatalogParkByName,
  describeScanCoverage,
} from '../../src/catalog/catalog-store';
import type { ParkCatalogEntry, CampgroundCatalogEntry, CatalogBookingRule, DiscoveryStatus } from '../../src/catalog/types';

// In Next.js, process.cwd() is the web/ directory
function dataDir(): string {
  return path.join(process.cwd(), '..', 'data');
}

export function listParksWeb(): ParkCatalogEntry[] {
  return listCatalogParks(dataDir());
}

export function getParkWeb(parkPageId: string): ParkCatalogEntry | undefined {
  return getCatalogPark(parkPageId, dataDir());
}

export function getParkByNameWeb(parkName: string): ParkCatalogEntry | undefined {
  return getCatalogParkByName(parkName, dataDir());
}

export function inferBookingRule(parkPageId: string, campgroundId?: string): CatalogBookingRule | undefined {
  const park = getCatalogPark(parkPageId, dataDir());
  if (!park) return undefined;

  if (campgroundId) {
    const cg = park.campgrounds.find((c) => c.id === campgroundId);
    if (cg?.bookingRule) return cg.bookingRule;
  }

  return park.defaultBookingRule;
}

/** Web-context wrapper: resolves the data dir relative to the Next.js process. */
export function describeScanCoverageWeb(): string {
  return describeScanCoverage(dataDir());
}
export type { ParkCatalogEntry, CampgroundCatalogEntry, CatalogBookingRule, DiscoveryStatus };
