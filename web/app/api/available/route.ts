import { NextResponse } from 'next/server';
import { listFreshEntriesWeb } from '../../../lib/availability-cache';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const entries = listFreshEntriesWeb();
    return NextResponse.json({ entries, readAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
