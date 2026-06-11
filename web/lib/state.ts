import path from 'path';
import {
  readLatestScanState,
  readHitsState,
  writeLatestScan,
  writeHitsState,
  reconcileHits,
  resultsToHitRecords,
  buildScanSummary,
  hitKey,
} from '../../src/state/scan-state';

export { hitKey } from '../../src/state/scan-state';

export type {
  LatestScanSummary,
  LatestScanState,
  AvailabilityHitRecord,
  HitsState,
} from '../../src/state/scan-state';

// In Next.js, process.cwd() is the web/ directory — go up one to reach repo root
function stateDir(): string {
  return path.join(process.cwd(), '..', '.campbrain', 'state');
}

export function getLatestScanState() {
  return readLatestScanState(stateDir());
}

export function getHitsState() {
  return readHitsState(stateDir());
}

/**
 * Hits worth showing as "Recent openings": future arrivals that have not
 * disappeared from availability, newest first.
 */
export function getActiveOpenings() {
  const today = new Date().toISOString().slice(0, 10);
  return getHitsState()
    .hits.filter((h) => h.arrivalDate >= today && !h.disappearedAt)
    .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));
}

export function saveScanResults(targetId: string, targetName: string, results: import('../../src/types/scanner').ScanResultJSON[]) {
  const dir = stateDir();
  const summary = buildScanSummary(targetId, targetName, results);
  writeLatestScan(dir, targetId, summary);

  const newHits = resultsToHitRecords(results);
  if (newHits.length > 0) {
    const existing = readHitsState(dir);
    const now = new Date().toISOString();
    // Web scans record hits but never notify — toNotify is discarded; the worker's
    // at-least-once pass picks up any un-notified hits on its next cycle.
    const { merged } = reconcileHits(
      existing,
      newHits,
      new Set(newHits.map(hitKey)),
      now,
      now.slice(0, 10),
    );
    writeHitsState(dir, merged);
  }
}
