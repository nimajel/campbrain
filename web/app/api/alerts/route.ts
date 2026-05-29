import { NextRequest, NextResponse } from 'next/server';
import { listAlertsWeb, createAlertWeb } from '../../../lib/alerts';

export async function GET() {
  try {
    const alerts = listAlertsWeb();
    return NextResponse.json(alerts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as unknown;
    const alert = createAlertWeb(body);
    return NextResponse.json(alert, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
