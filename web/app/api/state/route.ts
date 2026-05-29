import { NextResponse } from 'next/server';
import { getLatestScanState, getHitsState } from '../../../lib/state';

export async function GET() {
  try {
    const latest = getLatestScanState();
    const hits = getHitsState();
    return NextResponse.json({ latest, hits });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
