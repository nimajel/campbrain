import { getEntriesForPark } from '../../src/cache/availability-cache';
import { matchCandidates } from '../../src/scanner/match-candidates';
import { generateScanCandidates } from '../../src/rules/scan-candidates';
import type { Target } from '../../src/config/schemas';
import { serializeResult } from '../../src/types/scanner';

export type { ScanResultJSON } from '../../src/types/scanner';
export type { ScanResult } from '../../src/types/scanner';

import type { ScanResultJSON } from '../../src/types/scanner';

// Cap web-triggered scans so responses stay small (3 weekends × 3 candidates)
const MAX_WEB_CANDIDATES = 9;

export async function runScan(
  target: Target,
  maxCandidates: number = MAX_WEB_CANDIDATES
): Promise<ScanResultJSON[]> {
  const all = generateScanCandidates(target);
  const candidates = all.slice(0, maxCandidates);
  const windows = await getEntriesForPark(target.parkPageId, target.provider);
  return matchCandidates(target, candidates, windows).map(serializeResult);
}
