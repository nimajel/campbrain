import { NextRequest, NextResponse } from 'next/server';
import { loadTargets } from '../../../lib/targets';
import { runScan } from '../../../lib/scanner';

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

    const results = await runScan(target, body.maxCandidates ?? 9);

    return NextResponse.json({ targetId: target.id, targetName: target.name, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
