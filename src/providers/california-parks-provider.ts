import type { Target } from '../config/schemas.js';
import type { ScanCandidate, ScanResult, ParsedCampground } from '../types/scanner.js';
import type { AvailabilityProvider } from './availability-provider.js';
import {
  parseAvailabilityHtml,
  evaluateCandidate,
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
    const params = new URLSearchParams({
      arrival_date: candidate.arrivalDate,
      length: candidate.nights.toString(),
      page_id: pageId,
    });
    return `https://www.parks.ca.gov/AvailabilityInfo?${params}`;
  }
}

function buildNoMatchNote(parsed: ParsedCampground, nights: number): string {
  if (parsed.sitesMissing.length > 0) {
    return `Sites not found in HTML: ${parsed.sitesMissing.join(', ')}`;
  }
  return `No match — ${nights} night(s) checked`;
}
