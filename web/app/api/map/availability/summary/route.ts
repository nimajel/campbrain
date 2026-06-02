import { NextRequest, NextResponse } from 'next/server';
import { getParksWithAvailability } from '../../../../../lib/availability-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') ?? null;
  const to = searchParams.get('to') ?? null;
  const filtersParam = searchParams.get('filters') ?? '';
  const activeFilters = filtersParam ? filtersParam.split(',') : [];
  const weekendsOnly = searchParams.get('weekendsOnly') === 'true';

  const parks = await getParksWithAvailability(from, to, activeFilters, weekendsOnly);
  return NextResponse.json({ parks });
}
