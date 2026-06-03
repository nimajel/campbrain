import { describe, it, expect } from 'vitest';
import { buildSearchUrl, parseSearchResults } from '../src/catalog/discover-recreation-gov.js';
import type { RecGovSearchResult } from '../src/catalog/discover-recreation-gov.js';

describe('buildSearchUrl', () => {
  it('targets the recreation.gov search API', () => {
    const url = buildSearchUrl(0);
    expect(url).toContain('recreation.gov/api/search');
  });

  it('requests campground entity type', () => {
    const url = buildSearchUrl(0);
    expect(url).toContain('entity_type=campground');
  });

  it('sets the correct start offset', () => {
    const url = buildSearchUrl(50);
    expect(url).toContain('start=50');
  });

  it('does not include any API key', () => {
    const url = buildSearchUrl(0);
    expect(url).not.toContain('apikey');
  });
});

describe('parseSearchResults', () => {
  const ca: RecGovSearchResult = {
    entity_id: '232447',
    name: 'UPPER PINES',
    state_code: 'California',
    latitude: 37.7393,
    longitude: -119.5593,
  };

  const other: RecGovSearchResult = {
    entity_id: '999',
    name: 'SOME PARK',
    state_code: 'Oregon',
    latitude: 45,
    longitude: -122,
  };

  it('keeps only California campgrounds', () => {
    const entries = parseSearchResults([ca, other]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.parkPageId).toBe('232447');
  });

  it('title-cases ALL_CAPS names', () => {
    const entries = parseSearchResults([ca]);
    expect(entries[0]!.parkName).toBe('Upper Pines');
  });

  it('sets provider to recreation-gov', () => {
    const entries = parseSearchResults([ca]);
    expect(entries[0]!.provider).toBe('recreation-gov');
  });

  it('sets lat/lon when present', () => {
    const entries = parseSearchResults([ca]);
    expect(entries[0]!.lat).toBeCloseTo(37.7393);
    expect(entries[0]!.lon).toBeCloseTo(-119.5593);
  });

  it('omits lat/lon when zero', () => {
    const noCoords: RecGovSearchResult = { entity_id: '1', name: 'NO COORDS', state_code: 'California', latitude: 0, longitude: 0 };
    const entries = parseSearchResults([noCoords]);
    expect(entries[0]!.lat).toBeUndefined();
    expect(entries[0]!.lon).toBeUndefined();
  });

  it('excludes entries without entity_id', () => {
    const noId: RecGovSearchResult = { entity_id: '', name: 'MISSING ID', state_code: 'California' };
    expect(parseSearchResults([noId])).toHaveLength(0);
  });
});
