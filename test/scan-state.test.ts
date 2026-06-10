import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readLatestScanState,
  writeLatestScan,
  readHitsState,
  writeHitsState,
  hitKey,
  resultsToHitRecords,
  buildScanSummary,
} from '../src/state/scan-state.js';
import type {
  LatestScanSummary,
  AvailabilityHitRecord,
} from '../src/state/scan-state.js';
import type { ScanResultJSON } from '../src/types/scanner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'campbrain-state-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeScanResultJSON(overrides: Partial<ScanResultJSON> = {}): ScanResultJSON {
  return {
    targetId: 'test-target',
    targetName: 'Test Target',
    candidate: { arrivalDate: '2026-08-14', nights: 2, endDate: '2026-08-16' },
    sourceUrl: 'https://example.com',
    debugHtmlPath: '',
    hits: [],
    parsingNotes: 'No match',
    scannedAt: '2026-05-28T12:00:00.000Z',
    ...overrides,
  };
}

function makeHitRecord(overrides: Partial<AvailabilityHitRecord> = {}): AvailabilityHitRecord {
  return {
    targetId: 'test-target',
    targetName: 'Test Target',
    siteName: 'Site A',
    arrivalDate: '2026-08-14',
    departureDate: '2026-08-16',
    nights: 2,
    firstSeenAt: '2026-05-28T12:00:00.000Z',
    lastSeenAt: '2026-05-28T12:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// readLatestScanState / writeLatestScan
// ---------------------------------------------------------------------------

describe('readLatestScanState', () => {
  it('returns empty object when state file does not exist', () => {
    expect(readLatestScanState(dir)).toEqual({});
  });

  it('returns empty object when state file is corrupt JSON', () => {
    writeFileSync(join(dir, 'latest-scan-results.json'), 'not-json', 'utf-8');
    expect(readLatestScanState(dir)).toEqual({});
  });
});

describe('writeLatestScan / readLatestScanState', () => {
  it('writes and reads back a scan summary', () => {
    const summary: LatestScanSummary = {
      targetId: 'angel-island',
      targetName: 'Angel Island Ridge',
      scannedAt: '2026-05-28T12:00:00.000Z',
      candidatesScanned: 9,
      matchCount: 0,
      results: [],
    };

    writeLatestScan(dir, 'angel-island', summary);
    const state = readLatestScanState(dir);

    expect(state['angel-island']).toEqual(summary);
  });

  it('creates the state directory automatically', () => {
    const nested = join(dir, 'deep', 'nested', 'state');
    const summary: LatestScanSummary = {
      targetId: 't1',
      targetName: 'T1',
      scannedAt: '2026-05-28T12:00:00.000Z',
      candidatesScanned: 3,
      matchCount: 0,
      results: [],
    };
    writeLatestScan(nested, 't1', summary);
    expect(readLatestScanState(nested)['t1']).toEqual(summary);
  });

  it('overwrites the same target with the latest summary', () => {
    const first: LatestScanSummary = {
      targetId: 't', targetName: 'T', scannedAt: '2026-05-01T00:00:00.000Z',
      candidatesScanned: 3, matchCount: 0, results: [],
    };
    const second: LatestScanSummary = {
      targetId: 't', targetName: 'T', scannedAt: '2026-05-28T00:00:00.000Z',
      candidatesScanned: 9, matchCount: 1, results: [],
    };

    writeLatestScan(dir, 't', first);
    writeLatestScan(dir, 't', second);
    const state = readLatestScanState(dir);

    expect(state['t']?.scannedAt).toBe('2026-05-28T00:00:00.000Z');
    expect(state['t']?.matchCount).toBe(1);
  });

  it('preserves other targets when writing a new one', () => {
    writeLatestScan(dir, 'a', { targetId: 'a', targetName: 'A', scannedAt: '', candidatesScanned: 1, matchCount: 0, results: [] });
    writeLatestScan(dir, 'b', { targetId: 'b', targetName: 'B', scannedAt: '', candidatesScanned: 2, matchCount: 0, results: [] });

    const state = readLatestScanState(dir);
    expect(Object.keys(state)).toHaveLength(2);
    expect(state['a']).toBeDefined();
    expect(state['b']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// readHitsState / writeHitsState
// ---------------------------------------------------------------------------

describe('readHitsState', () => {
  it('returns empty hits array when state file does not exist', () => {
    expect(readHitsState(dir)).toEqual({ version: 2, hits: [] });
  });
});

describe('writeHitsState / readHitsState', () => {
  it('writes and reads back hits', () => {
    const hit = makeHitRecord();
    writeHitsState(dir, { hits: [hit] });
    const state = readHitsState(dir);
    expect(state.hits).toHaveLength(1);
    expect(state.hits[0]).toEqual(hit);
  });
});

// ---------------------------------------------------------------------------
// hitKey — dedup key
// ---------------------------------------------------------------------------

describe('hitKey', () => {
  it('produces a stable key from targetId + siteName + arrivalDate + departureDate', () => {
    const h = makeHitRecord();
    expect(hitKey(h)).toBe('test-target|Site A|2026-08-14|2026-08-16');
  });

  it('differs when any field changes', () => {
    const a = makeHitRecord({ siteName: 'Site A' });
    const b = makeHitRecord({ siteName: 'Site B' });
    expect(hitKey(a)).not.toBe(hitKey(b));
  });
});

// ---------------------------------------------------------------------------
// resultsToHitRecords
// ---------------------------------------------------------------------------

describe('resultsToHitRecords', () => {
  it('returns empty array when results have no hits', () => {
    const result = makeScanResultJSON({ hits: [] });
    expect(resultsToHitRecords([result])).toHaveLength(0);
  });

  it('produces one record per hit per result', () => {
    const result = makeScanResultJSON({
      hits: [
        { siteName: 'Site A', status: 'Available', confidence: 'high' },
        { siteName: 'Site B', status: 'Available', confidence: 'high' },
      ],
    });
    const records = resultsToHitRecords([result], '2026-05-28T12:00:00.000Z');
    expect(records).toHaveLength(2);
    expect(records[0]?.siteName).toBe('Site A');
    expect(records[1]?.siteName).toBe('Site B');
  });

  it('maps arrivalDate and departureDate from the candidate', () => {
    const result = makeScanResultJSON({
      candidate: { arrivalDate: '2026-08-14', nights: 2, endDate: '2026-08-16' },
      hits: [{ siteName: 'Site A', status: 'Available', confidence: 'high' }],
    });
    const [record] = resultsToHitRecords([result]);
    expect(record?.arrivalDate).toBe('2026-08-14');
    expect(record?.departureDate).toBe('2026-08-16');
    expect(record?.nights).toBe(2);
  });

  it('sets firstSeenAt and lastSeenAt to the provided now timestamp', () => {
    const now = '2026-05-28T15:00:00.000Z';
    const result = makeScanResultJSON({
      hits: [{ siteName: 'X', status: 'Available', confidence: 'high' }],
    });
    const [record] = resultsToHitRecords([result], now);
    expect(record?.firstSeenAt).toBe(now);
    expect(record?.lastSeenAt).toBe(now);
  });

  it('copies bookingUrl when present', () => {
    const result = makeScanResultJSON({
      bookingUrl: 'https://reservecalifornia.com/park/1/2',
      hits: [{ siteName: 'X', status: 'Available', confidence: 'high' }],
    });
    const [record] = resultsToHitRecords([result]);
    expect(record?.bookingUrl).toBe('https://reservecalifornia.com/park/1/2');
  });
});

// ---------------------------------------------------------------------------
// buildScanSummary
// ---------------------------------------------------------------------------

describe('buildScanSummary', () => {
  it('counts candidates and matches correctly', () => {
    const withMatch = makeScanResultJSON({
      hits: [{ siteName: 'X', status: 'Available', confidence: 'high' }],
    });
    const noMatch = makeScanResultJSON({ hits: [] });

    const summary = buildScanSummary('t', 'T', [withMatch, noMatch, noMatch]);
    expect(summary.candidatesScanned).toBe(3);
    expect(summary.matchCount).toBe(1);
  });

  it('uses the scannedAt from the first result', () => {
    const r = makeScanResultJSON({ scannedAt: '2026-05-28T10:00:00.000Z' });
    const summary = buildScanSummary('t', 'T', [r]);
    expect(summary.scannedAt).toBe('2026-05-28T10:00:00.000Z');
  });
});
