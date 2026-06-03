import { NextRequest, NextResponse } from 'next/server';
import dayjs from 'dayjs';
import { searchAvailableStays, findNextAvailableDates } from '../../../lib/availability-cache';
import { classifyRegion, ALL_REGIONS } from '../../../lib/regions';
import type { CampRegion } from '../../../lib/regions';
import type { SearchParkResult, SearchCampground } from '../../../lib/availability-cache';
import { listParksWeb } from '../../../lib/catalog';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Response types (consumed by FindCampsitesClient)
// ---------------------------------------------------------------------------

export type SearchCampgroundResponse = SearchCampground;

export type SearchParkResponse = {
  parkPageId: string;
  parkName: string;
  provider: string;
  region: CampRegion;
  campgrounds: SearchCampgroundResponse[];
  totalAvailable: number; // bookable sites only
};

export type FallbackPark = {
  parkPageId: string;
  parkName: string;
  region: CampRegion;
  earliestDate: string;
};

export type SearchApiResponse = {
  parks: SearchParkResponse[];
  fallback: { alternateDates: FallbackPark[] } | null;
};

// ---------------------------------------------------------------------------
// GET /api/search?from=YYYY-MM-DD&to=YYYY-MM-DD[&filters=id1,id2][&region=slug]
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest
): Promise<NextResponse<SearchApiResponse | { error: string }>> {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const filtersParam = searchParams.get('filters') ?? '';
  const filterIds = filtersParam ? filtersParam.split(',') : [];
  const regionParam = searchParams.get('region');
  const regionFilter: CampRegion | null =
    regionParam && (ALL_REGIONS as string[]).includes(regionParam)
      ? (regionParam as CampRegion)
      : null;

  if (regionParam && !regionFilter) {
    return NextResponse.json({ error: `invalid region: ${regionParam}` }, { status: 400 });
  }

  // Lexicographic comparison works for ISO YYYY-MM-DD dates
  if (!from || !to || from >= to) {
    return NextResponse.json(
      { error: 'from and to are required and from must be before to' },
      { status: 400 }
    );
  }

  if (!dayjs(from).isValid() || !dayjs(to).isValid()) {
    return NextResponse.json({ error: 'from and to must be valid dates (YYYY-MM-DD)' }, { status: 400 });
  }

  try {
    // lat/lon and provider lookup from catalog (parks table has no coords — they live in the JSON)
    const catalogParks = listParksWeb();
    const coordsByPageId = new Map(
      catalogParks
        .filter((p): p is typeof p & { lat: number; lon: number } =>
          p.lat !== undefined && p.lon !== undefined
        )
        .map((p) => [p.parkPageId, { lat: p.lat, lon: p.lon }])
    );
    const providerByPageId = new Map(
      catalogParks.map((p) => [p.parkPageId, p.provider])
    );

    const results: SearchParkResult[] = await searchAvailableStays({ from, to, filterIds });

    const parks: SearchParkResponse[] = results
      .map((park) => {
        const coords = coordsByPageId.get(park.parkPageId);
        const region: CampRegion = coords
          ? classifyRegion(coords.lat, coords.lon)
          : 'socal';
        const totalAvailable = park.campgrounds.reduce(
          (n, cg) => n + cg.availableSites.length,
          0
        );
        const provider = providerByPageId.get(park.parkPageId) ?? 'california-parks';
        return { ...park, region, totalAvailable, provider };
      })
      .filter((park) => !regionFilter || park.region === regionFilter)
      .sort((a, b) => b.totalAvailable - a.totalAvailable);

    // Fallback: shown when no bookable availability found (walk-up-only results don't count)
    const noBookable = parks.every((p) => p.totalAvailable === 0);
    let fallback: SearchApiResponse['fallback'] = null;
    if (noBookable) {
      const parkPageIds = regionFilter
        ? catalogParks
            .filter(
              (p): p is typeof p & { lat: number; lon: number } =>
                p.lat !== undefined && p.lon !== undefined
            )
            .filter((p) => classifyRegion(p.lat, p.lon) === regionFilter)
            .map((p) => p.parkPageId)
        : undefined;

      const altDates = await findNextAvailableDates({ withinDays: 60, parkPageIds });
      fallback = {
        alternateDates: altDates.map((p) => {
          const coords = coordsByPageId.get(p.parkPageId);
          const region: CampRegion = coords
            ? classifyRegion(coords.lat, coords.lon)
            : 'socal';
          return { parkPageId: p.parkPageId, parkName: p.parkName, region, earliestDate: p.earliestDate };
        }),
      };
    }

    return NextResponse.json({ parks, fallback });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
