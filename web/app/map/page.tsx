import { listParksWeb } from '../../lib/catalog';
import MapClient from './MapClient';
import type { MapPark } from '../api/map/catalog/route';

export const dynamic = 'force-dynamic';

export default function MapPage() {
  const parks = listParksWeb();

  const mapParks: MapPark[] = parks.map((park) => ({
    provider: park.provider,
    parkName: park.parkName,
    parkPageId: park.parkPageId,
    latitude: park.lat,
    longitude: park.lon,
    discoveryStatus: park.discoveryStatus,
    lastUpdatedAt: park.lastUpdatedAt,
    campgroundCount: park.campgrounds.length,
    siteCount: park.campgrounds.reduce((sum, cg) => sum + cg.sites.length, 0),
    campgrounds: park.campgrounds.map((cg) => ({
      id: cg.id,
      name: cg.name,
      siteCount: cg.sites.length,
      siteTypes: Array.from(
        new Set(
          cg.sites
            .map((s) => s.type)
            .filter((t): t is string => typeof t === 'string' && t.length > 0)
        )
      ),
      bookingUrl: cg.bookingUrl,
      lastDiscoveredAt: cg.lastDiscoveredAt,
      sites: cg.sites.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        capacity: s.capacity,
      })),
    })),
  }));

  // Only show parks that have at least one discovered campground with sites
  const parksWithSites = mapParks.filter((p) => p.siteCount > 0);

  return <MapClient initialParks={parksWithSites} />;
}
