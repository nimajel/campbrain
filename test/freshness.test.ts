import { describe, it, expect } from 'vitest';
import { oldestCoveringScan } from '../src/cache/freshness.js';
import type { AvailabilityWindowEntry } from '../src/cache/types.js';

function makeWindow(
  windowStart: string,
  windowEnd: string,
  scannedAt: string,
): AvailabilityWindowEntry {
  return {
    parkPageId: '468',
    parkName: 'Test Park',
    windowStart,
    windowEnd,
    scannedAt,
    sourceUrl: 'https://example.com',
    campgrounds: [],
  };
}

describe('oldestCoveringScan', () => {
  it('returns undefined when no windows are provided', () => {
    expect(oldestCoveringScan([], ['2026-07-10', '2026-07-11'])).toBeUndefined();
  });

  it('returns undefined when no window covers any of the dates', () => {
    const windows = [makeWindow('2026-07-01', '2026-07-08', '2026-06-10T10:00:00.000Z')];
    const result = oldestCoveringScan(windows, ['2026-07-15', '2026-07-16']);
    expect(result).toBeUndefined();
  });

  it('returns the scannedAt of the single covering window', () => {
    const windows = [makeWindow('2026-07-08', '2026-07-15', '2026-06-10T11:00:00.000Z')];
    const result = oldestCoveringScan(windows, ['2026-07-10', '2026-07-11']);
    expect(result).toBe('2026-06-10T11:00:00.000Z');
  });

  it('returns the oldest scannedAt among multiple covering windows', () => {
    const windows = [
      makeWindow('2026-07-04', '2026-07-10', '2026-06-10T09:00:00.000Z'),
      makeWindow('2026-07-11', '2026-07-18', '2026-06-10T11:30:00.000Z'),
    ];
    const result = oldestCoveringScan(windows, ['2026-07-10', '2026-07-11']);
    expect(result).toBe('2026-06-10T09:00:00.000Z');
  });

  it('only considers windows that actually cover at least one date', () => {
    const windows = [
      makeWindow('2026-07-04', '2026-07-09', '2026-06-10T08:00:00.000Z'), // does not cover 07-10 or 07-11
      makeWindow('2026-07-10', '2026-07-15', '2026-06-10T12:00:00.000Z'), // covers both
    ];
    const result = oldestCoveringScan(windows, ['2026-07-10', '2026-07-11']);
    expect(result).toBe('2026-06-10T12:00:00.000Z');
  });

  it('a window covers a date when the date equals windowStart', () => {
    const windows = [makeWindow('2026-07-10', '2026-07-17', '2026-06-10T10:00:00.000Z')];
    const result = oldestCoveringScan(windows, ['2026-07-10']);
    expect(result).toBe('2026-06-10T10:00:00.000Z');
  });

  it('a window covers a date when the date equals windowEnd', () => {
    const windows = [makeWindow('2026-07-03', '2026-07-10', '2026-06-10T10:00:00.000Z')];
    const result = oldestCoveringScan(windows, ['2026-07-10']);
    expect(result).toBe('2026-06-10T10:00:00.000Z');
  });

  it('handles a single date in the dates array', () => {
    const windows = [makeWindow('2026-07-08', '2026-07-15', '2026-06-10T11:00:00.000Z')];
    const result = oldestCoveringScan(windows, ['2026-07-12']);
    expect(result).toBe('2026-06-10T11:00:00.000Z');
  });
});
