import dayjs from 'dayjs';
import { WINDOW_DAYS } from './types';
import type { AvailabilityWindowEntry } from './types';

// ---------------------------------------------------------------------------
// TTL — keyed on windowStart (most time-sensitive date in the window)
// ---------------------------------------------------------------------------

const TTL_MINUTES = {
  veryFar: 480,  // > 90 days — barely changes, 8h
  far: 240,      // 30–90 days — 4h
  near: 120,     // 7–30 days — 2h
  imminent: 30,  // < 7 days — 30min
} as const;

export function ttlMinutes(windowStart: string, nowMs = Date.now()): number {
  const daysUntil = dayjs(windowStart).diff(dayjs(nowMs), 'day');
  if (daysUntil < 7) return TTL_MINUTES.imminent;
  if (daysUntil < 30) return TTL_MINUTES.near;
  if (daysUntil < 90) return TTL_MINUTES.far;
  return TTL_MINUTES.veryFar;
}

export function isEntryStale(entry: AvailabilityWindowEntry, nowMs = Date.now()): boolean {
  const ttl = ttlMinutes(entry.windowStart, nowMs) * 60 * 1000;
  return nowMs - new Date(entry.scannedAt).getTime() > ttl;
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

export function generateWindowStarts(daysAhead: number, today?: string): string[] {
  const base = today ? dayjs(today) : dayjs();
  const windows: string[] = [];
  let offset = 2;
  while (offset <= daysAhead) {
    windows.push(base.add(offset, 'day').format('YYYY-MM-DD'));
    offset += WINDOW_DAYS;
  }
  return windows;
}

export function windowEnd(windowStart: string): string {
  return dayjs(windowStart).add(WINDOW_DAYS - 1, 'day').format('YYYY-MM-DD');
}
