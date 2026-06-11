import { describe, it, expect } from 'vitest';
import {
  reconcileHits,
  openingsToHitRecords,
  hitKey,
  savedSearchCheckedKeys,
} from '../src/state/scan-state.js';
import type { AvailabilityHitRecord, HitsState } from '../src/state/scan-state.js';
import type { SavedSearchOpening } from '../src/saved-search/match.js';

const NOW = '2026-06-10T12:00:00.000Z';
const TODAY = '2026-06-10';

function makeOpening(overrides: Partial<SavedSearchOpening> = {}): SavedSearchOpening {
  return {
    savedSearchId: 'ss-abc',
    parkPageId: 'park-1',
    parkName: 'Park One',
    campgroundName: 'Main CG',
    siteName: 'Site A',
    arrivalDate: '2026-08-01',
    departureDate: '2026-08-03',
    nights: 2,
    bookingUrl: 'https://example.com/book',
    availabilityAsOf: '2026-06-10T10:00:00.000Z',
    ...overrides,
  };
}

function makeExistingRecord(overrides: Partial<AvailabilityHitRecord> = {}): AvailabilityHitRecord {
  return {
    targetId: '',
    targetName: '',
    savedSearchId: 'ss-abc',
    parkPageId: 'park-1',
    parkName: 'Park One',
    campgroundName: 'Main CG',
    siteName: 'Site A',
    arrivalDate: '2026-08-01',
    departureDate: '2026-08-03',
    nights: 2,
    firstSeenAt: '2026-06-09T10:00:00.000Z',
    lastSeenAt: '2026-06-09T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// savedSearchCheckedKeys
// ---------------------------------------------------------------------------

describe('savedSearchCheckedKeys', () => {
  it('returns just the incoming keys when there are no existing records for this search', () => {
    const existing: HitsState = { version: 3, hits: [] };
    const incoming = openingsToHitRecords([makeOpening()], NOW);
    const incomingKeys = new Set(incoming.map(hitKey));
    const checked = savedSearchCheckedKeys(existing, 'ss-abc', incomingKeys);
    expect(checked).toEqual(incomingKeys);
  });

  it('includes stored keys for the same savedSearchId', () => {
    const record = makeExistingRecord({ notifiedAt: NOW });
    const existing: HitsState = { version: 3, hits: [record] };
    const incomingKeys = new Set<string>();
    const checked = savedSearchCheckedKeys(existing, 'ss-abc', incomingKeys);
    expect(checked.has(hitKey(record))).toBe(true);
  });

  it('does NOT include stored keys for a different savedSearchId', () => {
    const record = makeExistingRecord({ savedSearchId: 'ss-other', notifiedAt: NOW });
    const existing: HitsState = { version: 3, hits: [record] };
    const incomingKeys = new Set<string>();
    const checked = savedSearchCheckedKeys(existing, 'ss-abc', incomingKeys);
    expect(checked.has(hitKey(record))).toBe(false);
  });

  it('does NOT include legacy Target records (no savedSearchId)', () => {
    const record: AvailabilityHitRecord = {
      targetId: 't1',
      targetName: 'T1',
      siteName: 'Site A',
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-03',
      nights: 2,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      notifiedAt: NOW,
    };
    const existing: HitsState = { version: 3, hits: [record] };
    const incomingKeys = new Set<string>();
    const checked = savedSearchCheckedKeys(existing, 'ss-abc', incomingKeys);
    expect(checked.has(hitKey(record))).toBe(false);
  });

  it('unions stored and incoming keys', () => {
    const storedRecord = makeExistingRecord({ siteName: 'Site A', notifiedAt: NOW });
    const newOpening = makeOpening({ siteName: 'Site B' });
    const incoming = openingsToHitRecords([newOpening], NOW);
    const incomingKeys = new Set(incoming.map(hitKey));
    const existing: HitsState = { version: 3, hits: [storedRecord] };
    const checked = savedSearchCheckedKeys(existing, 'ss-abc', incomingKeys);
    expect(checked.has(hitKey(storedRecord))).toBe(true);
    expect(checked.has(hitKey(incoming[0]!))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reconcileHits integration — fed by openingsToHitRecords
// ---------------------------------------------------------------------------

describe('reconcileHits integration with saved-search openings', () => {
  it('new opening → in toNotify', () => {
    const opening = makeOpening();
    const incoming = openingsToHitRecords([opening], NOW);
    const incomingKeys = new Set(incoming.map(hitKey));
    const checked = savedSearchCheckedKeys({ version: 3, hits: [] }, 'ss-abc', incomingKeys);
    const { merged, toNotify } = reconcileHits({ version: 3, hits: [] }, incoming, checked, NOW, TODAY);
    expect(merged.hits).toHaveLength(1);
    expect(toNotify.map(hitKey)).toEqual(incoming.map(hitKey));
  });

  it('same opening on second run → NOT re-notified', () => {
    const opening = makeOpening();
    const firstRun = openingsToHitRecords([opening], '2026-06-09T12:00:00.000Z');
    const firstKeys = new Set(firstRun.map(hitKey));
    const firstChecked = savedSearchCheckedKeys({ version: 3, hits: [] }, 'ss-abc', firstKeys);
    const { merged: afterFirst } = reconcileHits({ version: 3, hits: [] }, firstRun, firstChecked, '2026-06-09T12:00:00.000Z', TODAY);

    // stamp notifiedAt to simulate successful notification
    const notified: HitsState = {
      version: 3,
      hits: afterFirst.hits.map((h) => ({ ...h, notifiedAt: '2026-06-09T12:05:00.000Z' })),
    };

    const secondRun = openingsToHitRecords([opening], NOW);
    const secondKeys = new Set(secondRun.map(hitKey));
    const secondChecked = savedSearchCheckedKeys(notified, 'ss-abc', secondKeys);
    const { toNotify } = reconcileHits(notified, secondRun, secondChecked, NOW, TODAY);
    expect(toNotify).toHaveLength(0);
  });

  it('opening disappears → disappearedAt set, not notified', () => {
    const opening = makeOpening();
    const firstRun = openingsToHitRecords([opening], '2026-06-09T12:00:00.000Z');
    const firstKeys = new Set(firstRun.map(hitKey));
    const firstChecked = savedSearchCheckedKeys({ version: 3, hits: [] }, 'ss-abc', firstKeys);
    const { merged: afterFirst } = reconcileHits({ version: 3, hits: [] }, firstRun, firstChecked, '2026-06-09T12:00:00.000Z', TODAY);
    const notified: HitsState = {
      version: 3,
      hits: afterFirst.hits.map((h) => ({ ...h, notifiedAt: '2026-06-09T12:05:00.000Z' })),
    };

    // second run: opening absent
    const emptyIncoming: AvailabilityHitRecord[] = [];
    const emptyKeys = new Set<string>();
    const checkedWhenAbsent = savedSearchCheckedKeys(notified, 'ss-abc', emptyKeys);
    const { merged, toNotify } = reconcileHits(notified, emptyIncoming, checkedWhenAbsent, NOW, TODAY);
    expect(merged.hits[0]!.disappearedAt).toBe(NOW);
    expect(toNotify).toHaveLength(0);
  });

  it('disappeared opening reappears → re-notified, disappearedAt cleared', () => {
    const opening = makeOpening();
    const disappeared = makeExistingRecord({
      notifiedAt: '2026-06-09T12:05:00.000Z',
      disappearedAt: '2026-06-09T18:00:00.000Z',
    });
    const existing: HitsState = { version: 3, hits: [disappeared] };

    const incoming = openingsToHitRecords([opening], NOW);
    const incomingKeys = new Set(incoming.map(hitKey));
    const checked = savedSearchCheckedKeys(existing, 'ss-abc', incomingKeys);
    const { merged, toNotify } = reconcileHits(existing, incoming, checked, NOW, TODAY);
    expect(merged.hits[0]!.disappearedAt).toBeUndefined();
    expect(toNotify.map(hitKey)).toEqual(incoming.map(hitKey));
  });

  it('past-arrival openings are pruned', () => {
    const pastRecord = makeExistingRecord({
      arrivalDate: '2026-06-01',
      departureDate: '2026-06-03',
      notifiedAt: NOW,
    });
    const existing: HitsState = { version: 3, hits: [pastRecord] };
    const { merged } = reconcileHits(existing, [], new Set(), NOW, TODAY);
    expect(merged.hits).toHaveLength(0);
  });

  it('unchecked hit from a different saved-search is untouched', () => {
    const otherRecord = makeExistingRecord({
      savedSearchId: 'ss-other',
      notifiedAt: NOW,
    });
    const existing: HitsState = { version: 3, hits: [otherRecord] };
    // Only ss-abc is being re-evaluated; checkedKeys only covers ss-abc
    const checked = savedSearchCheckedKeys(existing, 'ss-abc', new Set());
    const { merged, toNotify } = reconcileHits(existing, [], checked, NOW, TODAY);
    expect(merged.hits[0]!.disappearedAt).toBeUndefined();
    expect(toNotify).toHaveLength(0);
  });
});
