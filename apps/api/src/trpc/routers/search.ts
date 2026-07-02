import { router, publicProcedure } from "../trpc";
import { SearchInputSchema } from "@campbrain/types";
import { searchAvailableStays, findNextAvailableDates, getCatalogParks } from "@campbrain/db";
import { classifyRegion, type CampRegion } from "@campbrain/core";

type SearchPark = {
  parkPageId: string;
  parkName: string;
  provider: string;
  region: CampRegion;
  campgrounds: Awaited<ReturnType<typeof searchAvailableStays>>[number]["campgrounds"];
  totalAvailable: number;
};

function catalogKey(providerId: string, parkPageId: string): string {
  return `${providerId}:${parkPageId}`;
}

export const searchRouter = router({
  // Public, like the map: anyone can search availability.
  query: publicProcedure.input(SearchInputSchema).query(async ({ ctx, input }) => {
    const { from, to, access, kinds, hide, region } = input;

    const catalog = await getCatalogParks(ctx.db);
    const coordsByKey = new Map<string, { lat: number; lon: number }>();
    for (const p of catalog) {
      if (p.latitude != null && p.longitude != null) {
        coordsByKey.set(catalogKey(p.providerId, p.parkPageId), { lat: p.latitude, lon: p.longitude });
      }
    }

    const results = await searchAvailableStays(ctx.db, { from, to, access, kinds, hide });

    const parks: SearchPark[] = results
      .map((park): SearchPark => {
        const coords = coordsByKey.get(catalogKey(park.providerId, park.parkPageId));
        const parkRegion: CampRegion = coords ? classifyRegion(coords.lat, coords.lon) : "socal";
        const totalAvailable = park.campgrounds.reduce((n, cg) => n + cg.availableSites.length, 0);
        return {
          parkPageId: park.parkPageId,
          parkName: park.parkName,
          provider: park.providerId,
          region: parkRegion,
          campgrounds: park.campgrounds,
          totalAvailable,
        };
      })
      .filter((p) => !region || p.region === region)
      .sort((a, b) => b.totalAvailable - a.totalAvailable);

    const noBookable = parks.every((p) => p.totalAvailable === 0);
    let fallback: {
      alternateDates: { parkPageId: string; parkName: string; region: CampRegion; earliestDate: string }[];
    } | null = null;

    if (noBookable) {
      const parkPageIds = region
        ? catalog
            .filter((p) => p.latitude != null && p.longitude != null && classifyRegion(p.latitude, p.longitude) === region)
            .map((p) => p.parkPageId)
        : undefined;
      const altDates = await findNextAvailableDates(ctx.db, { withinDays: 60, parkPageIds });
      fallback = {
        alternateDates: altDates.map((p) => {
          const coords = coordsByKey.get(catalogKey(p.providerId, p.parkPageId));
          const r: CampRegion = coords ? classifyRegion(coords.lat, coords.lon) : "socal";
          return { parkPageId: p.parkPageId, parkName: p.parkName, region: r, earliestDate: p.earliestDate };
        }),
      };
    }

    return { parks, fallback };
  }),
});
