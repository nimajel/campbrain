import { NextRequest, NextResponse } from 'next/server';
import { getParkAvailabilityCounts } from '../../../../../lib/availability-cache';
import { parseFilterParams } from '../../../../../lib/filter-params';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') ?? null;
  const to = searchParams.get('to') ?? null;
  const weekendsOnly = searchParams.get('weekendsOnly') === 'true';
  const { access, kinds, hide, minNights } = parseFilterParams(searchParams);

  const parks = await getParkAvailabilityCounts({ from, to, access, kinds, hide, minNights, weekendsOnly });
  return NextResponse.json({ parks });
}
