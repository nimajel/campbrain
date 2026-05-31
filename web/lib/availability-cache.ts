import path from 'path';
import {
  readCache,
  listFreshEntries,
  getAvailableSitesForStay,
} from '../../src/cache/availability-cache';
import type { AvailabilityWindowEntry, CampgroundWindow, SiteDailyAvailability } from '../../src/cache/types';

function dataDir(): string {
  return path.join(process.cwd(), '..', '.campbrain', 'state');
}

export function readAvailabilityCacheWeb() {
  return readCache(dataDir());
}

export function listFreshEntriesWeb(): AvailabilityWindowEntry[] {
  return listFreshEntries(dataDir());
}

export { getAvailableSitesForStay };
export type { AvailabilityWindowEntry, CampgroundWindow, SiteDailyAvailability };
