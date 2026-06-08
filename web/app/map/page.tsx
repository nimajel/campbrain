import { listParksWeb } from '../../lib/catalog';
import { listParksFromDb } from '../../../src/cache/availability-cache';
import MapClient from './MapClient';
import type { MapPark } from '../api/map/catalog/route';

export const dynamic = 'force-dynamic';

export default async function MapPage() {
  const [catalogParks, dbParks] = await Promise.all([
    Promise.resolve(listParksWeb()),
    listParksFromDb(),
  ]);

  // Catalog is the only source of lat/lon and parent info
  const catalogByPageId = new Map(catalogParks.map((p) => [p.parkPageId, p]));

  // -------------------------------------------------------------------------
  // CA parks — one DB entry per park, no grouping needed
  // -------------------------------------------------------------------------
  const caMapParks: MapPark[] = dbParks
    .filter((p) => p.providerId === 'california-parks')
    .map((dbPark) => {
      const catalog = catalogByPageId.get(dbPark.parkPageId);
      return {
        provider: dbPark.providerId,
        parkName: dbPark.parkName,
        parkPageId: dbPark.parkPageId,
        facilityPageIds: [dbPark.parkPageId],
        latitude: catalog?.lat,
        longitude: catalog?.lon,
        // Derive status from the DB data the map actually renders, not the catalog
        // flag (which is permanently "not_started" for rec.gov — campgrounds are
        // populated by the scanner, never by catalog discovery).
        discoveryStatus: dbPark.campgrounds.length > 0 ? 'success' : catalog?.discoveryStatus,
        lastUpdatedAt: catalog?.lastUpdatedAt,
        campgroundCount: dbPark.campgrounds.length,
        siteCount: dbPark.campgrounds.reduce((s, cg) => s + cg.siteCount, 0),
        campgrounds: dbPark.campgrounds.map((cg) => ({
          id: cg.name,
          name: cg.name,
          siteCount: cg.siteCount,
          siteTypes: [],
          sites: [],
        })),
      };
    });

  // -------------------------------------------------------------------------
  // Rec.gov parks — group facilities by parentId (Option B).
  // Facilities without a parentId become their own single-campground park.
  // -------------------------------------------------------------------------
  type FacilityGroup = {
    parkPageId: string;    // parentId, or facilityId when no parent
    parkName: string;      // parentName, or facilityName when no parent
    facilityPageIds: string[];
    campgrounds: { name: string; siteCount: number }[];
    lats: number[];
    lons: number[];
    discoveryStatus: string | undefined;
    lastUpdatedAt: string | undefined;
    orgName: string | undefined;
  };

  const recGovGroups = new Map<string, FacilityGroup>();

  for (const dbPark of dbParks.filter((p) => p.providerId === 'recreation-gov')) {
    const catalog = catalogByPageId.get(dbPark.parkPageId);
    // Prefix with provider so rec-gov parent IDs never collide with CA park page IDs
    // (both can be small integers).
    const rawGroupKey = catalog?.parentId ?? dbPark.parkPageId;
    const groupKey = `recgov-${rawGroupKey}`;
    const groupName = catalog?.parentName ?? dbPark.parkName;

    if (!recGovGroups.has(groupKey)) {
      recGovGroups.set(groupKey, {
        parkPageId: groupKey,  // prefixed: e.g. "recgov-1234"
        parkName: groupName,
        facilityPageIds: [],
        campgrounds: [],
        lats: [],
        lons: [],
        discoveryStatus: catalog?.discoveryStatus,
        lastUpdatedAt: catalog?.lastUpdatedAt,
        orgName: catalog?.orgName,
      });
    }
    const group = recGovGroups.get(groupKey)!;
    group.facilityPageIds.push(dbPark.parkPageId);
    group.campgrounds.push(...dbPark.campgrounds.map((cg) => ({
      name: cg.name,
      siteCount: cg.siteCount,
    })));
    if (catalog?.lat) group.lats.push(catalog.lat);
    if (catalog?.lon) group.lons.push(catalog.lon);
  }

  const recGovMapParks: MapPark[] = Array.from(recGovGroups.values()).map((group) => {
    const lat = group.lats.length > 0
      ? group.lats.reduce((s, v) => s + v, 0) / group.lats.length
      : undefined;
    const lon = group.lons.length > 0
      ? group.lons.reduce((s, v) => s + v, 0) / group.lons.length
      : undefined;

    return {
      provider: 'recreation-gov',
      parkName: group.parkName,
      parkPageId: group.parkPageId,
      facilityPageIds: group.facilityPageIds,
      orgName: group.orgName,
      latitude: lat,
      longitude: lon,
      // See note in caMapParks: the catalog flag is always "not_started" for
      // rec.gov, so derive status from the campground data actually loaded.
      discoveryStatus: group.campgrounds.length > 0 ? 'success' : group.discoveryStatus,
      lastUpdatedAt: group.lastUpdatedAt,
      campgroundCount: group.campgrounds.length,
      siteCount: group.campgrounds.reduce((s, cg) => s + cg.siteCount, 0),
      campgrounds: group.campgrounds.map((cg) => ({
        id: cg.name,
        name: cg.name,
        siteCount: cg.siteCount,
        siteTypes: [],
        sites: [],
      })),
    };
  });

  return <MapClient initialParks={[...caMapParks, ...recGovMapParks]} />;
}
