import dayjs from 'dayjs';
import type { AvailabilityProvider, CacheWindow, OnUnexpectedHtml } from './availability-provider';
import type { AvailabilityWindowEntry, CampgroundWindow } from '../availability/types';
import type { CampgroundCatalogEntry } from '../catalog/types';
import { WINDOW_DAYS } from '../availability/types';
import {
  parseAllAvailability,
  isNoAvailabilityPage,
} from './california-parks-parser';

export class CaliforniaParksProvider implements AvailabilityProvider {
  name = 'california-parks';

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
    campgrounds: CampgroundCatalogEntry[],
    options?: { onUnexpectedHtml?: OnUnexpectedHtml }
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
        // Unexpected response — capture for debugging, then stop probing this window
        await options?.onUnexpectedHtml?.(html, { parkPageId, arrivalDate, url });
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

// `endDate` is accepted because the proactiveScanWindow probe loop passes it; the URL only needs arrival_date + length.
export function buildAvailabilityUrl(
  pageId: string,
  candidate: { arrivalDate: string; nights: number; endDate?: string }
): string {
  const params = new URLSearchParams({
    arrival_date: candidate.arrivalDate,
    length: candidate.nights.toString(),
    page_id: pageId,
  });
  return `https://www.parks.ca.gov/AvailabilityInfo?${params}`;
}
