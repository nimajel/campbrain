import { NextRequest, NextResponse } from 'next/server';
import { getAlertWeb } from '../../../../../lib/alerts';
import { runScan } from '../../../../../lib/scanner';
import { saveScanResults } from '../../../../../lib/state';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const alert = getAlertWeb(id);

    if (!alert) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    if (!alert.enabled) {
      return NextResponse.json({ error: 'Alert is disabled' }, { status: 400 });
    }

    const results = await runScan(alert, 9);

    try {
      saveScanResults(alert.id, alert.name, results);
    } catch {
      // State write failure should not break the scan response
    }

    return NextResponse.json({
      alertId: alert.id,
      alertName: alert.name,
      results,
      matchCount: results.filter((r) => r.hits.length > 0).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
