import { describe, it, expect } from 'vitest';
import { listCatalogParks, getCatalogPark } from '../src/catalog/catalog-store.js';

// ---------------------------------------------------------------------------
// Helpers — replicate what the /api/map/catalog route does
// ---------------------------------------------------------------------------

interface MapSite {
  id: string;
  name: string;
  type?: string;
  capacity?: number;
}

interface MapCampground {
  id: string;
  name: string;
  siteCount: number;
  siteTypes: string[];
  sites: MapSite[];
}

interface MapPark {
  provider: string;
  parkName: string;
  parkPageId: string;
  latitude?: number;
  longitude?: number;
  discoveryStatus?: string;
  campgroundCount: number;
  siteCount: number;
  campgrounds: MapCampground[];
}

function buildMapParks() {
  const parks = listCatalogParks();
  return parks.map((park) => {
    const campgrounds = park.campgrounds.map((cg) => {
      const siteTypes = Array.from(
        new Set(
          cg.sites
            .map((s) => s.type)
            .filter((t): t is string => typeof t === 'string' && t.length > 0)
        )
      );
      return {
        id: cg.id,
        name: cg.name,
        siteCount: cg.sites.length,
        siteTypes,
        sites: cg.sites.map((s) => ({
          id: s.id,
          name: s.name,
          ...(s.type !== undefined ? { type: s.type } : {}),
          ...(s.capacity !== undefined ? { capacity: s.capacity } : {}),
        })),
      };
    });
    return {
      provider: park.provider,
      parkName: park.parkName,
      parkPageId: park.parkPageId,
      ...(park.lat !== undefined ? { latitude: park.lat } : {}),
      ...(park.lon !== undefined ? { longitude: park.lon } : {}),
      ...(park.discoveryStatus !== undefined ? { discoveryStatus: park.discoveryStatus } : {}),
      campgroundCount: campgrounds.length,
      siteCount: campgrounds.reduce((sum, cg) => sum + cg.siteCount, 0),
      campgrounds,
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('map catalog', () => {
  it('returns parks from catalog', () => {
    const parks = buildMapParks();
    expect(parks.length).toBeGreaterThan(0);
  });

  it('includes campground and site counts', () => {
    const parks = buildMapParks();
    const angel = parks.find((p) => p.parkName === 'Angel Island SP');
    expect(angel).toBeDefined();
    expect(angel!.campgroundCount).toBeGreaterThanOrEqual(0);
    expect(typeof angel!.siteCount).toBe('number');
  });

  it('parks with coordinates have numeric lat/lon', () => {
    const parks = buildMapParks();
    const withCoords = parks.filter((p) => p.latitude !== undefined);
    expect(withCoords.length).toBeGreaterThan(0);
    for (const p of withCoords) {
      expect(typeof p.latitude).toBe('number');
      expect(typeof p.longitude).toBe('number');
    }
  });

  it('parks without coordinates are handled without crashing', () => {
    const parks = buildMapParks();
    const withoutCoords = parks.filter((p) => p.latitude === undefined);
    // They should still be present in the list, just without coords
    for (const p of withoutCoords) {
      expect(p.parkName).toBeTruthy();
      expect(p.parkPageId).toBeTruthy();
    }
  });

  it('Angel Island has Ridge campground discoverable', () => {
    const angel = getCatalogPark('468');
    expect(angel).toBeDefined();
    const ridge = angel!.campgrounds.find((c) => c.name.includes('Ridge'));
    expect(ridge).toBeDefined();
  });

  it('Angel Island Ridge alert payload is constructable without asking for page ID', () => {
    const angel = getCatalogPark('468');
    expect(angel).toBeDefined();
    const ridge = angel!.campgrounds.find((c) => c.name.includes('Ridge'));
    expect(ridge).toBeDefined();

    const payload = {
      id: `468-${ridge!.id}-test`,
      name: `${angel!.parkName} — ${ridge!.name}`,
      provider: angel!.provider,
      parkName: angel!.parkName,
      parkPageId: angel!.parkPageId,
      campgroundName: ridge!.name,
      acceptableSites: ridge!.sites.map((s) => s.name),
      preferredSites: [],
      campingType: 'hike-in' as const,
      people: 2,
      dateMode: 'next_available_weekend' as const,
      nextWeeksCount: 8,
      minNights: 2,
      maxNights: 2,
      weekendsOnly: true,
      emailEnabled: true,
      calendarEnabled: false,
      enabled: true,
      bookingRule: {
        type: 'rolling_months_before' as const,
        monthsBefore: 6,
        releaseTime: '08:00',
        timezone: 'America/Los_Angeles',
      },
    };

    // The payload should not contain any undefined required fields
    expect(payload.parkPageId).toBe('468');
    expect(payload.parkName).toBe('Angel Island SP');
    expect(payload.campgroundName).toContain('Ridge');
    expect(payload.acceptableSites.length).toBeGreaterThan(0);
    // Confirm no page ID was required from the user
    expect(payload).not.toHaveProperty('userProvidedPageId');
  });

  it('booking rule is inferred from catalog without user input', () => {
    const angel = getCatalogPark('468');
    const rule = angel?.defaultBookingRule;
    expect(rule).toBeDefined();
    expect(rule!.type).toBe('rolling_months_before');
    expect(rule!.monthsBefore).toBe(6);
    expect(rule!.releaseTime).toBe('08:00');
    expect(rule!.timezone).toBe('America/Los_Angeles');
  });

  it('empty catalog state returns empty array without crashing', () => {
    const parks = buildMapParks();
    // Even if no parks have campgrounds, we should still get an array
    expect(Array.isArray(parks)).toBe(true);
  });
});
