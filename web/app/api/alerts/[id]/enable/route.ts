import { NextRequest, NextResponse } from 'next/server';
import { enableAlertWeb } from '../../../../../lib/alerts';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const alert = enableAlertWeb(id);
    return NextResponse.json(alert);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { message?: string }).message?.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
