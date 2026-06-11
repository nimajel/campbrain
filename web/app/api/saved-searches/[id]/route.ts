import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getSavedSearch, updateSavedSearch, deleteSavedSearch } from '../../../../lib/saved-searches.js';
import type { SavedSearch } from '../../../../lib/saved-searches.js';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<{ savedSearch: SavedSearch } | { error: string }>> {
  try {
    const { id } = await params;
    const savedSearch = await getSavedSearch(id);
    if (!savedSearch) {
      return NextResponse.json({ error: 'Saved search not found' }, { status: 404 });
    }
    return NextResponse.json({ savedSearch });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<{ savedSearch: SavedSearch } | { error: string }>> {
  try {
    const { id } = await params;
    const existing = await getSavedSearch(id);
    if (!existing) {
      return NextResponse.json({ error: 'Saved search not found' }, { status: 404 });
    }
    const body = (await req.json()) as unknown;
    const savedSearch = await updateSavedSearch(id, body as Parameters<typeof updateSavedSearch>[1]);
    return NextResponse.json({ savedSearch });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    // updateSavedSearch throws "not found" if the id disappears between the check and update
    if (message.toLowerCase().includes('not found')) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<null | { error: string }>> {
  try {
    const { id } = await params;
    await deleteSavedSearch(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
