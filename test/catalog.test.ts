import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  listCatalogParks,
  getCatalogPark,
  getCatalogParkByName,
  upsertCatalogPark,
  writeCatalog,
} from '../src/catalog/catalog-store.js';

import {
  parseCampgroundsFromHtml,
  discoverFromHtml,
  CALIFORNIA_PARKS_DEFAULT_RULE,
} from '../src/catalog/discover-california-parks.js';

import { catalogRuleToAlertRule } from '../src/catalog/types.js';

// ---------------------------------------------------------------------------
// Shared fixture HTML (read once)
// ---------------------------------------------------------------------------

const FIXTURE_HTML = readFileSync(
  join(import.meta.dirname, 'fixtures', 'angel-island-ridge-2026-08-14-2n.html'),
  'utf-8'
);

// ---------------------------------------------------------------------------
// 1. Seed catalog loads
// ---------------------------------------------------------------------------

describe('catalog seed — Angel Island', () => {
  it('seed file contains Angel Island SP', () => {
    const parks = listCatalogParks();
    const angel = parks.find((p) => p.parkName === 'Angel Island SP');
    expect(angel).toBeDefined();
  });

  it('Angel Island has parkPageId 468', () => {
    const angel = getCatalogPark('468');
    expect(angel?.parkPageId).toBe('468');
  });

  it('Angel Island has Ridge campground', () => {
    const angel = getCatalogPark('468');
    const ridge = angel?.campgrounds.find((c) => c.name === 'Ridge (sites 4-6)');
    expect(ridge).toBeDefined();
  });

  it('Ridge campground has sites #4, #5, #6', () => {
    const angel = getCatalogPark('468');
    const ridge = angel?.campgrounds.find((c) => c.name === 'Ridge (sites 4-6)');
    const siteNames = ridge?.sites.map((s) => s.name) ?? [];
    expect(siteNames).toContain('Hike in Campsite #4');
    expect(siteNames).toContain('Hike in Campsite #5');
    expect(siteNames).toContain('Hike in Campsite #6');
  });

  it('Angel Island has a defaultBookingRule with 6 months', () => {
    const angel = getCatalogPark('468');
    expect(angel?.defaultBookingRule.monthsBefore).toBe(6);
    expect(angel?.defaultBookingRule.releaseTime).toBe('08:00');
    expect(angel?.defaultBookingRule.timezone).toBe('America/Los_Angeles');
  });

  it('getCatalogParkByName finds Angel Island SP', () => {
    const angel = getCatalogParkByName('Angel Island SP');
    expect(angel?.parkPageId).toBe('468');
  });
});

// ---------------------------------------------------------------------------
// 2. California Parks HTML discovery
// ---------------------------------------------------------------------------

describe('parseCampgroundsFromHtml', () => {
  it('extracts all section headings', () => {
    const campgrounds = parseCampgroundsFromHtml(FIXTURE_HTML);
    const names = campgrounds.map((c) => c.name);
    expect(names).toContain('Ridge (sites 4-6)');
    expect(names).toContain('East Bay (sites 1-3)');
    expect(names).toContain('Sunrise (sites 7-9)');
    expect(names).toContain('North Garrison Group Camp');
  });

  it('extracts Ridge sites #4, #5, #6', () => {
    const campgrounds = parseCampgroundsFromHtml(FIXTURE_HTML);
    const ridge = campgrounds.find((c) => c.name === 'Ridge (sites 4-6)');
    expect(ridge).toBeDefined();
    expect(ridge?.sites).toContain('Hike in Campsite #4');
    expect(ridge?.sites).toContain('Hike in Campsite #5');
    expect(ridge?.sites).toContain('Hike in Campsite #6');
  });

  it('extracts East Bay sites', () => {
    const campgrounds = parseCampgroundsFromHtml(FIXTURE_HTML);
    const east = campgrounds.find((c) => c.name === 'East Bay (sites 1-3)');
    expect(east?.sites).toContain('Hike in Campsite #1');
    expect(east?.sites).toContain('Hike in Campsite #2');
    expect(east?.sites).toContain('Hike in Campsite #3');
  });

  it('returns empty array for blank HTML', () => {
    expect(parseCampgroundsFromHtml('<html></html>')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. discoverFromHtml saves to catalog
// ---------------------------------------------------------------------------

describe('discoverFromHtml', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'campbrain-catalog-test-'));
    mkdirSync(join(tmpDir, 'catalog'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves discovered campgrounds to catalog file', () => {
    discoverFromHtml(FIXTURE_HTML, {
      parkPageId: '468',
      parkName: 'Angel Island SP',
      sampleDate: '2026-08-14',
      nights: 2,
      dataDir: tmpDir,
    });

    const parks = listCatalogParks(tmpDir);
    expect(parks.length).toBe(1);
    expect(parks[0]?.parkPageId).toBe('468');
  });

  it('result contains discovered campground names', () => {
    const result = discoverFromHtml(FIXTURE_HTML, {
      parkPageId: '468',
      parkName: 'Angel Island SP',
      sampleDate: '2026-08-14',
      nights: 2,
      dataDir: tmpDir,
    });

    const names = result.campgrounds.map((c) => c.name);
    expect(names).toContain('Ridge (sites 4-6)');
  });

  it('result contains Ridge sites', () => {
    const result = discoverFromHtml(FIXTURE_HTML, {
      parkPageId: '468',
      parkName: 'Angel Island SP',
      sampleDate: '2026-08-14',
      nights: 2,
      dataDir: tmpDir,
    });

    const ridge = result.campgrounds.find((c) => c.name === 'Ridge (sites 4-6)');
    expect(ridge?.sites).toContain('Hike in Campsite #4');
  });

  it('upserts on second call instead of duplicating', () => {
    const opts = {
      parkPageId: '468',
      parkName: 'Angel Island SP',
      sampleDate: '2026-08-14',
      nights: 2,
      dataDir: tmpDir,
    };
    discoverFromHtml(FIXTURE_HTML, opts);
    discoverFromHtml(FIXTURE_HTML, opts);

    const parks = listCatalogParks(tmpDir);
    expect(parks.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Alert creation infers parkPageId and bookingRule from catalog
// ---------------------------------------------------------------------------

describe('catalog-based alert inference', () => {
  it('getCatalogParkByName returns parkPageId for Angel Island SP', () => {
    const park = getCatalogParkByName('Angel Island SP');
    expect(park?.parkPageId).toBe('468');
  });

  it('catalogRuleToAlertRule strips source/confidence', () => {
    const catalogRule = CALIFORNIA_PARKS_DEFAULT_RULE;
    const alertRule = catalogRuleToAlertRule(catalogRule);
    expect(alertRule.type).toBe('rolling_months_before');
    expect(alertRule.monthsBefore).toBe(6);
    expect(alertRule.releaseTime).toBe('08:00');
    expect(alertRule.timezone).toBe('America/Los_Angeles');
    expect('source' in alertRule).toBe(false);
    expect('confidence' in alertRule).toBe(false);
  });

  it('inferred bookingRule matches existing alert bookingRule', () => {
    const park = getCatalogPark('468');
    const rule = catalogRuleToAlertRule(park!.defaultBookingRule);
    // This should match the existing seed alert in data/targets.json
    expect(rule.monthsBefore).toBe(6);
    expect(rule.releaseTime).toBe('08:00');
    expect(rule.timezone).toBe('America/Los_Angeles');
  });
});

// ---------------------------------------------------------------------------
// 5. Alert creation rejects unknown park name
// ---------------------------------------------------------------------------

describe('catalog rejection for unknown parks', () => {
  it('getCatalogParkByName returns undefined for unknown park', () => {
    expect(getCatalogParkByName('Nonexistent Park XYZ')).toBeUndefined();
  });

  it('getCatalogPark returns undefined for unknown page id', () => {
    expect(getCatalogPark('99999')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Catalog store upsert and read
// ---------------------------------------------------------------------------

describe('catalog store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'campbrain-store-test-'));
    mkdirSync(join(tmpDir, 'catalog'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty parks array when file does not exist', () => {
    expect(listCatalogParks(tmpDir)).toEqual([]);
  });

  it('upsertCatalogPark adds new park', () => {
    upsertCatalogPark(
      {
        provider: 'california-parks',
        parkName: 'Test Park',
        parkPageId: '999',
        campgrounds: [],
        defaultBookingRule: CALIFORNIA_PARKS_DEFAULT_RULE,
      },
      tmpDir
    );
    const parks = listCatalogParks(tmpDir);
    expect(parks.length).toBe(1);
    expect(parks[0]?.parkPageId).toBe('999');
  });

  it('upsertCatalogPark replaces existing park with same parkPageId', () => {
    const base = {
      provider: 'california-parks' as const,
      parkPageId: '999',
      campgrounds: [],
      defaultBookingRule: CALIFORNIA_PARKS_DEFAULT_RULE,
    };
    upsertCatalogPark({ ...base, parkName: 'Old Name' }, tmpDir);
    upsertCatalogPark({ ...base, parkName: 'New Name' }, tmpDir);

    const parks = listCatalogParks(tmpDir);
    expect(parks.length).toBe(1);
    expect(parks[0]?.parkName).toBe('New Name');
  });

  it('writeCatalog creates the catalog directory if absent', () => {
    const newDir = join(tmpDir, 'nested', 'data');
    // Don't create the directory — writeCatalog should handle it
    writeCatalog({ provider: 'california-parks', parks: [] }, newDir);
    expect(listCatalogParks(newDir)).toEqual([]);
  });
});
