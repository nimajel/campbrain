import { NextResponse } from 'next/server';
import { getLatestScanState } from '../../../lib/state';

export async function GET() {
  try {
    const scanState = getLatestScanState();
    return NextResponse.json(scanState);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
