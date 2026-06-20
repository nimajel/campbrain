import { describe, it, expect } from 'vitest';
import {
  parseAllAvailability,
  isNoAvailabilityPage,
} from './california-parks-parser';

// ---------------------------------------------------------------------------
// Synthetic HTML helpers — no fs/node imports, no fixture files
// ---------------------------------------------------------------------------

function makeCampgroundHtml(opts: {
  name: string;
  bookingUrl: string;
  dates: string[]; // M/D/YYYY format
  rows: Array<{ siteName: string; cells: Array<'available' | 'unavailable' | 'unknown'> }>;
}): string {
  const ths = opts.dates.map((d) => `<th>${d}</th>`).join('');

  const trs = opts.rows
    .map(({ siteName, cells }) => {
      const tds = cells
        .map((status) => {
          if (status === 'available') {
            return `<td class="availability"><span class="fa fa-check" title="Available"></span></td>`;
          }
          if (status === 'unavailable') {
            return `<td class="unavailable"><span class="fa-solid fa-xmark" title="Unavailable"></span></td>`;
          }
          // unknown — no recognized class or title
          return `<td class="other"><span></span></td>`;
        })
        .join('');
      return `<tr><td class="unit-name">${siteName}</td>${tds}</tr>`;
    })
    .join('');

  return `
    <html><body>
    <section class="card">
      <header class="card-header">
        <h4>${opts.name}</h4>
        <a href="${opts.bookingUrl}">Book</a>
      </header>
      <table>
        <thead><tr><th>Unit</th>${ths}</tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </section>
    </body></html>`;
}

// ---------------------------------------------------------------------------
// parseAllAvailability — happy path
// ---------------------------------------------------------------------------

describe('parseAllAvailability', () => {
  const BOOKING_URL = 'https://www.reservecalifornia.com/x';

  it('parses campground name, bookingUrl, and sites', () => {
    const html = makeCampgroundHtml({
      name: 'Ridge Camp',
      bookingUrl: BOOKING_URL,
      dates: ['8/14/2026', '8/15/2026'],
      rows: [
        { siteName: 'Site 1', cells: ['available', 'unavailable'] },
        { siteName: 'Site 2', cells: ['unavailable', 'unavailable'] },
      ],
    });

    const result = parseAllAvailability(html);
    expect(result).toHaveLength(1);
    const cg = result[0]!;
    expect(cg.name).toBe('Ridge Camp');
    expect(cg.bookingUrl).toBe(BOOKING_URL);
    expect(cg.sites).toHaveLength(2);
  });

  it('converts M/D/YYYY header dates to YYYY-MM-DD keys', () => {
    const html = makeCampgroundHtml({
      name: 'Summit Camp',
      bookingUrl: BOOKING_URL,
      dates: ['8/14/2026', '8/15/2026'],
      rows: [{ siteName: 'Site 1', cells: ['available', 'unavailable'] }],
    });

    const result = parseAllAvailability(html);
    const site = result[0]!.sites[0]!;
    expect(Object.keys(site.dates)).toEqual(['2026-08-14', '2026-08-15']);
  });

  it('maps cell classes to correct availability statuses', () => {
    const html = makeCampgroundHtml({
      name: 'Lake Camp',
      bookingUrl: BOOKING_URL,
      dates: ['8/14/2026', '8/15/2026', '8/16/2026'],
      rows: [
        { siteName: 'Site 1', cells: ['available', 'unavailable', 'unknown'] },
      ],
    });

    const result = parseAllAvailability(html);
    const dates = result[0]!.sites[0]!.dates;
    expect(dates['2026-08-14']).toBe('available');
    expect(dates['2026-08-15']).toBe('unavailable');
    expect(dates['2026-08-16']).toBe('unknown');
  });

  it('handles multiple campgrounds in one page', () => {
    const html1 = makeCampgroundHtml({
      name: 'Camp A',
      bookingUrl: BOOKING_URL,
      dates: ['8/14/2026'],
      rows: [{ siteName: 'Site 1', cells: ['available'] }],
    });
    const html2 = makeCampgroundHtml({
      name: 'Camp B',
      bookingUrl: BOOKING_URL,
      dates: ['8/14/2026'],
      rows: [{ siteName: 'Site 2', cells: ['unavailable'] }],
    });
    // Merge the two sections into one page
    const html = `<html><body>${html1.replace(/<html><body>/, '').replace(/<\/body><\/html>/, '')}${html2.replace(/<html><body>/, '').replace(/<\/body><\/html>/, '')}</body></html>`;

    const result = parseAllAvailability(html);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('Camp A');
    expect(result[1]!.name).toBe('Camp B');
  });

  it('returns [] for HTML with no section.card', () => {
    const result = parseAllAvailability('<html><body>garbage</body></html>');
    expect(result).toEqual([]);
  });

  it('returns [] for empty string', () => {
    const result = parseAllAvailability('');
    expect(result).toEqual([]);
  });

  it('skips rows with empty site names', () => {
    // A row with no td.unit-name text should be ignored
    const html = `
      <html><body>
      <section class="card">
        <header class="card-header">
          <h4>Empty Row Camp</h4>
          <a href="${BOOKING_URL}">Book</a>
        </header>
        <table>
          <thead><tr><th>Unit</th><th>8/14/2026</th></tr></thead>
          <tbody>
            <tr><td class="unit-name"></td><td class="availability"></td></tr>
            <tr><td class="unit-name">Real Site</td><td class="availability"><span class="fa fa-check" title="Available"></span></td></tr>
          </tbody>
        </table>
      </section>
      </body></html>`;
    const result = parseAllAvailability(html);
    expect(result[0]!.sites).toHaveLength(1);
    expect(result[0]!.sites[0]!.name).toBe('Real Site');
  });

  it('classifies fa-check span as available even when td class is generic', () => {
    const html = `
      <html><body>
      <section class="card">
        <header class="card-header">
          <h4>Check Span Camp</h4>
          <a href="${BOOKING_URL}">Book</a>
        </header>
        <table>
          <thead><tr><th>Unit</th><th>8/14/2026</th></tr></thead>
          <tbody>
            <tr><td class="unit-name">Site A</td><td class="generic"><span class="fa fa-check"></span></td></tr>
          </tbody>
        </table>
      </section>
      </body></html>`;
    const result = parseAllAvailability(html);
    expect(result[0]!.sites[0]!.dates['2026-08-14']).toBe('available');
  });
});

// ---------------------------------------------------------------------------
// isNoAvailabilityPage
// ---------------------------------------------------------------------------

describe('isNoAvailabilityPage', () => {
  const NO_AVAILABILITY_HTML = `
    <html><body>
      <div class="card">
        Availability: <strong><span class="text-danger">No</span></strong>
      </div>
    </body></html>`;

  const AVAILABILITY_HTML = makeCampgroundHtml({
    name: 'Ridge Camp',
    bookingUrl: 'https://www.reservecalifornia.com/x',
    dates: ['8/14/2026'],
    rows: [{ siteName: 'Site 1', cells: ['available'] }],
  });

  it('returns true for a fully-booked "Availability: No" page', () => {
    expect(isNoAvailabilityPage(NO_AVAILABILITY_HTML)).toBe(true);
  });

  it('returns false for a page with section.card campground tables', () => {
    expect(isNoAvailabilityPage(AVAILABILITY_HTML)).toBe(false);
  });

  it('returns false for an arbitrary page with no availability signal', () => {
    expect(isNoAvailabilityPage('<html><body><p>Hello</p></body></html>')).toBe(false);
  });

  it('returns false when section.card is present even if text-danger also appears', () => {
    const mixed = `
      <html><body>
      <section class="card"><header class="card-header"><h4>X</h4></header></section>
      Availability: <strong><span class="text-danger">No</span></strong>
      </body></html>`;
    expect(isNoAvailabilityPage(mixed)).toBe(false);
  });
});
