import path from 'path';
import {
  readLatestScanState,
  readHitsState,
  writeLatestScan,
  writeHitsState,
  mergeHits,
  resultsToHitRecords,
  buildScanSummary,
} from '../../src/state/scan-state';

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

export function saveScanResults(targetId: string, targetName: string, results: import('../../src/types/scanner').ScanResultJSON[]) {
  const dir = stateDir();
  const summary = buildScanSummary(targetId, targetName, results);
  writeLatestScan(dir, targetId, summary);

  const newHits = resultsToHitRecords(results);
  if (newHits.length > 0) {
    const existing = readHitsState(dir);
    const merged = mergeHits(existing, newHits);
    writeHitsState(dir, merged);
  }
}
