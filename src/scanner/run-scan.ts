import path from 'path';
import { listAlerts } from '../config/alerts.js';
import { generateScanCandidates } from '../rules/scan-candidates.js';
import { getEntriesForPark, searchAvailableStays } from '../cache/availability-cache.js';
import { matchCandidates } from './match-candidates.js';
import { serializeResult } from '../types/scanner.js';
import {
  buildScanSummary,
  writeLatestScan,
  readHitsState,
  writeHitsState,
  resultsToHitRecords,
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
import type { AvailabilityWindowEntry } from '../cache/types.js';
import type { ScanResult, ScanResultJSON } from '../types/scanner.js';
import type { AvailabilityAlert } from '../notifications/notification-service.js';
import type { AvailabilityHitRecord } from '../state/scan-state.js';
import type { Alert } from '../config/alerts.js';
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
  /** If true, scan ALL alerts regardless of enabled flag (used by CLI one-off scan) */
  includeDisabled?: boolean | undefined;
}

export interface ScanTargetResult {
  alert: Alert;
  results: ScanResult[];
  newHitCount: number;
  skipped?: boolean | undefined;
}

export interface RunScanSummary {
  targets: ScanTargetResult[];
  totalCandidates: number;
  totalMatches: number;
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
  alertsById: Map<string, Alert>,
  serializedById: Map<string, ScanResultJSON[]>,
  checkedAt: string,
): AvailabilityAlert[] {
  const resultByKey = new Map<string, ScanResultJSON>();
  for (const serialized of serializedById.values()) {
    for (const r of serialized) {
      for (const hit of r.hits) {
        resultByKey.set(`${r.targetId}|${hit.siteName}|${r.candidate.arrivalDate}|${r.candidate.endDate}`, r);
      }
    }
  }

  return hits.flatMap((hit) => {
    if (hit.savedSearchId !== undefined) {
      // Saved-search hit: source names from the hit record itself
      const item: AvailabilityAlert = {
        hit,
        parkName: hit.parkName ?? '',
        campgroundName: hit.campgroundName ?? '',
        sourceUrl: '',
        checkedAt,
      };
      if (hit.availabilityAsOf !== undefined) item.availabilityAsOf = hit.availabilityAsOf;
      return [item];
    }

    // Legacy Target hit
    const alert = alertsById.get(hit.targetId);
    if (!alert) return [];
    const result = resultByKey.get(hitKey(hit));
    const item: AvailabilityAlert = {
      hit,
      parkName: alert.parkName,
      campgroundName: alert.campgroundName,
      sourceUrl: result?.sourceUrl ?? '',
      checkedAt,
    };
    if (hit.availabilityAsOf !== undefined) item.availabilityAsOf = hit.availabilityAsOf;
    return [item];
  });
}

// ---------------------------------------------------------------------------
// Core scan orchestration — shared by CLI and worker
// ---------------------------------------------------------------------------

export async function runScan(options: RunScanOptions = {}): Promise<RunScanSummary> {
  const { notify = true, includeDisabled = false } = options;
  const stateDir = options.stateDir ?? defaultStateDir();

  const allAlerts = listAlerts();

  // Filter: by targetId if given, otherwise active only (unless includeDisabled)
  let alerts: Alert[];
  if (options.targetId) {
    alerts = allAlerts.filter((a) => a.id === options.targetId);
  } else if (includeDisabled) {
    alerts = allAlerts;
  } else {
    alerts = allAlerts.filter((a) => a.enabled);
  }

  const targetResults: ScanTargetResult[] = [];
  let totalCandidates = 0;

  // Report disabled alerts that were skipped
  if (!options.targetId && !includeDisabled) {
    const skipped = allAlerts.filter((a) => !a.enabled);
    for (const a of skipped) {
      console.log(`Skipping (disabled): ${a.name}`);
      targetResults.push({ alert: a, results: [], newHitCount: 0, skipped: true });
    }
  }

  // One cached-windows read per (park, provider), shared by its alerts.
  const windowsByPark = new Map<string, AvailabilityWindowEntry[]>();
  async function windowsFor(alert: Alert): Promise<AvailabilityWindowEntry[]> {
    const key = `${alert.provider}|${alert.parkPageId}`;
    if (!windowsByPark.has(key)) {
      windowsByPark.set(key, await getEntriesForPark(alert.parkPageId, alert.provider));
    }
    return windowsByPark.get(key)!;
  }

  const now = new Date().toISOString();
  const today = todayUtc();

  const allIncoming: AvailabilityHitRecord[] = [];
  const checkedKeys = new Set<string>();
  const alertsById = new Map<string, Alert>();
  const savedSearchesById = new Map<string, SavedSearch>();
  const serializedById = new Map<string, ScanResultJSON[]>();

  // ---------------------------------------------------------------------------
  // Legacy Target loop
  // ---------------------------------------------------------------------------

  for (const alert of alerts) {
    console.log(`Scanning: ${alert.name}`);
    alertsById.set(alert.id, alert);
    const candidates = generateScanCandidates(alert);
    console.log(`  ${candidates.length} candidates (cache-backed)`);
    totalCandidates += candidates.length;

    let results: ScanResult[];
    try {
      const windows = await windowsFor(alert);
      results = matchCandidates(alert, candidates, windows, now);
    } catch (err: unknown) {
      console.error(`  Cache read failed for ${alert.name}: ${String(err)} — skipping target`);
      targetResults.push({ alert, results: [], newHitCount: 0, skipped: true });
      continue;
    }

    // Every (candidate × acceptable site) was evaluated this run — record it so
    // reconcileHits can distinguish "checked and gone" from "not scanned".
    for (const c of candidates) {
      for (const site of alert.acceptableSites) {
        checkedKeys.add(`${alert.id}|${site}|${c.arrivalDate}|${c.endDate}`);
      }
    }

    const serialized = results.map(serializeResult);
    serializedById.set(alert.id, serialized);
    writeLatestScan(stateDir, alert.id, buildScanSummary(alert.id, alert.name, serialized));

    allIncoming.push(...resultsToHitRecords(serialized, now));
    targetResults.push({ alert, results, newHitCount: 0 });
  }

  // ---------------------------------------------------------------------------
  // Saved-search source (alert_enabled=true only)
  // Only runs when no targetId filter is active (saved searches don't have a
  // legacy targetId to filter on).
  // ---------------------------------------------------------------------------

  if (!options.targetId) {
    let savedSearches: SavedSearch[] = [];
    try {
      savedSearches = await listAlertEnabledSavedSearches();
    } catch (err: unknown) {
      console.error(`Saved-search store unavailable: ${String(err)} — skipping saved-search source`);
    }

    if (savedSearches.length > 0) {
      // Build the region resolver once and share across all searches this run.
      const parkRegionOf = buildParkRegionOf();
      // Read existing hits once for the savedSearchCheckedKeys computation.
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

        // Merge per-search checkedKeys into the global set for reconcileHits.
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

  // Per-target new-hit counts for the summary output
  const toNotifyByTarget = new Map<string, number>();
  for (const h of toNotify) {
    toNotifyByTarget.set(h.targetId, (toNotifyByTarget.get(h.targetId) ?? 0) + 1);
  }
  for (const t of targetResults) {
    if (!t.skipped) t.newHitCount = toNotifyByTarget.get(t.alert.id) ?? 0;
  }

  if (notify && toNotify.length > 0) {
    const items = buildAvailabilityAlerts(toNotify, alertsById, serializedById, now);

    // Console is best-effort and never gates state.
    await new ConsoleNotificationService().notify(items);

    // Email gating: legacy Alerts use alert.emailEnabled; saved searches use search.emailEnabled.
    const emailItems = items.filter((i) => {
      if (i.hit.savedSearchId !== undefined) {
        return savedSearchesById.get(i.hit.savedSearchId)?.emailEnabled ?? false;
      }
      return alertsById.get(i.hit.targetId)?.emailEnabled ?? false;
    });
    const consoleOnlyItems = items.filter((i) => {
      if (i.hit.savedSearchId !== undefined) {
        return !(savedSearchesById.get(i.hit.savedSearchId)?.emailEnabled ?? false);
      }
      return !(alertsById.get(i.hit.targetId)?.emailEnabled ?? false);
    });

    let emailResult: 'delivered' | 'skipped-unconfigured' | 'failed' = 'delivered';
    if (emailItems.length > 0) {
      emailResult = await new EmailNotificationService().notify(emailItems);
    }

    // At-least-once: stamp notifiedAt unless the email actually failed.
    // Console-only hits stamp after console output (their only channel).
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

  const activeResults = targetResults.filter((t) => !t.skipped);

  return {
    targets: targetResults,
    totalCandidates,
    totalMatches: activeResults.reduce(
      (sum, t) => sum + t.results.filter((r) => r.hits.length > 0).length,
      0
    ),
    totalNewHits: toNotify.length,
    skippedCount: targetResults.filter((t) => t.skipped).length,
  };
}
