import path from 'path';
import { listAlerts } from '../config/alerts.js';
import { generateScanCandidates } from '../rules/scan-candidates.js';
import { getEntriesForPark } from '../cache/availability-cache.js';
import { matchCandidates } from './match-candidates.js';
import { serializeResult } from '../types/scanner.js';
import {
  buildScanSummary,
  writeLatestScan,
  readHitsState,
  writeHitsState,
  resultsToHitRecords,
  reconcileHits,
  hitKey,
} from '../state/scan-state.js';
import { ConsoleNotificationService } from '../notifications/console-notification-service.js';
import { EmailNotificationService } from '../notifications/email-notification-service.js';
import type { AvailabilityWindowEntry } from '../cache/types.js';
import type { ScanResult, ScanResultJSON } from '../types/scanner.js';
import type { AvailabilityAlert } from '../notifications/notification-service.js';
import type { AvailabilityHitRecord } from '../state/scan-state.js';
import type { Alert } from '../config/alerts.js';

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
  const today = now.slice(0, 10);

  const allIncoming: AvailabilityHitRecord[] = [];
  const checkedKeys = new Set<string>();
  const alertsById = new Map<string, Alert>();
  const serializedById = new Map<string, ScanResultJSON[]>();

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

    const emailItems = items.filter((i) => alertsById.get(i.hit.targetId)?.emailEnabled);
    const consoleOnlyItems = items.filter((i) => !alertsById.get(i.hit.targetId)?.emailEnabled);

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
        version: 2,
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
