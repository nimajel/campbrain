import { NextRequest, NextResponse } from 'next/server';
import { getParkWeb } from '../../../../../lib/catalog';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ parkPageId: string }> }
) {
  try {
    const { parkPageId } = await params;
    const park = getParkWeb(parkPageId);
    if (!park) {
      return NextResponse.json({ error: 'Park not found' }, { status: 404 });
    }
    return NextResponse.json(park);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
