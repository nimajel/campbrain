import { NextResponse } from 'next/server';
import { runProactiveScan } from '../../../../../src/scanner/proactive-scanner';
import { getCacheStats } from '../../../../../src/cache/availability-cache';

// Minimum gap between manual refreshes — prevents hammering the provider
const MIN_REFRESH_GAP_MS = 5 * 60 * 1000; // 5 minutes

// Track last refresh time in module scope (persists across requests in same process)
let lastRefreshAt = 0;
let refreshRunning = false;

export async function POST() {
  if (refreshRunning) {
    return NextResponse.json(
      { error: 'Refresh already in progress. Check back in a moment.' },
      { status: 429 }
    );
  }

  const now = Date.now();
  const sinceLastMs = now - lastRefreshAt;
  if (lastRefreshAt > 0 && sinceLastMs < MIN_REFRESH_GAP_MS) {
    const waitSecs = Math.ceil((MIN_REFRESH_GAP_MS - sinceLastMs) / 1000);
    return NextResponse.json(
      { error: `Please wait ${waitSecs}s before refreshing again.` },
      { status: 429 }
    );
  }

  refreshRunning = true;
  lastRefreshAt = now;

  try {
    const messages: string[] = [];
    const summary = await runProactiveScan({
      logger: (msg) => messages.push(msg),
    });

    return NextResponse.json({ summary, messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    refreshRunning = false;
  }
}

export async function GET() {
  const { entryCount, lastScanAt } = await getCacheStats();
  return NextResponse.json({
    entryCount,
    lastScanAt,
    refreshRunning,
    lastRefreshAt: lastRefreshAt > 0 ? new Date(lastRefreshAt).toISOString() : null,
    minRefreshGapMs: MIN_REFRESH_GAP_MS,
  });
}
