import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  reconcileHits,
  readHitsState,
  writeHitsState,
  hitKey,
} from '../src/state/scan-state.js';
import type { AvailabilityHitRecord, HitsState } from '../src/state/scan-state.js';

const NOW = '2026-06-10T12:00:00.000Z';
const TODAY = '2026-06-10';

function makeHit(overrides: Partial<AvailabilityHitRecord> = {}): AvailabilityHitRecord {
  return {
    targetId: 't1',
    targetName: 'Angel Island Ridge',
    siteName: 'Campsite #4',
    arrivalDate: '2026-07-10',
    departureDate: '2026-07-12',
    nights: 2,
    firstSeenAt: '2026-06-09T10:00:00.000Z',
    lastSeenAt: '2026-06-09T10:00:00.000Z',
    ...overrides,
  };
}

describe('reconcileHits', () => {
  it('adds brand-new hits and marks them for notification', () => {
    const incoming = makeHit({ firstSeenAt: NOW, lastSeenAt: NOW });
    const { merged, toNotify } = reconcileHits({ hits: [] }, [incoming], new Set([hitKey(incoming)]), NOW, TODAY);
    expect(merged.hits).toHaveLength(1);
    expect(toNotify.map(hitKey)).toEqual([hitKey(incoming)]);
  });

  it('updates lastSeenAt without re-notifying already-notified hits', () => {
    const existing = makeHit({ notifiedAt: '2026-06-09T10:05:00.000Z' });
    const incoming = makeHit({ firstSeenAt: NOW, lastSeenAt: NOW });
    const { merged, toNotify } = reconcileHits(
      { hits: [existing] }, [incoming], new Set([hitKey(incoming)]), NOW, TODAY,
    );
    expect(merged.hits[0]!.lastSeenAt).toBe(NOW);
    expect(merged.hits[0]!.firstSeenAt).toBe(existing.firstSeenAt);
    expect(toNotify).toEqual([]);
  });

  it('stamps disappearedAt when a checked hit is absent, without notifying', () => {
    const existing = makeHit({ notifiedAt: '2026-06-09T10:05:00.000Z' });
    const { merged, toNotify } = reconcileHits(
      { hits: [existing] }, [], new Set([hitKey(existing)]), NOW, TODAY,
    );
    expect(merged.hits[0]!.disappearedAt).toBe(NOW);
    expect(toNotify).toEqual([]);
  });

  it('re-notifies when a disappeared hit reappears and clears disappearedAt', () => {
    const existing = makeHit({ notifiedAt: '2026-06-09T10:05:00.000Z', disappearedAt: '2026-06-09T14:00:00.000Z' });
    const incoming = makeHit({ firstSeenAt: NOW, lastSeenAt: NOW });
    const { merged, toNotify } = reconcileHits(
      { hits: [existing] }, [incoming], new Set([hitKey(incoming)]), NOW, TODAY,
    );
    expect(merged.hits[0]!.disappearedAt).toBeUndefined();
    expect(toNotify.map(hitKey)).toEqual([hitKey(incoming)]);
  });

  it('retries hits that were never successfully notified', () => {
    const existing = makeHit(); // no notifiedAt — prior send failed
    const incoming = makeHit({ firstSeenAt: NOW, lastSeenAt: NOW });
    const { toNotify } = reconcileHits(
      { hits: [existing] }, [incoming], new Set([hitKey(incoming)]), NOW, TODAY,
    );
    expect(toNotify.map(hitKey)).toEqual([hitKey(existing)]);
  });

  it('prunes hits whose arrival date is in the past', () => {
    const past = makeHit({ arrivalDate: '2026-06-01', departureDate: '2026-06-03', notifiedAt: 'x' });
    const { merged } = reconcileHits({ hits: [past] }, [], new Set(), NOW, TODAY);
    expect(merged.hits).toEqual([]);
  });

  it('leaves unchecked hits untouched when their park was not scanned', () => {
    const existing = makeHit({ notifiedAt: '2026-06-09T10:05:00.000Z' });
    const { merged, toNotify } = reconcileHits({ hits: [existing] }, [], new Set(), NOW, TODAY);
    expect(merged.hits[0]!.disappearedAt).toBeUndefined();
    expect(toNotify).toEqual([]);
  });
});

describe('hits state migration', () => {
  let dir: string;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('v1→v3: backfills notifiedAt on legacy files and upgrades version', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campbrain-hits-'));
    const legacy = { hits: [makeHit()] }; // no version, no notifiedAt
    fs.writeFileSync(path.join(dir, 'availability-hits.json'), JSON.stringify(legacy), 'utf-8');
    const state = readHitsState(dir);
    expect(state.version).toBe(3);
    expect(state.hits[0]!.notifiedAt).toBe(state.hits[0]!.lastSeenAt);
  });

  it('v2→v3: records load unchanged, notifiedAt is NOT injected', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campbrain-hits-'));
    const v2: HitsState = { version: 2, hits: [makeHit()] }; // intentionally no notifiedAt
    writeHitsState(dir, v2);
    const state = readHitsState(dir);
    expect(state.version).toBe(3);
    expect(state.hits[0]!.notifiedAt).toBeUndefined();
  });
});
