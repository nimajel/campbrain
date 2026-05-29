import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { discoverCaliforniaParkCatalog } from '../../../../../src/catalog/discover-california-parks';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      parkPageId?: string;
      parkName?: string;
      sampleDate?: string;
      nights?: number;
    };

    if (!body.parkPageId || !body.parkName || !body.sampleDate) {
      return NextResponse.json(
        { error: 'parkPageId, parkName, and sampleDate are required' },
        { status: 400 }
      );
    }

    const dataDir = path.join(process.cwd(), '..', 'data');
    const result = await discoverCaliforniaParkCatalog({
      parkPageId: body.parkPageId,
      parkName: body.parkName,
      sampleDate: body.sampleDate,
      nights: body.nights ?? 1,
      dataDir,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
