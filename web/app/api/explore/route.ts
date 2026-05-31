import { NextRequest, NextResponse } from 'next/server';
import dayjs from 'dayjs';
import { listParksWeb } from '../../../lib/catalog';
import {
  buildAvailabilityUrl,
} from '../../../../src/providers/california-parks-provider';
import {
  parseAvailabilityHtml,
  evaluateCandidate,
} from '../../../../src/providers/california-parks-parser';
import { RecreationGovProvider } from '../../../../src/providers/recreation-gov-provider';
import type { Target } from '../../../../src/config/schemas';
import type { ScanCandidate } from '../../../../src/types/scanner';
import { serializeResult } from '../../../../src/types/scanner';
import type { ParkCatalogEntry, CampgroundCatalogEntry } from '../../../../src/catalog/types';
import { runWithConcurrency } from '../../../../src/utils/concurrency';

export interface ExploreResult {
  parkName: string;
  parkPageId: string;
  provider: string;
  campgroundName: string;
  campgroundId: string;
  arrivalDate: string;
  nights: number;
  availableSites: string[];
  sourceUrl: string;
  bookingUrl?: string;
  nightlyFee?: number;
  error?: string;
  noSiteData?: boolean;
}

export interface ExploreResponse {
  results: ExploreResult[];
  scannedAt: string;
  skippedParks: { parkName: string; parkPageId: string; reason: string }[];
}

// Max simultaneous outbound HTTP requests. Applies to both provider paths.
const FETCH_CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// California Parks path
// Key insight: all campgrounds within a park share the same parkPageId, so
// they all fetch the identical URL. We fetch once per unique pageId (Phase 1),
// then parse each campground from the cached HTML synchronously (Phase 2).
// ---------------------------------------------------------------------------
type HtmlResult = { html: string; sourceUrl: string } | { error: string };

async function scanCaliforniaParks(
  parks: ParkCatalogEntry[],
  candidate: ScanCandidate,
  people: number
): Promise<ExploreResult[]> {
  const arrivalDate = candidate.arrivalDate;
  const nights = candidate.nights;
  const departureDate = candidate.endDate;

  // Phase 1: fetch HTML — one request per unique pageId
  const uniquePageIds = [...new Set(parks.map((p) => p.parkPageId))];
  const fetchTasks = uniquePageIds.map(
    (pageId) => async (): Promise<{ html: string; sourceUrl: string }> => {
      const sourceUrl = buildAvailabilityUrl(pageId, candidate);
      console.log(`  [explore] Fetching: ${sourceUrl}`);
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      return { html, sourceUrl };
    }
  );

  const outcomes = await runWithConcurrency(fetchTasks, FETCH_CONCURRENCY);

  const htmlByPageId = new Map<string, HtmlResult>();
  outcomes.forEach((outcome, i) => {
    const pageId = uniquePageIds[i]!;
    if (outcome.status === 'fulfilled') {
      htmlByPageId.set(pageId, outcome.value);
    } else {
      const msg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      htmlByPageId.set(pageId, { error: msg });
    }
  });

  // Phase 2: parse each campground from cached HTML (no I/O)
  const results: ExploreResult[] = [];

  for (const park of parks) {
    const fetched = htmlByPageId.get(park.parkPageId);
    if (!fetched) continue;

    if ('error' in fetched) {
      results.push({
        parkName: park.parkName,
        parkPageId: park.parkPageId,
        provider: park.provider,
        campgroundName: '',
        campgroundId: '',
        arrivalDate,
        nights,
        availableSites: [],
        sourceUrl: '',
        error: fetched.error,
      });
      continue;
    }

    const { html, sourceUrl } = fetched;

    for (const campground of park.campgrounds.filter((c) => c.sites.length > 0)) {
      const target: Target = {
        id: `explore-${park.parkPageId}-${campground.id}`,
        name: `${park.parkName} – ${campground.name}`,
        provider: 'california-parks',
        parkName: park.parkName,
        parkPageId: park.parkPageId,
        campgroundName: campground.name,
        acceptableSites: campground.sites.map((s) => s.name),
        preferredSites: [],
        campingType: 'drive-to',
        people: Math.max(1, Math.min(99, people)),
        dateMode: 'exact_dates',
        exactStartDate: arrivalDate,
        exactEndDate: departureDate,
        minNights: nights,
        maxNights: nights,
        weekendsOnly: false,
        bookingRule: campground.bookingRule ?? park.defaultBookingRule,
      };

      const parsed = parseAvailabilityHtml(html, target);
      const availableSites = parsed
        ? evaluateCandidate(candidate, parsed, target.acceptableSites).hits.map((h) => h.siteName)
        : [];

      results.push({
        parkName: park.parkName,
        parkPageId: park.parkPageId,
        provider: park.provider,
        campgroundName: campground.name,
        campgroundId: campground.id,
        arrivalDate,
        nights,
        availableSites,
        sourceUrl,
        ...(campground.nightlyFee !== undefined ? { nightlyFee: campground.nightlyFee } : {}),
        ...(campground.bookingUrl ? { bookingUrl: campground.bookingUrl } : {}),
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Recreation.gov path — provider handles its own fetch/parse; run in parallel
// ---------------------------------------------------------------------------
async function scanRecreationGovParks(
  parks: ParkCatalogEntry[],
  candidate: ScanCandidate,
  people: number,
  departureDate: string
): Promise<ExploreResult[]> {
  const provider = new RecreationGovProvider();

  function campgroundToTarget(
    park: ParkCatalogEntry,
    campground: CampgroundCatalogEntry
  ): Target {
    return {
      id: `explore-${park.parkPageId}-${campground.id}`,
      name: `${park.parkName} – ${campground.name}`,
      provider: 'recreation-gov',
      parkName: park.parkName,
      parkPageId: park.parkPageId,
      campgroundName: campground.name,
      acceptableSites: campground.sites.map((s) => s.name),
      preferredSites: [],
      campingType: 'drive-to',
      people: Math.max(1, Math.min(99, people)),
      dateMode: 'exact_dates',
      exactStartDate: candidate.arrivalDate,
      exactEndDate: departureDate,
      minNights: candidate.nights,
      maxNights: candidate.nights,
      weekendsOnly: false,
      bookingRule: campground.bookingRule ?? park.defaultBookingRule,
    };
  }

  // One task per campground (each has its own API endpoint for rec.gov)
  type TaskResult = ExploreResult;
  const tasks: Array<() => Promise<TaskResult>> = [];

  for (const park of parks) {
    for (const campground of park.campgrounds.filter((c) => c.sites.length > 0)) {
      const target = campgroundToTarget(park, campground);
      tasks.push(async () => {
        const scanResults = await provider.scan(target, [candidate], false);
        const serialized = scanResults.map(serializeResult);
        return {
          parkName: park.parkName,
          parkPageId: park.parkPageId,
          provider: park.provider,
          campgroundName: campground.name,
          campgroundId: campground.id,
          arrivalDate: candidate.arrivalDate,
          nights: candidate.nights,
          availableSites: serialized.flatMap((r) => r.hits.map((h) => h.siteName)),
          sourceUrl: serialized[0]?.sourceUrl ?? '',
          ...(campground.nightlyFee !== undefined ? { nightlyFee: campground.nightlyFee } : {}),
          ...(campground.bookingUrl ? { bookingUrl: campground.bookingUrl } : {}),
        };
      });
    }
  }

  const outcomes = await runWithConcurrency(tasks, FETCH_CONCURRENCY);
  return outcomes
    .map((o, i) => {
      if (o.status === 'fulfilled') return o.value;
      // Reconstruct a minimal error result from the task index
      const allCampgrounds = parks.flatMap((p) =>
        p.campgrounds.filter((c) => c.sites.length > 0).map((c) => ({ park: p, campground: c }))
      );
      const { park, campground } = allCampgrounds[i]!;
      return {
        parkName: park.parkName,
        parkPageId: park.parkPageId,
        provider: park.provider,
        campgroundName: campground.name,
        campgroundId: campground.id,
        arrivalDate: candidate.arrivalDate,
        nights: candidate.nights,
        availableSites: [],
        sourceUrl: '',
        error: o.reason instanceof Error ? o.reason.message : String(o.reason),
      } satisfies ExploreResult;
    });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      arrivalDate?: string;
      nights?: number;
      parkPageIds?: string[];
      people?: number;
    };

    const { arrivalDate, nights, parkPageIds, people = 2 } = body;

    if (!arrivalDate || !nights || !parkPageIds?.length) {
      return NextResponse.json(
        { error: 'arrivalDate, nights, and parkPageIds are required' },
        { status: 400 }
      );
    }

    if (nights < 1 || nights > 14) {
      return NextResponse.json({ error: 'nights must be 1–14' }, { status: 400 });
    }

    const departureDate = dayjs(arrivalDate).add(nights, 'day').format('YYYY-MM-DD');
    const candidate: ScanCandidate = { arrivalDate, nights, endDate: departureDate };

    const allParks = listParksWeb();
    const selectedParks = allParks.filter((p) => parkPageIds.includes(p.parkPageId));

    const parksWithoutData = selectedParks.filter(
      (p) => !p.campgrounds.some((c) => c.sites.length > 0)
    );
    const calParks = selectedParks.filter(
      (p) => p.provider === 'california-parks' && p.campgrounds.some((c) => c.sites.length > 0)
    );
    const recGovParks = selectedParks.filter(
      (p) => p.provider === 'recreation-gov' && p.campgrounds.some((c) => c.sites.length > 0)
    );

    // Run both provider paths in parallel
    const [calResults, recGovResults] = await Promise.all([
      calParks.length > 0 ? scanCaliforniaParks(calParks, candidate, people) : Promise.resolve([]),
      recGovParks.length > 0 ? scanRecreationGovParks(recGovParks, candidate, people, departureDate) : Promise.resolve([]),
    ]);

    const noDataResults: ExploreResult[] = parksWithoutData.map((park) => ({
      parkName: park.parkName,
      parkPageId: park.parkPageId,
      provider: park.provider,
      campgroundName: '',
      campgroundId: '',
      arrivalDate,
      nights,
      availableSites: [],
      sourceUrl: '',
      noSiteData: true,
    }));

    // Preserve original park ordering from the catalog
    const resultsByParkId = new Map<string, ExploreResult[]>();
    for (const r of [...calResults, ...recGovResults, ...noDataResults]) {
      const list = resultsByParkId.get(r.parkPageId) ?? [];
      list.push(r);
      resultsByParkId.set(r.parkPageId, list);
    }
    const results = selectedParks.flatMap((p) => resultsByParkId.get(p.parkPageId) ?? []);

    return NextResponse.json({
      results,
      scannedAt: new Date().toISOString(),
      skippedParks: [],
    } satisfies ExploreResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
