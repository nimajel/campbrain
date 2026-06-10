import dayjs from 'dayjs';
import type { ScanCandidate, AvailabilityHit } from '../types/scanner.js';
import type { AvailabilityProvider, CacheWindow } from './availability-provider.js';
import type { AvailabilityWindowEntry, CampgroundWindow, SiteDailyAvailability } from '../cache/types.js';
import type { CampgroundCatalogEntry } from '../catalog/types.js';

interface RecGovCampsite {
  availabilities: Record<string, string>;
  campsite_id: string;
  loop: string;
  site: string;
  type_of_use: string;
  max_num_people: number;
  min_num_people: number;
  campsite_type?: string;
}

export interface RecGovAvailabilityResponse {
  campsites: Record<string, RecGovCampsite>;
  count: number;
}

export function buildAvailabilityUrl(campgroundId: string, monthStart: string): string {
  // Colons in the ISO datetime must be percent-encoded or the API returns 400 "query not encoded".
  return `https://www.recreation.gov/api/camps/availability/campground/${campgroundId}/month?start_date=${monthStart}T00%3A00%3A00.000Z`;
}

export function buildBookingUrl(campgroundId: string): string {
  return `https://www.recreation.gov/camping/campgrounds/${campgroundId}`;
}

export function monthStartForDate(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function requiredDates(arrivalDate: string, nights: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < nights; i++) {
    dates.push(dayjs(arrivalDate).add(i, 'day').format('YYYY-MM-DD'));
  }
  return dates;
}

function isSiteAvailableForAllDates(
  monthData: Map<string, RecGovAvailabilityResponse>,
  siteName: string,
  dates: string[]
): boolean {
  const availability = new Map<string, string>();

  for (const data of monthData.values()) {
    for (const campsite of Object.values(data.campsites)) {
      if (campsite.site === siteName) {
        for (const [isoDate, status] of Object.entries(campsite.availabilities)) {
          // API dates are like "2026-06-05T00:00:00Z"
          availability.set(isoDate.slice(0, 10), status);
        }
      }
    }
  }

  if (availability.size === 0) return false;
  return dates.every((date) => availability.get(date) === 'Available');
}

export function evaluateRecGovCandidate(
  monthData: Map<string, RecGovAvailabilityResponse>,
  candidate: ScanCandidate,
  acceptableSites: string[]
): AvailabilityHit[] {
  const dates = requiredDates(candidate.arrivalDate, candidate.nights);
  const hits: AvailabilityHit[] = [];

  for (const siteName of acceptableSites) {
    if (isSiteAvailableForAllDates(monthData, siteName, dates)) {
      hits.push({ siteName, status: 'available', confidence: 'high' });
    }
  }

  return hits;
}

export const REC_GOV_RETRY_DELAYS_MS = [15_000, 45_000, 90_000]; // 15s, 45s, 90s backoff on 429

export class RecreationGovProvider implements AvailabilityProvider {
  name = 'recreation-gov';
  /**
   * Fully sequential — only 1 request at a time. recreation.gov CloudFront
   * burst-blocks any concurrent requests. Sequential with a small delay is the
   * only setting confirmed to work reliably.
   * Cold scan (~648 parks × 6 months after pruning): ~60–90 min.
   * Incremental 2-hour cycles: ~2–5 min (only stale windows).
   */
  proactiveConcurrency = 1;
  batchDelayMs = 1_500;

  /** Fetch the monthly availability JSON, retrying on 429 with backoff.
   *  retryDelaysMs is injectable for testing (pass [0,0,0] to skip real waits). */
  async fetchWithRetry(
    url: string,
    parkName: string,
    windowStart: string,
    retryDelaysMs = REC_GOV_RETRY_DELAYS_MS
  ): Promise<RecGovAvailabilityResponse | 'unsupported' | null> {
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'campbrain/1.0 (personal-use camping assistant)' },
      });

      if (response.status === 429) {
        const delayMs = retryDelaysMs[attempt];
        if (delayMs === undefined) throw new Error('HTTP 429 — rate limited after all retries');
        console.warn(`  ⏳ ${parkName} ${windowStart} — rate limited (429), retrying in ${delayMs / 1000}s`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      // 400/404 means this facility has no campground availability endpoint
      // (wilderness areas, permit-only sites, etc.). Signal permanently unsupported.
      if (response.status === 400 || response.status === 404) return 'unsupported';

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as RecGovAvailabilityResponse;
    }
    throw new Error('HTTP 429 — rate limited after all retries');
  }

  generateCacheWindows(rangeStart: string, rangeEnd: string): CacheWindow[] {
    const windows: CacheWindow[] = [];
    // Step back to the 1st of the month containing rangeStart
    let current = dayjs(rangeStart).startOf('month');
    const end = dayjs(rangeEnd);
    while (current.isBefore(end) || current.isSame(end, 'month')) {
      windows.push({
        windowStart: current.format('YYYY-MM-DD'),
        windowEnd: current.endOf('month').format('YYYY-MM-DD'),
      });
      current = current.add(1, 'month');
    }
    return windows;
  }

  async proactiveScanWindow(
    parkPageId: string,
    window: CacheWindow,
    parkName: string,
    campgrounds: CampgroundCatalogEntry[]
  ): Promise<AvailabilityWindowEntry | 'unsupported' | null> {
    const url = buildAvailabilityUrl(parkPageId, window.windowStart);

    let data: RecGovAvailabilityResponse;
    try {
      const result = await this.fetchWithRetry(url, parkName, window.windowStart);
      if (result === 'unsupported') return 'unsupported'; // 400/404 — no availability endpoint
      if (result === null) return null;
      data = result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${parkName} ${window.windowStart} — ${msg}`);
      return null;
    }

    // Group all campsites under one campground entry for this facility.
    // Catalog may supply richer campground info; fall back to the facility itself.
    const catalogCg = campgrounds[0];
    const cgId = catalogCg?.id ?? parkPageId;
    const cgName = catalogCg?.name ?? parkName;
    const bookingUrl = buildBookingUrl(parkPageId);

    // Build per-site per-day availability from the monthly response.
    // Campsite keys in the response are internal IDs; use `site` as the display name.
    const siteMap = new Map<string, SiteDailyAvailability>();
    for (const campsite of Object.values(data.campsites)) {
      const siteName = campsite.site;
      if (!siteMap.has(siteName)) {
        const entry: SiteDailyAvailability = { name: siteName, dates: {} };
        if (campsite.campsite_type) entry.recGovCampsiteType = campsite.campsite_type;
        siteMap.set(siteName, entry);
      }
      const siteEntry = siteMap.get(siteName)!;
      for (const [isoDatetime, status] of Object.entries(campsite.availabilities)) {
        const date = isoDatetime.slice(0, 10); // "2026-07-04T00:00:00Z" → "2026-07-04"
        if (date >= window.windowStart && date <= window.windowEnd) {
          siteEntry.dates[date] = status === 'Available' ? 'available' : 'unavailable';
        }
      }
    }

    const cgWindow: CampgroundWindow = {
      id: cgId,
      name: cgName,
      bookingUrl,
      sites: Array.from(siteMap.values()),
    };
    if (catalogCg?.nightlyFee !== undefined) cgWindow.nightlyFee = catalogCg.nightlyFee;

    return {
      parkPageId,
      parkName,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      scannedAt: new Date().toISOString(),
      sourceUrl: url,
      campgrounds: cgWindow.sites.length > 0 ? [cgWindow] : [],
    };
  }
}
