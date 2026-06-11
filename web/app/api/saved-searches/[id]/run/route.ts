import { NextRequest, NextResponse } from 'next/server';
import { getSavedSearch, buildParkRegionOf } from '../../../../../lib/saved-searches.js';
import { searchAvailableStays, getEntriesForPark } from '../../../../../lib/availability-cache.js';
import { matchSavedSearch, todayUtc } from '../../../../../../src/saved-search/match.js';
import type { SavedSearchOpening } from '../../../../../../src/saved-search/match.js';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<{ openings: SavedSearchOpening[] } | { error: string }>> {
  try {
    const { id } = await params;
    const savedSearch = await getSavedSearch(id);
    if (!savedSearch) {
      return NextResponse.json({ error: 'Saved search not found' }, { status: 404 });
    }

    // Must match run-scan.ts's UTC-anchored today to avoid date divergence between 17:00–00:00 PDT.
    const today = todayUtc();
    const parkRegionOf = buildParkRegionOf();

    const openings = await matchSavedSearch(
      savedSearch,
      { searchAvailableStays, getEntriesForPark, parkRegionOf },
      today,
    );

    return NextResponse.json({ openings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
