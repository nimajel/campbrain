import path from 'path';
import {
  readCache,
  getAvailableSitesForStay,
} from '../../src/cache/availability-cache';
import type { AvailabilityWindowEntry, CampgroundWindow, SiteDailyAvailability } from '../../src/cache/types';

function dataDir(): string {
  return path.join(process.cwd(), '..', '.campbrain', 'state');
}

export function readAvailabilityCacheWeb() {
  return readCache(dataDir());
}

/** Returns all cached entries for display — stale entries still show, they just trigger a background rescan. */
export function listFreshEntriesWeb(): AvailabilityWindowEntry[] {
  return Object.values(readCache(dataDir()).entries);
}

export { getAvailableSitesForStay };
export type { AvailabilityWindowEntry, CampgroundWindow, SiteDailyAvailability };
