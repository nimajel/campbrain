import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { listSavedSearches, createSavedSearch } from '../../../lib/saved-searches.js';
import type { SavedSearch, SavedSearchInput } from '../../../lib/saved-searches.js';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<{ savedSearches: SavedSearch[] } | { error: string }>> {
  try {
    const savedSearches = await listSavedSearches(null);
    return NextResponse.json({ savedSearches });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest
): Promise<NextResponse<{ savedSearch: SavedSearch } | { error: string }>> {
  try {
    const body = (await req.json()) as SavedSearchInput;
    const savedSearch = await createSavedSearch(body);
    return NextResponse.json({ savedSearch }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
