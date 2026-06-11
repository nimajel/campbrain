import { describe, it, expect } from 'vitest';
import {
  hitKey,
  openingsToHitRecords,
} from '../src/state/scan-state.js';
import type { AvailabilityHitRecord } from '../src/state/scan-state.js';
import type { SavedSearchOpening } from '../src/saved-search/match.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLegacyRecord(overrides: Partial<AvailabilityHitRecord> = {}): AvailabilityHitRecord {
  return {
    targetId: 'angel-island',
    targetName: 'Angel Island',
    siteName: 'Site A',
    arrivalDate: '2026-08-14',
    departureDate: '2026-08-16',
    nights: 2,
    firstSeenAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSavedSearchRecord(overrides: Partial<AvailabilityHitRecord> = {}): AvailabilityHitRecord {
  return {
    targetId: '',
    targetName: '',
    savedSearchId: 'ss-123',
    parkPageId: 'park-a',
    campgroundName: 'Main Campground',
    siteName: 'Site A',
    arrivalDate: '2026-08-14',
    departureDate: '2026-08-16',
    nights: 2,
    firstSeenAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeOpening(overrides: Partial<SavedSearchOpening> = {}): SavedSearchOpening {
  return {
    savedSearchId: 'ss-123',
    parkPageId: 'park-a',
    parkName: 'Park A',
    campgroundName: 'Main Campground',
    siteName: 'Site 1',
    arrivalDate: '2026-08-14',
    departureDate: '2026-08-16',
    nights: 2,
    bookingUrl: 'https://example.com/book',
    availabilityAsOf: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// hitKey — saved-search form vs legacy form
// ---------------------------------------------------------------------------

describe('hitKey — saved-search key', () => {
  it('emits ss: prefix when savedSearchId is set', () => {
    const record = makeSavedSearchRecord();
    const key = hitKey(record);
    expect(key.startsWith('ss:')).toBe(true);
  });

  it('includes savedSearchId, parkPageId, campgroundName, siteName, arrivalDate, departureDate', () => {
    const record = makeSavedSearchRecord({
      savedSearchId: 'ss-abc',
      parkPageId: 'park-x',
      campgroundName: 'Lakeside',
      siteName: 'Site 7',
      arrivalDate: '2026-09-01',
      departureDate: '2026-09-03',
    });
    const key = hitKey(record);
    expect(key).toBe('ss:ss-abc|park-x|Lakeside|Site 7|2026-09-01|2026-09-03');
  });

  it('legacy form: no ss: prefix when savedSearchId is absent', () => {
    const record = makeLegacyRecord();
    const key = hitKey(record);
    expect(key.startsWith('ss:')).toBe(false);
    expect(key).toBe('angel-island|Site A|2026-08-14|2026-08-16');
  });

  it('saved-search key NEVER collides with a legacy Target key for the same site+dates', () => {
    const legacyRecord = makeLegacyRecord({
      targetId: 'ss-123',
      siteName: 'Site A',
      arrivalDate: '2026-08-14',
      departureDate: '2026-08-16',
    });
    const ssRecord = makeSavedSearchRecord({
      savedSearchId: 'ss-123',
      siteName: 'Site A',
      arrivalDate: '2026-08-14',
      departureDate: '2026-08-16',
    });
    expect(hitKey(legacyRecord)).not.toBe(hitKey(ssRecord));
  });
});

// ---------------------------------------------------------------------------
// openingsToHitRecords
// ---------------------------------------------------------------------------

describe('openingsToHitRecords', () => {
  const now = '2026-06-10T12:00:00.000Z';

  it('maps every opening field onto the record', () => {
    const opening = makeOpening();
    const records = openingsToHitRecords([opening], now);
    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r.savedSearchId).toBe('ss-123');
    expect(r.parkPageId).toBe('park-a');
    expect(r.parkName).toBe('Park A');
    expect(r.campgroundName).toBe('Main Campground');
    expect(r.siteName).toBe('Site 1');
    expect(r.arrivalDate).toBe('2026-08-14');
    expect(r.departureDate).toBe('2026-08-16');
    expect(r.nights).toBe(2);
    expect(r.bookingUrl).toBe('https://example.com/book');
    expect(r.availabilityAsOf).toBe('2026-06-01T00:00:00.000Z');
    expect(r.firstSeenAt).toBe(now);
    expect(r.lastSeenAt).toBe(now);
  });

  it('sets firstSeenAt and lastSeenAt to now', () => {
    const opening = makeOpening();
    const records = openingsToHitRecords([opening], '2026-07-01T08:00:00.000Z');
    expect(records[0]?.firstSeenAt).toBe('2026-07-01T08:00:00.000Z');
    expect(records[0]?.lastSeenAt).toBe('2026-07-01T08:00:00.000Z');
  });

  it('handles null bookingUrl', () => {
    const opening = makeOpening({ bookingUrl: null });
    const records = openingsToHitRecords([opening], now);
    expect(records[0]?.bookingUrl).toBeUndefined();
  });

  it('handles absent availabilityAsOf', () => {
    const { availabilityAsOf: _, ...rest } = makeOpening();
    const opening: SavedSearchOpening = { ...rest, bookingUrl: null };
    const records = openingsToHitRecords([opening], now);
    expect(records[0]?.availabilityAsOf).toBeUndefined();
  });

  it('produces a hit key with ss: prefix', () => {
    const opening = makeOpening();
    const records = openingsToHitRecords([opening], now);
    const key = hitKey(records[0]!);
    expect(key.startsWith('ss:')).toBe(true);
  });

  it('returns empty array for empty openings list', () => {
    expect(openingsToHitRecords([], now)).toHaveLength(0);
  });

  it('converts multiple openings', () => {
    const openings = [
      makeOpening({ siteName: 'Site 1' }),
      makeOpening({ siteName: 'Site 2' }),
      makeOpening({ siteName: 'Site 3' }),
    ];
    const records = openingsToHitRecords(openings, now);
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.siteName)).toEqual(['Site 1', 'Site 2', 'Site 3']);
  });
});
