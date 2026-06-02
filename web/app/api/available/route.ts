import { NextResponse } from 'next/server';
import { listAvailableStays } from '../../../lib/availability-cache';
import type { AvailableStay } from '../../../lib/availability-cache';

export const dynamic = 'force-dynamic';

// In-process cache — MV refresh takes ~seconds; serve from cache between worker scans
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
let cached: AvailableStay[] | null = null;
let cacheExpiresAt = 0;
let inflight: Promise<AvailableStay[]> | null = null;

async function getStays(): Promise<AvailableStay[]> {
  if (cached && Date.now() < cacheExpiresAt) return cached;
  if (!inflight) {
    const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    inflight = listAvailableStays(null, to).then((stays) => {
      cached = stays;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      inflight = null;
      return stays;
    }).catch((err) => {
      inflight = null;
      throw err;
    });
  }
  return inflight;
}

export function invalidateCache() {
  cached = null;
  cacheExpiresAt = 0;
}

export async function GET() {
  try {
    const stays = await getStays();
    return NextResponse.json({ stays, readAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
