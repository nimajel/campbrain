import { CaliforniaParksProvider } from '../../src/providers/california-parks-provider';
import { generateScanCandidates } from '../../src/rules/scan-candidates';
import type { Target } from '../../src/config/schemas';
import type { ScanResult, DailySiteStatus } from '../../src/types/scanner';

export type { ScanResult };

// Serializable version of ScanResult — Maps don't survive JSON.stringify/parse
export interface ScanResultJSON {
  targetId: string;
  targetName: string;
  candidate: ScanResult['candidate'];
  sourceUrl: string;
  debugHtmlPath: string;
  hits: ScanResult['hits'];
  parsingNotes: string;
  scannedAt: string;
  bookingUrl?: string;
  statusBySite?: Record<string, DailySiteStatus[]>;
}

export function serializeResult(r: ScanResult): ScanResultJSON {
  return {
    targetId: r.targetId,
    targetName: r.targetName,
    candidate: r.candidate,
    sourceUrl: r.sourceUrl,
    debugHtmlPath: r.debugHtmlPath,
    hits: r.hits,
    parsingNotes: r.parsingNotes,
    scannedAt: r.scannedAt,
    bookingUrl: r.bookingUrl,
    statusBySite: r.statusBySite
      ? Object.fromEntries(r.statusBySite)
      : undefined,
  };
}

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
