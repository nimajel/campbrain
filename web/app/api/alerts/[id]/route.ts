import { NextRequest, NextResponse } from 'next/server';
import { getAlertWeb, updateAlertWeb, deleteAlertWeb } from '../../../../lib/alerts';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const alert = getAlertWeb(id);
    if (!alert) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    return NextResponse.json(alert);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as unknown;
    const updated = updateAlertWeb(id, body);
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { message?: string }).message?.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    deleteAlertWeb(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { message?: string }).message?.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
