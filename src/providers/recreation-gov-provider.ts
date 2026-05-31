import type { Target } from '../config/schemas.js';
import type { ScanCandidate, ScanResult, AvailabilityHit } from '../types/scanner.js';
import type { AvailabilityProvider } from './availability-provider.js';
import dayjs from 'dayjs';

interface RecGovCampsite {
  availabilities: Record<string, string>;
  campsite_id: string;
  loop: string;
  site: string;
  type_of_use: string;
  max_num_people: number;
  min_num_people: number;
}

export interface RecGovAvailabilityResponse {
  campsites: Record<string, RecGovCampsite>;
  count: number;
}

export function buildAvailabilityUrl(campgroundId: string, monthStart: string): string {
  return `https://www.recreation.gov/api/camps/availability/campground/${campgroundId}/month?start_date=${monthStart}T00:00:00.000Z`;
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

export class RecreationGovProvider implements AvailabilityProvider {
  name = 'recreation-gov';

  async scan(
    target: Target,
    candidates: ScanCandidate[],
    _debugMode = false
  ): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for (const candidate of candidates) {
      results.push(await this.scanCandidate(target, candidate));
    }
    return results;
  }

  private async scanCandidate(
    target: Target,
    candidate: ScanCandidate
  ): Promise<ScanResult> {
    const dates = requiredDates(candidate.arrivalDate, candidate.nights);
    const months = [...new Set(dates.map(monthStartForDate))];
    const monthData = new Map<string, RecGovAvailabilityResponse>();

    for (const month of months) {
      const url = buildAvailabilityUrl(target.parkPageId, month);
      console.log(`  Fetching: ${url}`);
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'campbrain/1.0 (personal-use camping assistant)' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        monthData.set(month, (await response.json()) as RecGovAvailabilityResponse);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`    Fetch error: ${msg}`);
        return {
          targetId: target.id,
          targetName: target.name,
          candidate,
          sourceUrl: buildAvailabilityUrl(target.parkPageId, months[0]!),
          debugHtmlPath: '',
          hits: [],
          parsingNotes: `Fetch failed: ${msg}`,
          scannedAt: new Date().toISOString(),
        };
      }
    }

    const hits = evaluateRecGovCandidate(monthData, candidate, target.acceptableSites);
    const sourceUrl = buildAvailabilityUrl(target.parkPageId, months[0]!);

    return {
      targetId: target.id,
      targetName: target.name,
      candidate,
      sourceUrl,
      debugHtmlPath: '',
      hits,
      parsingNotes:
        hits.length > 0
          ? `🎯 MATCH — ${hits.map((h) => h.siteName).join(', ')}`
          : `No match — ${candidate.nights} night(s) checked`,
      scannedAt: new Date().toISOString(),
      bookingUrl: buildBookingUrl(target.parkPageId),
    };
  }
}
