import { load } from 'cheerio';

export type AvailabilityStatus = 'available' | 'unavailable' | 'unknown';

export interface AllAvailabilitySite {
  name: string;
  /** YYYY-MM-DD → status for every date column returned by the page */
  dates: Record<string, 'available' | 'unavailable' | 'unknown'>;
}

export interface AllAvailabilityCampground {
  name: string;
  bookingUrl: string;
  sites: AllAvailabilitySite[];
}

/**
 * Returns true when the API responded with a "fully booked" summary card
 * (div.card with "Availability: No") rather than a per-site table.
 * Distinguishes genuine "no sites open" from unexpected landing pages / errors.
 */
export function isNoAvailabilityPage(html: string): boolean {
  return (
    !html.includes('<section class="card">') &&
    /Availability:\s*<strong><span[^>]*class="text-danger"/.test(html)
  );
}

export function parseAllAvailability(html: string): AllAvailabilityCampground[] {
  try {
    const $ = load(html);
    const campgrounds: AllAvailabilityCampground[] = [];

    $('section.card').each((_i, sectionEl) => {
      const section = $(sectionEl);
      const name = section.find('header.card-header h4').text().trim();
      if (!name) return;

      const bookingUrl =
        (section.find('header.card-header a').first().attr('href') as string | undefined) ?? '';

      // Date columns
      const headerCells = section.find('table thead tr th').slice(1);
      const dates: string[] = [];
      headerCells.each((j) => {
        const parsed = parseHeaderDate(headerCells.eq(j).text().trim());
        if (parsed) dates.push(parsed);
      });
      if (dates.length === 0) return;

      // All site rows
      const sites: AllAvailabilitySite[] = [];
      section.find('tbody tr').each((_j, trEl) => {
        const tr = $(trEl);
        const siteName = tr.find('td.unit-name').text().trim();
        if (!siteName) return;

        const dateMap: Record<string, 'available' | 'unavailable' | 'unknown'> = {};
        const cells = tr.find('td').slice(1);
        cells.each((dateIndex) => {
          if (dateIndex >= dates.length) return;
          dateMap[dates[dateIndex]!] = classifyCell(cells.eq(dateIndex));
        });

        sites.push({ name: siteName, dates: dateMap });
      });

      if (sites.length > 0) campgrounds.push({ name, bookingUrl, sites });
    });

    return campgrounds;
  } catch (err) {
    console.error('parseAllAvailability error:', err instanceof Error ? err.message : err);
    return [];
  }
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
