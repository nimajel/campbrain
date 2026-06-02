import { listAllEntries, getCacheStats, getAvailableSitesForStay, getEntriesForPark, getParksWithAvailability, listAvailableStays, refreshMaterializedView, rebuildMaterializedView } from '../../src/cache/availability-cache';
import type { AvailabilityWindowEntry, CampgroundWindow, SiteDailyAvailability, AvailableStay } from '../../src/cache/types';

export async function listFreshEntriesWeb(): Promise<AvailabilityWindowEntry[]> {
  return listAllEntries();
}

export async function getAllEntriesWeb(): Promise<AvailabilityWindowEntry[]> {
  return listAllEntries();
}

export { getCacheStats, getAvailableSitesForStay, getEntriesForPark, getParksWithAvailability, listAvailableStays, refreshMaterializedView, rebuildMaterializedView };
export type { AvailabilityWindowEntry, CampgroundWindow, SiteDailyAvailability, AvailableStay };
