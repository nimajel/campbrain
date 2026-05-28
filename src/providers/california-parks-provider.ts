import { load } from 'cheerio';
import dayjs from 'dayjs';
import type { Target } from '../config/schemas.js';
import type { ScanCandidate, ScanResult, AvailabilityHit } from '../types/scanner.js';
import type { AvailabilityProvider } from './availability-provider.js';
import { saveDebugHtml } from '../utils/files.js';

export class CaliforniaParksProvider implements AvailabilityProvider {
  name = 'california-parks';

  async scan(
    target: Target,
    candidates: ScanCandidate[]
  ): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    for (const candidate of candidates) {
      const result = await this.scanCandidate(target, candidate);
      results.push(result);
    }

    return results;
  }

  private async scanCandidate(
    target: Target,
    candidate: ScanCandidate
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

    const debugHtmlPath = saveDebugHtml(
      target.id,
      candidate.arrivalDate,
      candidate.nights,
      html
    );

    const hits = this.parseHtml(html, target.acceptableSites);

    const parsingNotes = hits.length > 0
      ? `Found ${hits.length} site(s)`
      : 'No sites parsed';

    return {
      targetId: target.id,
      targetName: target.name,
      candidate,
      sourceUrl,
      debugHtmlPath,
      hits,
      parsingNotes,
      scannedAt: new Date().toISOString(),
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

  private parseHtml(html: string, acceptableSites: string[]): AvailabilityHit[] {
    const hits: AvailabilityHit[] = [];

    try {
      const $ = load(html);

      // Look for table rows with unit-name class
      $('td.unit-name').each((_index, element) => {
        const unitNameCell = $(element);
        const siteName = unitNameCell.text().trim();

        // Check if this is one of our acceptable sites
        for (const acceptableSite of acceptableSites) {
          if (siteName === acceptableSite) {
            // Get the next cell which contains the availability status
            const nextCell = unitNameCell.next('td');
            if (nextCell.length > 0) {
              const cellClass = nextCell.attr('class') || '';
              const span = nextCell.find('span');
              const spanClass = span.attr('class') || '';
              const title = span.attr('title') || '';

              let status = 'Unknown';
              let confidence: 'high' | 'medium' | 'low' = 'medium';

              if (cellClass.includes('available')) {
                status = 'Available';
                confidence = 'high';
              } else if (cellClass.includes('unavailable')) {
                status = 'Unavailable';
                confidence = 'high';
              } else if (spanClass.includes('text-success')) {
                status = 'Available';
                confidence = 'high';
              } else if (
                spanClass.includes('text-secondary') ||
                spanClass.includes('text-danger')
              ) {
                status = 'Unavailable';
                confidence = 'high';
              }

              // Extract any availability info from title attribute
              if (title.includes('Available')) {
                status = 'Available';
                confidence = 'high';
              } else if (
                title.includes('Uavailable') ||
                title.includes('Unavailable')
              ) {
                status = 'Unavailable';
                confidence = 'high';
              }

              hits.push({
                siteName,
                status,
                confidence,
              });
            }
          }
        }
      });
    } catch (error) {
      console.error('Error parsing HTML:', error instanceof Error ? error.message : error);
    }

    return hits;
  }
}
