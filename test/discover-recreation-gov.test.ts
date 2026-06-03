import { describe, it, expect } from 'vitest';
import { buildRidbFacilitiesUrl, parseRidbFacilities } from '../src/catalog/discover-recreation-gov.js';

describe('buildRidbFacilitiesUrl', () => {
  it('includes the API key and state=CA filter', () => {
    const url = buildRidbFacilitiesUrl('TESTKEY', 0);
    expect(url).toContain('apikey=TESTKEY');
    expect(url).toContain('state=CA');
  });

  it('includes activity=9 (Camping)', () => {
    const url = buildRidbFacilitiesUrl('TESTKEY', 0);
    expect(url).toContain('activity=9');
  });

  it('sets the correct offset', () => {
    const url = buildRidbFacilitiesUrl('TESTKEY', 50);
    expect(url).toContain('offset=50');
  });
});

describe('parseRidbFacilities', () => {
  it('maps RIDB facility to ParkCatalogEntry shape', () => {
    const rawFacilities = [
      {
        FacilityID: '232447',
        FacilityName: 'UPPER PINES',
        FacilityLatitude: 37.7393,
        FacilityLongitude: -119.5593,
        FacilityTypeDescription: 'Campground',
      },
    ];

    const entries = parseRidbFacilities(rawFacilities);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.parkPageId).toBe('232447');
    expect(entries[0]!.parkName).toBe('Upper Pines');
    expect(entries[0]!.provider).toBe('recreation-gov');
    expect(entries[0]!.lat).toBeCloseTo(37.7393);
    expect(entries[0]!.lon).toBeCloseTo(-119.5593);
  });

  it('title-cases ALL_CAPS facility names', () => {
    const rawFacilities = [
      { FacilityID: '1', FacilityName: 'LOWER PINES', FacilityLatitude: 0, FacilityLongitude: 0 },
    ];
    const entries = parseRidbFacilities(rawFacilities);
    expect(entries[0]!.parkName).toBe('Lower Pines');
  });

  it('omits lat/lon when coordinates are zero', () => {
    const rawFacilities = [
      { FacilityID: '999', FacilityName: 'NO COORDS', FacilityLatitude: 0, FacilityLongitude: 0 },
    ];
    const entries = parseRidbFacilities(rawFacilities);
    expect(entries[0]!.lat).toBeUndefined();
    expect(entries[0]!.lon).toBeUndefined();
  });

  it('sets provider to recreation-gov', () => {
    const entries = parseRidbFacilities([
      { FacilityID: '1', FacilityName: 'TEST', FacilityLatitude: 37, FacilityLongitude: -120 },
    ]);
    expect(entries[0]!.provider).toBe('recreation-gov');
  });
});
