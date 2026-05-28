import { load } from 'cheerio';
import dayjs from 'dayjs';
import type { Target } from '../config/schemas.js';
import type { ScanCandidate, ScanResult, AvailabilityHit } from '../types/scanner.js';
import type { AvailabilityProvider } from './availability-provider.js';
import { saveDebugHtml } from '../utils/files.js';

export interface ParsedCampground {
  name: string;
  bookingUrl: string;
  datesToAvailability: Map<string, SiteAvailability[]>;
}

export interface SiteAvailability {
  siteName: string;
  status: 'available' | 'unavailable' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
}

export interface CandidateMatch {
  isMATCH: boolean;
  nightsAvailable: number;
  siteHits: AvailabilityHit[];
  siteStatuses: SiteAvailability[];
}

export class CaliforniaParksProvider implements AvailabilityProvider {
  name = 'california-parks';

  async scan(
    target: Target,
    candidates: ScanCandidate[],
    debugMode: boolean = false
  ): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    for (const candidate of candidates) {
      const result = await this.scanCandidate(target, candidate, debugMode);
      results.push(result);
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
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      html = await response.text();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`    Error fetching: ${errorMsg}`);
      return {
        targetId: target.id,
        targetName: target.name,
        candidate,
        sourceUrl,
        debugHtmlPath: '',
        hits: [],
        parsingNotes: `Fetch failed: ${errorMsg}`,
        scannedAt: new Date().toISOString(),
      };
    }

    const parsed = this.parseHtml(html, target);
    let debugHtmlPath = '';
    let shouldSaveDebugHtml = debugMode || !parsed;

    if (shouldSaveDebugHtml) {
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
        parsingNotes: 'Could not find Ridge section in HTML',
        scannedAt: new Date().toISOString(),
      };
    }

    const match = this.evaluateCandidate(
      candidate,
      parsed.datesToAvailability,
      target.acceptableSites
    );

    const hits = match.siteHits;
    const parsingNotes = match.isMATCH
      ? `🎯 MATCH: ${match.nightsAvailable} night(s) available for all target sites`
      : `No match (${match.nightsAvailable} night(s) scanned)`;

    return {
      targetId: target.id,
      targetName: target.name,
      candidate,
      sourceUrl,
      debugHtmlPath,
      hits,
      parsingNotes,
      scannedAt: new Date().toISOString(),
      bookingUrl: parsed.bookingUrl,
      siteStatuses: match.siteStatuses,
    };
  }

  private buildUrl(pageId: string, candidate: ScanCandidate): string {
    const baseUrl = 'https://www.parks.ca.gov/AvailabilityInfo';
    const params = new URLSearchParams({
      arrival_date: candidate.arrivalDate,
      length: candidate.nights.toString(),
      page_id: pageId,
    });
    return `${baseUrl}?${params.toString()}`;
  }

  private parseHtml(html: string, target: Target): ParsedCampground | null {
    try {
      const $ = load(html);

      // Find the section.card that contains the target campground name
      let campgroundSection = $('section.card').filter((_index, section) => {
        const h4 = $(section).find('header.card-header h4');
        return h4.text().trim() === target.campgroundName;
      });

      if (campgroundSection.length === 0) {
        return null;
      }

      // Extract booking URL from the section header link
      const bookingLinkElem = campgroundSection.find('header.card-header a');
      const bookingLinkHref = bookingLinkElem.attr('href');
      const bookingUrl =
        bookingLinkHref && typeof bookingLinkHref === 'string'
          ? `https://reservecalifornia.com${bookingLinkHref}`
          : '';

      // Parse the availability table
      const table = campgroundSection.find('table');
      const thead = table.find('thead tr');
      const dateCells = thead.find('th').slice(1); // Skip "Unit" header

      const dates: string[] = [];
      dateCells.each((index: number) => {
        const cell = dateCells.eq(index);
        const dateStr = cell.text().trim();
        const parsed = this.parseHeaderDate(dateStr);
        if (parsed) {
          dates.push(parsed);
        }
      });

      const datesToAvailability = new Map<string, SiteAvailability[]>();

      // Initialize the map for each date
      for (const date of dates) {
        datesToAvailability.set(date, []);
      }

      // Parse each site row
      const tbody = table.find('tbody tr');
      tbody.each((index: number) => {
        const row = tbody.eq(index);
        const unitNameCell = row.find('td.unit-name');
        const siteName = unitNameCell.text().trim();

        // Check if this is one of our target sites
        const isTargetSite = target.acceptableSites.some(
          (site) => site === siteName
        );

        if (isTargetSite) {
          const cells = row.find('td').slice(1); // Skip unit-name cell
          cells.each((dateIndex: number) => {
            if (dateIndex < dates.length) {
              const date = dates[dateIndex]!;
              const cell = cells.eq(dateIndex);

              const cellClass = (cell.attr('class') as string | undefined) || '';
              const span = cell.find('span');
              const spanClass = (span.attr('class') as string | undefined) || '';
              const title = (span.attr('title') as string | undefined) || '';
              const hasLink = cell.find('a').length > 0;

              let status: 'available' | 'unavailable' | 'unknown' = 'unknown';

              // Check for available indicators
              if (
                cellClass.includes('availability') ||
                spanClass.includes('text-success') ||
                spanClass.includes('fa-check') ||
                title.includes('Available') ||
                (hasLink &&
                  (spanClass.includes('fa-check') ||
                    spanClass.includes('text-success')))
              ) {
                status = 'available';
              } else if (
                cellClass.includes('unavailable') ||
                spanClass.includes('text-secondary') ||
                spanClass.includes('text-danger') ||
                spanClass.includes('fa-xmark') ||
                spanClass.includes('fa-times') ||
                title.includes('Uavailable') ||
                title.includes('Unavailable') ||
                !hasLink
              ) {
                status = 'unavailable';
              }

              const statuses = datesToAvailability.get(date);
              if (statuses) {
                statuses.push({
                  siteName,
                  status,
                  confidence: status === 'unknown' ? 'low' : 'high',
                });
              }
            }
          });
        }
      });

      return {
        name: target.campgroundName,
        bookingUrl,
        datesToAvailability,
      };
    } catch (error) {
      console.error(
        'Error parsing HTML:',
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  private parseHeaderDate(headerText: string): string | null {
    // Try to parse dates like "8/14/2026" into YYYY-MM-DD
    const match = headerText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match && match[1] && match[2] && match[3]) {
      const month = match[1].padStart(2, '0');
      const day = match[2].padStart(2, '0');
      const year = match[3];
      return `${year}-${month}-${day}`;
    }
    return null;
  }

  private evaluateCandidate(
    candidate: ScanCandidate,
    datesToAvailability: Map<string, SiteAvailability[]>,
    acceptableSites: string[]
  ): CandidateMatch {
    const requiredDates: string[] = [];
    let currentDate = dayjs(candidate.arrivalDate);

    for (let i = 0; i < candidate.nights; i++) {
      requiredDates.push(currentDate.format('YYYY-MM-DD'));
      currentDate = currentDate.add(1, 'day');
    }

    // Collect all statuses for output
    const siteStatuses: SiteAvailability[] = [];
    for (const date of requiredDates) {
      const statuses = datesToAvailability.get(date) || [];
      siteStatuses.push(...statuses);
    }

    // Check if all target sites are available for all required nights
    const hits: AvailabilityHit[] = [];

    for (const siteName of acceptableSites) {
      let allNightsAvailable = true;

      for (const date of requiredDates) {
        const statuses = datesToAvailability.get(date) || [];
        const siteStatus = statuses.find((s) => s.siteName === siteName);

        if (!siteStatus || siteStatus.status !== 'available') {
          allNightsAvailable = false;
          break;
        }
      }

      if (allNightsAvailable) {
        hits.push({
          siteName,
          status: 'Available',
          confidence: 'high',
        });
      }
    }

    return {
      isMATCH: hits.length > 0,
      nightsAvailable: requiredDates.length,
      siteHits: hits,
      siteStatuses,
    };
  }
}
