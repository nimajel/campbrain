import { CaliforniaParksProvider } from '../../src/providers/california-parks-provider';
import { generateScanCandidates } from '../../src/rules/scan-candidates';
import type { Target } from '../../src/config/schemas';
import { serializeResult } from '../../src/types/scanner';

export type { ScanResultJSON } from '../../src/types/scanner';
export type { ScanResult } from '../../src/types/scanner';

import type { ScanResultJSON } from '../../src/types/scanner';

// Limit web-triggered scans to avoid hammering the server (3 weekends × 3 candidates)
const MAX_WEB_CANDIDATES = 9;

export async function runScan(
  target: Target,
  maxCandidates: number = MAX_WEB_CANDIDATES
): Promise<ScanResultJSON[]> {
  const provider = new CaliforniaParksProvider();
  const all = generateScanCandidates(target);
  const candidates = all.slice(0, maxCandidates);
  const results = await provider.scan(target, candidates, false);
  return results.map(serializeResult);
}
