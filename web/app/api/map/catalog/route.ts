import { NextResponse } from 'next/server';
import { listParksWeb } from '../../../../lib/catalog';

export type MapSite = {
  id: string;
  name: string;
  type?: string;
  capacity?: number;
};

export type MapCampground = {
  id: string;
  name: string;
  latitude?: number;
  longitude?: number;
  siteCount: number;
  siteTypes: string[];
  bookingUrl?: string;
  lastDiscoveredAt?: string;
  sites: MapSite[];
};

export type MapPark = {
  provider: string;
  parkName: string;
  parkPageId: string;
  // All facility page IDs for this park. CA parks: [parkPageId].
  // Rec-gov parent-grouped parks: one entry per facility under the parent.
  // Keeping this separate preserves Option A (one pin per facility) as a future toggle.
  facilityPageIds: string[];
  // Managing agency — "National Park Service", "USDA Forest Service", "Bureau of Land Management", etc.
  // Undefined for CA State Parks (provider alone identifies them).
  orgName?: string;
  latitude?: number;
  longitude?: number;
  discoveryStatus?: string;
  lastUpdatedAt?: string;
  campgroundCount: number;
  siteCount: number;
  campgrounds: MapCampground[];
};

export type MapCatalogResponse = {
  parks: MapPark[];
};

export async function GET(): Promise<NextResponse<MapCatalogResponse | { error: string }>> {
  try {
    const parks = listParksWeb();

    const mapParks: MapPark[] = parks.map((park) => {
      const campgrounds: MapCampground[] = park.campgrounds.map((cg) => {
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
          bookingUrl: cg.bookingUrl,
          lastDiscoveredAt: cg.lastDiscoveredAt,
          sites: cg.sites.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            capacity: s.capacity,
          })),
        };
      });

      const siteCount = campgrounds.reduce((sum, cg) => sum + cg.siteCount, 0);

      return {
        provider: park.provider,
        parkName: park.parkName,
        parkPageId: park.parkPageId,
        latitude: park.lat,
        longitude: park.lon,
        discoveryStatus: park.discoveryStatus,
        lastUpdatedAt: park.lastUpdatedAt,
        campgroundCount: campgrounds.length,
        siteCount,
        campgrounds,
      };
    });

    return NextResponse.json({ parks: mapParks });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
