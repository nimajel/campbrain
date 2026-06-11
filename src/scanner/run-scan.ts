import path from 'path';
import { getEntriesForPark, searchAvailableStays } from '../cache/availability-cache.js';
import {
  readHitsState,
  writeHitsState,
  openingsToHitRecords,
  reconcileHits,
  savedSearchCheckedKeys,
  hitKey,
} from '../state/scan-state.js';
import { listAlertEnabledSavedSearches } from '../saved-search/store.js';
import { matchSavedSearch, todayUtc } from '../saved-search/match.js';
import { listCatalogParks } from '../catalog/catalog-store.js';
import { classifyRegion } from '../catalog/regions.js';
import { ConsoleNotificationService } from '../notifications/console-notification-service.js';
import { EmailNotificationService } from '../notifications/email-notification-service.js';
import type { AvailabilityAlert } from '../notifications/notification-service.js';
import type { AvailabilityHitRecord } from '../state/scan-state.js';
import type { SavedSearch } from '../saved-search/types.js';
import type { CampRegion } from '../catalog/regions.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunScanOptions {
  targetId?: string | undefined;
  debug?: boolean | undefined;
  notify?: boolean | undefined;
  stateDir?: string | undefined;
}

export interface RunScanSummary {
  totalNewHits: number;
  skippedCount: number;
}

// ---------------------------------------------------------------------------
// parkRegionOf resolver — built once from the catalog for the full scan run
// ---------------------------------------------------------------------------

function buildParkRegionOf(): (parkPageId: string) => CampRegion | null {
  const parks = listCatalogParks();
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultStateDir(): string {
  return path.join(process.cwd(), '.campbrain', 'state');
}

function buildAvailabilityAlerts(
  hits: AvailabilityHitRecord[],
  checkedAt: string,
): AvailabilityAlert[] {
  return hits.map((hit) => {
    const item: AvailabilityAlert = {
      hit,
      parkName: hit.parkName ?? '',
      campgroundName: hit.campgroundName ?? '',
      sourceUrl: '',
      checkedAt,
    };
    if (hit.availabilityAsOf !== undefined) item.availabilityAsOf = hit.availabilityAsOf;
    return item;
  });
}

// ---------------------------------------------------------------------------
// Core scan orchestration — shared by CLI and worker
// ---------------------------------------------------------------------------

export async function runScan(options: RunScanOptions = {}): Promise<RunScanSummary> {
  const { notify = true } = options;
  const stateDir = options.stateDir ?? defaultStateDir();

  const now = new Date().toISOString();
  const today = todayUtc();

  const allIncoming: AvailabilityHitRecord[] = [];
  const checkedKeys = new Set<string>();
  const savedSearchesById = new Map<string, SavedSearch>();

  // ---------------------------------------------------------------------------
  // Saved-search source (alert_enabled=true only)
  // Skipped when a targetId filter is active (saved searches have no legacy targetId).
  // ---------------------------------------------------------------------------

  if (!options.targetId) {
    let savedSearches: SavedSearch[] = [];
    try {
      savedSearches = await listAlertEnabledSavedSearches();
    } catch (err: unknown) {
      console.error(`Saved-search store unavailable: ${String(err)} — skipping saved-search source`);
    }

    if (savedSearches.length > 0) {
      const parkRegionOf = buildParkRegionOf();
      const existingBeforeLoop = readHitsState(stateDir);

      for (const search of savedSearches) {
        console.log(`Scanning saved search: ${search.name}`);
        savedSearchesById.set(search.id, search);

        let openings: Awaited<ReturnType<typeof matchSavedSearch>>;
        try {
          openings = await matchSavedSearch(search, {
            searchAvailableStays,
            getEntriesForPark,
            parkRegionOf,
          }, today);
        } catch (err: unknown) {
          console.error(`  Match failed for saved search "${search.name}": ${String(err)} — skipping`);
          continue;
        }

        console.log(`  ${openings.length} opening(s) found`);

        const hitRecords = openingsToHitRecords(openings, search.name, now);

        const incomingKeys = new Set(hitRecords.map(hitKey));
        const ssCheckedKeys = savedSearchCheckedKeys(existingBeforeLoop, search.id, incomingKeys);
        for (const k of ssCheckedKeys) checkedKeys.add(k);

        allIncoming.push(...hitRecords);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Reconcile + notify
  // ---------------------------------------------------------------------------

  const existing = readHitsState(stateDir);
  const { merged, toNotify } = reconcileHits(existing, allIncoming, checkedKeys, now, today);
  writeHitsState(stateDir, merged);

  if (notify && toNotify.length > 0) {
    const items = buildAvailabilityAlerts(toNotify, now);

    await new ConsoleNotificationService().notify(items);

    const emailItems = items.filter((i) =>
      savedSearchesById.get(i.hit.savedSearchId ?? '')?.emailEnabled ?? false
    );
    const consoleOnlyItems = items.filter((i) =>
      !(savedSearchesById.get(i.hit.savedSearchId ?? '')?.emailEnabled ?? false)
    );

    let emailResult: 'delivered' | 'skipped-unconfigured' | 'failed' = 'delivered';
    if (emailItems.length > 0) {
      emailResult = await new EmailNotificationService().notify(emailItems);
    }

    const stampKeys = new Set<string>(consoleOnlyItems.map((i) => hitKey(i.hit)));
    if (emailResult !== 'failed') {
      for (const i of emailItems) stampKeys.add(hitKey(i.hit));
    }
    if (stampKeys.size > 0) {
      const stamped = {
        version: 3,
        hits: merged.hits.map((h) => (stampKeys.has(hitKey(h)) ? { ...h, notifiedAt: now } : h)),
      };
      writeHitsState(stateDir, stamped);
    }
  }

  return {
    totalNewHits: toNotify.length,
    skippedCount: 0,
  };
}
