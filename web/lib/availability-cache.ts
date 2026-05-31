import path from 'path';
import { readCache, listFreshEntries } from '../../src/cache/availability-cache';
import type { AvailabilityCacheEntry, CachedCampground } from '../../src/cache/types';

function dataDir(): string {
  // In Next.js, process.cwd() is the web/ directory
  return path.join(process.cwd(), '..', '.campbrain', 'state');
}

export function readAvailabilityCacheWeb() {
  return readCache(dataDir());
}

export function listFreshEntriesWeb(): AvailabilityCacheEntry[] {
  return listFreshEntries(dataDir());
}

export type { AvailabilityCacheEntry, CachedCampground };
