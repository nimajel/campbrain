import { load } from 'cheerio';
import dayjs from 'dayjs';
import type { Target } from '../config/schemas.js';
import type {
  ScanCandidate,
  AvailabilityHit,
  AvailabilityStatus,
  AvailabilityConfidence,
  DailySiteStatus,
  ParsedCampground,
} from '../types/scanner.js';

export type { AvailabilityStatus, AvailabilityConfidence, DailySiteStatus, ParsedCampground };

export interface CandidateEvaluation {
  isMATCH: boolean;
  hits: AvailabilityHit[];
  statusBySite: Map<string, DailySiteStatus[]>;
}

// ---------------------------------------------------------------------------
// Main parse entry point — exported for tests
// ---------------------------------------------------------------------------

export function parseAvailabilityHtml(
  html: string,
  target: Target
): ParsedCampground | null {
  try {
    const $ = load(html);

    // 1. Find the section.card whose header h4 exactly matches campgroundName
    const section = $('section.card').filter((_i, el) => {
      return (
        $(el).find('header.card-header h4').text().trim() === target.campgroundName
      );
    });

    if (section.length === 0) {
      return null;
    }

    // 2. Booking URL — href is already a full URL in the source HTML
    const bookingUrl =
      (section.find('header.card-header a').first().attr('href') as
        | string
        | undefined) ?? '';

    // 3. Date columns (skip first "Unit" <th>)
    const headerCells = section.find('table thead tr th').slice(1);
    const dates: string[] = [];
    headerCells.each((i) => {
      const parsed = parseHeaderDate(headerCells.eq(i).text().trim());
      if (parsed) dates.push(parsed);
    });

    // 4. Parse each acceptable site row
    const siteRows: DailySiteStatus[][] = [];
    const sitesFound: string[] = [];
    const sitesMissing: string[] = [];
    let hasUnknownStatuses = false;

    for (const siteName of target.acceptableSites) {
      let foundRow: DailySiteStatus[] | null = null;

      section.find('tbody tr').each((_i, tr) => {
        if ($(tr).find('td.unit-name').text().trim() === siteName) {
          const cells = $(tr).find('td').slice(1); // skip unit-name
          const row: DailySiteStatus[] = [];

          cells.each((dateIndex) => {
            if (dateIndex >= dates.length) return;
            const cell = cells.eq(dateIndex);
            const status = classifyCell(cell);
            if (status === 'unknown') hasUnknownStatuses = true;
            row.push({
              date: dates[dateIndex]!,
              siteName,
              status,
              confidence: status === 'unknown' ? 'low' : 'high',
            });
          });

          foundRow = row;
          return false; // break .each()
        }
      });

      if (foundRow) {
        sitesFound.push(siteName);
        siteRows.push(foundRow);
      } else {
        sitesMissing.push(siteName);
        siteRows.push([]); // keep index aligned with acceptableSites
      }
    }

    return {
      campgroundName: target.campgroundName,
      bookingUrl,
      dates,
      siteRows,
      hasUnknownStatuses,
      sitesFound,
      sitesMissing,
    };
  } catch (err) {
    console.error('Parser error:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Candidate evaluation — exported for tests
// ---------------------------------------------------------------------------

export function evaluateCandidate(
  candidate: ScanCandidate,
  parsed: ParsedCampground,
  acceptableSites: string[]
): CandidateEvaluation {
  // Build the set of required dates (arrival + subsequent nights, NOT checkout)
  const requiredDates: string[] = [];
  let cur = dayjs(candidate.arrivalDate);
  for (let i = 0; i < candidate.nights; i++) {
    requiredDates.push(cur.format('YYYY-MM-DD'));
    cur = cur.add(1, 'day');
  }

  const statusBySite = new Map<string, DailySiteStatus[]>();
  const hits: AvailabilityHit[] = [];

  for (let i = 0; i < acceptableSites.length; i++) {
    const siteName = acceptableSites[i]!;
    const row = parsed.siteRows[i] ?? [];
    const relevant = row.filter((ds) => requiredDates.includes(ds.date));
    statusBySite.set(siteName, relevant);

    // MATCH only when every required date has an explicit 'available' status
    const allAvailable =
      relevant.length === requiredDates.length &&
      relevant.every((ds) => ds.status === 'available');

    if (allAvailable) {
      hits.push({ siteName, status: 'Available', confidence: 'high' });
    }
  }

  return { isMATCH: hits.length > 0, hits, statusBySite };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseHeaderDate(text: string): string | null {
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m && m[1] && m[2] && m[3]) {
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

function classifyCell(
  cell: ReturnType<ReturnType<typeof load>>
): AvailabilityStatus {
  const tdClass = (cell.attr('class') as string | undefined) ?? '';
  const span = cell.find('span');
  const spanClass = (span.attr('class') as string | undefined) ?? '';
  const title = (span.attr('title') as string | undefined) ?? '';

  if (
    tdClass.includes('availability') ||
    spanClass.includes('fa-check') ||
    title.includes('Available')
  ) {
    return 'available';
  }

  if (
    tdClass.includes('unavailable') ||
    spanClass.includes('fa-xmark') ||
    spanClass.includes('fa-times') ||
    title.includes('Uavailable') ||
    title.includes('Unavailable')
  ) {
    return 'unavailable';
  }

  return 'unknown';
}
