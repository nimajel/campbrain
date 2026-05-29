import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  isParkStale,
  selectParksToRefresh,
  defaultSampleDate,
  refreshCatalog,
  type DiscoverFn,
} from '../src/catalog/refresh-catalog.js';
import {
  listCatalogParks,
  getCatalogPark,
  writeCatalog,
  upsertCatalogPark,
} from '../src/catalog/catalog-store.js';
import { CALIFORNIA_PARKS_DEFAULT_RULE } from '../src/catalog/discover-california-parks.js';
import type { ParkCatalogEntry, ProviderCatalog } from '../src/catalog/types.js';

const NOW = Date.parse('2026-05-29T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function park(overrides: Partial<ParkCatalogEntry>): ParkCatalogEntry {
  return {
    provider: 'california-parks',
    parkName: 'Test Park',
    parkPageId: '100',
    campgrounds: [],
    defaultBookingRule: CALIFORNIA_PARKS_DEFAULT_RULE,
    ...overrides,
  };
}

const ONE_CG = [{ id: 'cg1', name: 'CG1', sites: [{ id: 's1', name: 'Site 1' }] }];

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

describe('isParkStale', () => {
  it('treats parks with no campgrounds as stale', () => {
    expect(isParkStale(park({ campgrounds: [], lastUpdatedAt: new Date(NOW).toISOString() }), NOW)).toBe(true);
  });

  it('treats parks with no lastUpdatedAt as stale', () => {
    expect(isParkStale(park({ campgrounds: ONE_CG }), NOW)).toBe(true);
  });

  it('treats recently updated parks with data as fresh', () => {
    const p = park({ campgrounds: ONE_CG, lastUpdatedAt: new Date(NOW - 2 * DAY).toISOString() });
    expect(isParkStale(p, NOW, 30)).toBe(false);
  });

  it('treats parks older than maxAgeDays as stale', () => {
    const p = park({ campgrounds: ONE_CG, lastUpdatedAt: new Date(NOW - 40 * DAY).toISOString() });
    expect(isParkStale(p, NOW, 30)).toBe(true);
  });

  it('treats an invalid lastUpdatedAt as stale', () => {
    const p = park({ campgrounds: ONE_CG, lastUpdatedAt: 'not-a-date' });
    expect(isParkStale(p, NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe('selectParksToRefresh', () => {
  const fresh = park({ parkName: 'Fresh', parkPageId: '1', campgrounds: ONE_CG, lastUpdatedAt: new Date(NOW - DAY).toISOString() });
  const missing = park({ parkName: 'Missing', parkPageId: '2', campgrounds: [] });
  const stale = park({ parkName: 'Stale', parkPageId: '3', campgrounds: ONE_CG, lastUpdatedAt: new Date(NOW - 90 * DAY).toISOString() });
  const recgov = park({ parkName: 'RecGov', parkPageId: '4', provider: 'recreation-gov', campgrounds: [] });
  const all = [fresh, missing, stale, recgov];

  it('selects only stale/missing parks by default', () => {
    const sel = selectParksToRefresh(all, { nowMs: NOW });
    const names = sel.map((p) => p.parkName);
    expect(names).toContain('Missing');
    expect(names).toContain('Stale');
    expect(names).toContain('RecGov');
    expect(names).not.toContain('Fresh');
  });

  it('force selects all matching parks regardless of staleness', () => {
    const sel = selectParksToRefresh(all, { nowMs: NOW, force: true });
    expect(sel.length).toBe(4);
  });

  it('filters by provider', () => {
    const sel = selectParksToRefresh(all, { nowMs: NOW, force: true, provider: 'recreation-gov' });
    expect(sel.map((p) => p.parkName)).toEqual(['RecGov']);
  });

  it('filters by park name (case-insensitive)', () => {
    const sel = selectParksToRefresh(all, { nowMs: NOW, force: true, parkName: 'stale' });
    expect(sel.map((p) => p.parkName)).toEqual(['Stale']);
  });

  it('requireVerified excludes parks without a verified page ID', () => {
    const verified = park({ parkName: 'Verified', parkPageId: '5', campgrounds: [], pageIdVerified: true });
    const unverified = park({ parkName: 'Unverified', parkPageId: '6', campgrounds: [] });
    const sel = selectParksToRefresh([verified, unverified], {
      nowMs: NOW,
      force: true,
      requireVerified: true,
    });
    expect(sel.map((p) => p.parkName)).toEqual(['Verified']);
  });
});

describe('defaultSampleDate', () => {
  it('returns a YYYY-MM-DD date in the future', () => {
    const d = defaultSampleDate(NOW, 30);
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Date.parse(d)).toBeGreaterThan(NOW);
  });
});

// ---------------------------------------------------------------------------
// refreshCatalog with injected discover (no network)
// ---------------------------------------------------------------------------

describe('refreshCatalog', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'campbrain-refresh-test-'));
    mkdirSync(join(tmpDir, 'catalog'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function seed(parks: ParkCatalogEntry[]) {
    const catalog: ProviderCatalog = { provider: 'california-parks', parks };
    writeCatalog(catalog, tmpDir);
  }

  // Fake discover that writes one campground into the catalog (simulating success)
  const successDiscover: DiscoverFn = async (opts) => {
    upsertCatalogPark(
      park({
        parkName: opts.parkName,
        parkPageId: opts.parkPageId,
        campgrounds: ONE_CG,
      }),
      opts.dataDir
    );
    return {
      parkPageId: opts.parkPageId,
      parkName: opts.parkName,
      campgrounds: [{ name: 'CG1', bookingUrl: '', sites: ['Site 1'] }],
      sourceUrl: 'http://example.test',
      savedAt: new Date().toISOString(),
    };
  };

  const failDiscover: DiscoverFn = async () => {
    throw new Error('HTTP 500');
  };

  // Fake discover that "succeeds" at the network level but writes no
  // campgrounds (simulating a wrong page ID that returns an empty page).
  const emptyDiscover: DiscoverFn = async (opts) => {
    upsertCatalogPark(
      park({ parkName: opts.parkName, parkPageId: opts.parkPageId, campgrounds: [] }),
      opts.dataDir
    );
    return {
      parkPageId: opts.parkPageId,
      parkName: opts.parkName,
      campgrounds: [],
      sourceUrl: 'http://example.test',
      savedAt: new Date().toISOString(),
    };
  };

  it('marks discovery success and writes freshness metadata', async () => {
    seed([park({ parkName: 'P', parkPageId: '10', campgrounds: [], discoveryStatus: 'not_started', pageIdVerified: true })]);

    const summary = await refreshCatalog({
      dataDir: tmpDir,
      discover: successDiscover,
      delayMs: 0,
      nowMs: NOW,
    });

    expect(summary.attempted).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);

    const p = getCatalogPark('10', tmpDir)!;
    expect(p.discoveryStatus).toBe('success');
    expect(p.lastUpdatedAt).toBe(new Date(NOW).toISOString());
    expect(p.lastDiscoveryAttemptAt).toBe(new Date(NOW).toISOString());
    expect(p.discoveryError).toBeUndefined();
    expect(p.campgrounds.length).toBe(1);
  });

  it('marks discovery failure and records the error', async () => {
    seed([park({ parkName: 'P', parkPageId: '11', campgrounds: [], pageIdVerified: true })]);

    const summary = await refreshCatalog({
      dataDir: tmpDir,
      discover: failDiscover,
      delayMs: 0,
      nowMs: NOW,
    });

    expect(summary.failed).toBe(1);
    const p = getCatalogPark('11', tmpDir)!;
    expect(p.discoveryStatus).toBe('failed');
    expect(p.discoveryError).toBe('HTTP 500');
    expect(p.lastDiscoveryAttemptAt).toBe(new Date(NOW).toISOString());
  });

  it('skips fresh parks unless forced', async () => {
    seed([
      park({ parkName: 'Fresh', parkPageId: '12', campgrounds: ONE_CG, lastUpdatedAt: new Date(NOW - DAY).toISOString() }),
    ]);

    const skip = await refreshCatalog({ dataDir: tmpDir, discover: successDiscover, delayMs: 0, nowMs: NOW });
    expect(skip.attempted).toBe(0);

    const forced = await refreshCatalog({ dataDir: tmpDir, discover: successDiscover, delayMs: 0, nowMs: NOW, force: true });
    expect(forced.attempted).toBe(1);
  });

  it('targets a single park by name', async () => {
    seed([
      park({ parkName: 'Angel Island SP', parkPageId: '468', campgrounds: [] }),
      park({ parkName: 'Other Park', parkPageId: '999', campgrounds: [], discoveryStatus: 'not_started' }),
    ]);

    const summary = await refreshCatalog({
      dataDir: tmpDir,
      discover: successDiscover,
      delayMs: 0,
      nowMs: NOW,
      parkName: 'Angel Island SP',
    });

    expect(summary.attempted).toBe(1);
    expect(summary.results[0]?.parkName).toBe('Angel Island SP');
    expect(getCatalogPark('999', tmpDir)?.discoveryStatus).toBe('not_started');
  });

  it('treats a discover with zero campgrounds as a failure', async () => {
    seed([park({ parkName: 'Empty', parkPageId: '20', campgrounds: [], pageIdVerified: true })]);

    const summary = await refreshCatalog({
      dataDir: tmpDir,
      discover: emptyDiscover,
      delayMs: 0,
      nowMs: NOW,
      force: true,
    });

    expect(summary.failed).toBe(1);
    expect(summary.succeeded).toBe(0);
    const p = getCatalogPark('20', tmpDir)!;
    expect(p.discoveryStatus).toBe('failed');
    expect(p.discoveryError).toMatch(/page ID/i);
    expect(p.lastUpdatedAt).toBeUndefined();
  });

  it('default refresh skips unverified parks (no fabricated page IDs hit)', async () => {
    seed([
      park({ parkName: 'Unverified', parkPageId: '21', campgrounds: [] }),
      park({ parkName: 'Verified', parkPageId: '22', campgrounds: [], pageIdVerified: true }),
    ]);

    const summary = await refreshCatalog({ dataDir: tmpDir, discover: successDiscover, delayMs: 0, nowMs: NOW });

    // Only the verified park is attempted on a default (untargeted) refresh.
    expect(summary.attempted).toBe(1);
    expect(summary.results[0]?.parkName).toBe('Verified');
    expect(getCatalogPark('21', tmpDir)?.discoveryStatus).toBeUndefined();
  });

  it('targeting an unverified park by name still attempts it', async () => {
    seed([park({ parkName: 'Unverified', parkPageId: '23', campgrounds: [] })]);

    const summary = await refreshCatalog({
      dataDir: tmpDir,
      discover: successDiscover,
      delayMs: 0,
      nowMs: NOW,
      parkName: 'Unverified',
    });

    expect(summary.attempted).toBe(1);
    expect(summary.succeeded).toBe(1);
  });

  it('returns an empty summary when nothing needs refreshing', async () => {
    seed([park({ parkName: 'Fresh', parkPageId: '13', campgrounds: ONE_CG, lastUpdatedAt: new Date(NOW).toISOString() })]);
    const summary = await refreshCatalog({ dataDir: tmpDir, discover: successDiscover, delayMs: 0, nowMs: NOW });
    expect(summary.attempted).toBe(0);
    expect(summary.results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Seed catalog: Angel Island remains discoverable end-to-end
// ---------------------------------------------------------------------------

describe('seed catalog freshness', () => {
  it('Angel Island SP is marked success with campground data', () => {
    const angel = listCatalogParks().find((p) => p.parkName === 'Angel Island SP');
    expect(angel?.discoveryStatus).toBe('success');
    expect((angel?.campgrounds.length ?? 0)).toBeGreaterThan(0);
  });

  it('seeded-but-undiscovered parks are marked not_started with no campgrounds', () => {
    const undiscovered = listCatalogParks().filter((p) => p.campgrounds.length === 0);
    expect(undiscovered.length).toBeGreaterThan(0);
    for (const p of undiscovered) {
      expect(p.discoveryStatus).toBe('not_started');
    }
  });
});
