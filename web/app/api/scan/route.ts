import { NextRequest, NextResponse } from 'next/server';
import { loadTargets } from '../../../lib/targets';
import { getEntriesForPark } from '../../../../src/cache/availability-cache';
import { matchCandidates } from '../../../../src/scanner/match-candidates';
import { generateScanCandidates } from '../../../../src/rules/scan-candidates';
import { serializeResult } from '../../../../src/types/scanner';
import { saveScanResults } from '../../../lib/state';

const MAX_WEB_CANDIDATES = 9;

async function runTargetScan(
  target: Parameters<typeof generateScanCandidates>[0],
  maxCandidates: number = MAX_WEB_CANDIDATES,
) {
  const all = generateScanCandidates(target);
  const candidates = all.slice(0, maxCandidates);
  const windows = await getEntriesForPark(target.parkPageId, target.provider);
  return matchCandidates(target, candidates, windows).map(serializeResult);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { targetId?: string; maxCandidates?: number };
    const targets = loadTargets();

    const target = body.targetId
      ? targets.find((t) => t.id === body.targetId)
      : targets[0];

    if (!target) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }

    const results = await runTargetScan(target, body.maxCandidates ?? 9);

    // Persist state (non-fatal if it fails)
    try {
      saveScanResults(target.id, target.name, results);
    } catch {
      // State write failure should not break the scan response
    }

    return NextResponse.json({ targetId: target.id, targetName: target.name, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
