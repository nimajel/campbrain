import dayjs from 'dayjs';
import type { Target } from '../config/schemas.js';
import type { ScanCandidate, ScanResult, ParsedCampground } from '../types/scanner.js';
import type { AvailabilityProvider, CacheWindow } from './availability-provider.js';
import type { AvailabilityWindowEntry, CampgroundWindow } from '../cache/types.js';
import type { CampgroundCatalogEntry } from '../catalog/types.js';
import { WINDOW_DAYS } from '../cache/types.js';
import {
  parseAvailabilityHtml,
  evaluateCandidate,
  parseAllAvailability,
  isNoAvailabilityPage,
} from './california-parks-parser.js';
import { saveDebugHtml } from '../utils/files.js';

export class CaliforniaParksProvider implements AvailabilityProvider {
  name = 'california-parks';

  async scan(
    target: Target,
    candidates: ScanCandidate[],
    debugMode: boolean = false
  ): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for (const candidate of candidates) {
      results.push(await this.scanCandidate(target, candidate, debugMode));
    }
    return results;
  }

  private async scanCandidate(
    target: Target,
    candidate: ScanCandidate,
    debugMode: boolean
  ): Promise<ScanResult> {
    const sourceUrl = this.buildUrl(target.parkPageId, candidate);

    console.log(`  Fetching: ${sourceUrl}`);

    let html = '';
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      html = await response.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    Fetch error: ${msg}`);
      return {
        targetId: target.id,
        targetName: target.name,
        candidate,
        sourceUrl,
        debugHtmlPath: '',
        hits: [],
        parsingNotes: `Fetch failed: ${msg}`,
        scannedAt: new Date().toISOString(),
      };
    }

    const parsed = parseAvailabilityHtml(html, target);

    // Decide whether to save debug HTML
    const needsDebug =
      debugMode ||
      !parsed ||
      parsed.sitesMissing.length > 0 ||
      parsed.hasUnknownStatuses;

    let debugHtmlPath = '';
    if (needsDebug) {
      debugHtmlPath = saveDebugHtml(
        target.id,
        candidate.arrivalDate,
        candidate.nights,
        html
      );
    }

    if (!parsed) {
      return {
        targetId: target.id,
        targetName: target.name,
        candidate,
        sourceUrl,
        debugHtmlPath,
        hits: [],
        parsingNotes: `Could not find "${target.campgroundName}" section in HTML`,
        scannedAt: new Date().toISOString(),
      };
    }

    const evaluation = evaluateCandidate(candidate, parsed, target.acceptableSites);

    const parsingNotes = evaluation.isMATCH
      ? `🎯 MATCH — ${evaluation.hits.map((h) => h.siteName).join(', ')}`
      : buildNoMatchNote(parsed, candidate.nights);

    return {
      targetId: target.id,
      targetName: target.name,
      candidate,
      sourceUrl,
      debugHtmlPath,
      hits: evaluation.hits,
      parsingNotes,
      scannedAt: new Date().toISOString(),
      bookingUrl: parsed.bookingUrl,
      parsedCampground: parsed,
      statusBySite: evaluation.statusBySite,
    };
  }

  private buildUrl(pageId: string, candidate: ScanCandidate): string {
    return buildAvailabilityUrl(pageId, candidate);
  }

  generateCacheWindows(rangeStart: string, rangeEnd: string): CacheWindow[] {
    const windows: CacheWindow[] = [];
    let current = dayjs(rangeStart);
    const end = dayjs(rangeEnd);
    while (current.isBefore(end) || current.isSame(end)) {
      const windowStart = current.format('YYYY-MM-DD');
      const windowEnd = current.add(WINDOW_DAYS - 1, 'day').format('YYYY-MM-DD');
      windows.push({ windowStart, windowEnd });
      current = current.add(WINDOW_DAYS, 'day');
    }
    return windows;
  }

  async proactiveScanWindow(
    parkPageId: string,
    window: CacheWindow,
    parkName: string,
    campgrounds: CampgroundCatalogEntry[]
  ): Promise<AvailabilityWindowEntry | null> {
    const { windowStart, windowEnd } = window;
    const catalogCgByName = new Map(campgrounds.map((c) => [c.name, c]));
    const maxProbes = WINDOW_DAYS;

    let parsed: ReturnType<typeof parseAllAvailability> = [];
    let successUrl = '';

    for (let offset = 0; offset < maxProbes; offset++) {
      const arrivalDate = dayjs(windowStart).add(offset, 'day').format('YYYY-MM-DD');
      const url = buildAvailabilityUrl(parkPageId, { arrivalDate, nights: 1, endDate: windowEnd });

      let html: string;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
      } catch (err) {
        console.error(`  ✗ ${parkName} ${windowStart}+${offset} — ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }

      parsed = parseAllAvailability(html);
      if (parsed.length > 0) {
        successUrl = url;
        break;
      }

      if (!isNoAvailabilityPage(html)) {
        // Unexpected response — stop probing this window
        return null;
      }
      // fully booked day — try next offset
    }

    if (parsed.length === 0) {
      // All probed days fully booked — store empty window
      return {
        parkPageId,
        parkName,
        windowStart,
        windowEnd,
        scannedAt: new Date().toISOString(),
        sourceUrl: buildAvailabilityUrl(parkPageId, { arrivalDate: windowStart, nights: 1, endDate: windowEnd }),
        campgrounds: [],
      };
    }

    const cgWindows: CampgroundWindow[] = parsed.map((pc) => {
      const catalogCg = catalogCgByName.get(pc.name);
      const result: CampgroundWindow = {
        id: catalogCg?.id ?? pc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: pc.name,
        sites: pc.sites,
      };
      const bookingUrl = pc.bookingUrl || catalogCg?.bookingUrl;
      if (bookingUrl) result.bookingUrl = bookingUrl;
      if (catalogCg?.nightlyFee !== undefined) result.nightlyFee = catalogCg.nightlyFee;
      return result;
    });

    return {
      parkPageId,
      parkName,
      windowStart,
      windowEnd,
      scannedAt: new Date().toISOString(),
      sourceUrl: successUrl,
      campgrounds: cgWindows,
    };
  }
}

export function buildAvailabilityUrl(pageId: string, candidate: ScanCandidate): string {
  const params = new URLSearchParams({
    arrival_date: candidate.arrivalDate,
    length: candidate.nights.toString(),
    page_id: pageId,
  });
  return `https://www.parks.ca.gov/AvailabilityInfo?${params}`;
}

function buildNoMatchNote(parsed: ParsedCampground, nights: number): string {
  if (parsed.sitesMissing.length > 0) {
    return `Sites not found in HTML: ${parsed.sitesMissing.join(', ')}`;
  }
  return `No match — ${nights} night(s) checked`;
}
