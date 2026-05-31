import path from 'path';
import { listAlerts } from '../config/alerts.js';
import { generateScanCandidates } from '../rules/scan-candidates.js';
import { CaliforniaParksProvider } from '../providers/california-parks-provider.js';
import { RecreationGovProvider } from '../providers/recreation-gov-provider.js';
import type { AvailabilityProvider } from '../providers/availability-provider.js';
import { serializeResult } from '../types/scanner.js';
import {
  buildScanSummary,
  writeLatestScan,
  readHitsState,
  mergeHits,
  writeHitsState,
  resultsToHitRecords,
  findNewHits,
} from '../state/scan-state.js';
import { ConsoleNotificationService } from '../notifications/console-notification-service.js';
import { EmailNotificationService } from '../notifications/email-notification-service.js';
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

function getProvider(providerName: string): AvailabilityProvider {
  switch (providerName) {
    case 'recreation-gov':
      return new RecreationGovProvider();
    default:
      return new CaliforniaParksProvider();
  }
}

function defaultStateDir(): string {
  return path.join(process.cwd(), '.campbrain', 'state');
}

function buildAvailabilityAlerts(
  newHits: AvailabilityHitRecord[],
  alert: Alert,
  serialized: ScanResultJSON[]
): AvailabilityAlert[] {
  const resultByKey = new Map<string, ScanResultJSON>();
  for (const r of serialized) {
    for (const hit of r.hits) {
      const key = `${r.targetId}|${hit.siteName}|${r.candidate.arrivalDate}|${r.candidate.endDate}`;
      resultByKey.set(key, r);
    }
  }

  const checkedAt = new Date().toISOString();

  return newHits.map((hit) => {
    const result = resultByKey.get(
      `${hit.targetId}|${hit.siteName}|${hit.arrivalDate}|${hit.departureDate}`
    );
    return {
      hit,
      parkName: alert.parkName,
      campgroundName: alert.campgroundName,
      sourceUrl: result?.sourceUrl ?? '',
      checkedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Core scan orchestration — shared by CLI and worker
// ---------------------------------------------------------------------------

export async function runScan(options: RunScanOptions = {}): Promise<RunScanSummary> {
  const { debug = false, notify = true, includeDisabled = false } = options;
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
  const consoleNotifyItems: AvailabilityAlert[] = [];
  const emailNotifyItems: AvailabilityAlert[] = [];

  // Report disabled alerts that were skipped
  if (!options.targetId && !includeDisabled) {
    const skipped = allAlerts.filter((a) => !a.enabled);
    for (const a of skipped) {
      console.log(`Skipping (disabled): ${a.name}`);
      targetResults.push({ alert: a, results: [], newHitCount: 0, skipped: true });
    }
  }

  for (const alert of alerts) {
    console.log(`Scanning: ${alert.name}`);
    const candidates = generateScanCandidates(alert);
    console.log(`  ${candidates.length} candidates`);
    totalCandidates += candidates.length;

    const provider = getProvider(alert.provider);
    const results = await provider.scan(alert, candidates, debug);

    const serialized = results.map(serializeResult);
    const summary = buildScanSummary(alert.id, alert.name, serialized);
    writeLatestScan(stateDir, alert.id, summary);

    const incoming = resultsToHitRecords(serialized);
    let newHitCount = 0;

    if (incoming.length > 0) {
      const existing = readHitsState(stateDir);
      const newHits = findNewHits(existing, incoming);
      const merged = mergeHits(existing, incoming);
      writeHitsState(stateDir, merged);
      newHitCount = newHits.length;

      if (notify && newHits.length > 0) {
        const items = buildAvailabilityAlerts(newHits, alert, serialized);
        consoleNotifyItems.push(...items);
        if (alert.emailEnabled) {
          emailNotifyItems.push(...items);
        }
      }
    }

    targetResults.push({ alert, results, newHitCount });
  }

  if (notify) {
    if (consoleNotifyItems.length > 0) {
      await new ConsoleNotificationService().notify(consoleNotifyItems);
    }
    if (emailNotifyItems.length > 0) {
      await new EmailNotificationService().notify(emailNotifyItems);
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
    totalNewHits: consoleNotifyItems.length,
    skippedCount: targetResults.filter((t) => t.skipped).length,
  };
}
