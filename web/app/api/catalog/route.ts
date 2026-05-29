import { NextResponse } from 'next/server';
import { listParksWeb } from '../../../lib/catalog';

export async function GET() {
  try {
    const parks = listParksWeb();
    return NextResponse.json({ provider: 'california-parks', parks });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
