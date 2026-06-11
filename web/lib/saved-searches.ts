import { classifyRegion } from '../../src/catalog/regions.js';
import { listParksWeb } from './catalog.js';
import type { CampRegion } from '../../src/catalog/regions.js';

export {
  listSavedSearches,
  getSavedSearch,
  createSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  upsertSavedSearch,
} from '../../src/saved-search/store.js';

export type { SavedSearch, SavedSearchInput } from '../../src/saved-search/types.js';

// ---------------------------------------------------------------------------
// parkRegionOf — catalog-backed region resolver for use in the /run route.
// Mirrors buildParkRegionOf() from src/scanner/run-scan.ts but uses the
// web-layer catalog loader (process.cwd() is web/ in Next.js).
// ---------------------------------------------------------------------------

export function buildParkRegionOf(): (parkPageId: string) => CampRegion | null {
  const parks = listParksWeb();
  const regionMap = new Map<string, CampRegion | null>();
  for (const park of parks) {
    if (park.lat !== undefined && park.lon !== undefined) {
      regionMap.set(park.parkPageId, classifyRegion(park.lat, park.lon));
    } else {
      regionMap.set(park.parkPageId, null);
    }
  }
  return (parkPageId: string) => regionMap.get(parkPageId) ?? null;
}
