import { listAllEntries, getCacheStats, getAvailableSitesForStay, getEntriesForPark, getEntriesForParks, getParkAvailabilityCounts, listAvailableStays, refreshMaterializedView, rebuildMaterializedView, searchAvailableStays, findNextAvailableDates } from '../../src/cache/availability-cache';
import type { AvailabilityWindowEntry, CampgroundWindow, SiteDailyAvailability, AvailableStay } from '../../src/cache/types';
import type { SearchParkResult, SearchCampground, NextAvailableResult } from '../../src/cache/availability-cache';

export async function listFreshEntriesWeb(): Promise<AvailabilityWindowEntry[]> {
  return listAllEntries();
}

export async function getAllEntriesWeb(): Promise<AvailabilityWindowEntry[]> {
  return listAllEntries();
}

export { getCacheStats, getAvailableSitesForStay, getEntriesForPark, getEntriesForParks, getParkAvailabilityCounts, listAvailableStays, refreshMaterializedView, rebuildMaterializedView, searchAvailableStays, findNextAvailableDates };
export type { AvailabilityWindowEntry, CampgroundWindow, SiteDailyAvailability, AvailableStay, SearchParkResult, SearchCampground, NextAvailableResult };
export type { ParkAvailabilityCount } from '../../src/cache/availability-cache';
