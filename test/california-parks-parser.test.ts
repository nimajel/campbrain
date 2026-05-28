import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseAvailabilityHtml,
  evaluateCandidate,
} from '../src/providers/california-parks-parser.js';
import type { Target } from '../src/config/schemas.js';
import type { ScanCandidate } from '../src/types/scanner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(filename: string): string {
  return readFileSync(join(__dirname, 'fixtures', filename), 'utf-8');
}

// Minimal Target fixture for the Ridge campground
const ridgeTarget: Target = {
  id: 'angel-island-ridge-weekends',
  name: 'Angel Island Ridge weekends',
  provider: 'california-parks',
  parkName: 'Angel Island SP',
  parkPageId: '468',
  campgroundName: 'Ridge (sites 4-6)',
  acceptableSites: [
    'Hike in Campsite #4',
    'Hike in Campsite #5',
    'Hike in Campsite #6',
  ],
  preferredSites: [
    'Hike in Campsite #5',
    'Hike in Campsite #4',
    'Hike in Campsite #6',
  ],
  campingType: 'hike-in',
  people: 2,
  dateMode: 'weekend_range',
  rangeStart: '2026-06-01',
  rangeEnd: '2026-10-31',
  minNights: 1,
  maxNights: 2,
  weekendsOnly: true,
  bookingRule: {
    type: 'rolling_months_before',
    monthsBefore: 6,
    releaseTime: '08:00',
    timezone: 'America/Los_Angeles',
  },
};

// ---------------------------------------------------------------------------
// Fixture tests (angel-island-ridge-2026-08-14-2n.html)
// ---------------------------------------------------------------------------

describe('parseAvailabilityHtml — fixture 2026-08-14 2N', () => {
  const html = loadFixture('angel-island-ridge-2026-08-14-2n.html');

  it('finds the Ridge section', () => {
    const result = parseAvailabilityHtml(html, ridgeTarget);
    expect(result).not.toBeNull();
    expect(result!.campgroundName).toBe('Ridge (sites 4-6)');
  });

  it('extracts the ReserveCalifornia booking URL', () => {
    const result = parseAvailabilityHtml(html, ridgeTarget)!;
    expect(result.bookingUrl).toMatch(/^https:\/\/reservecalifornia\.com/);
    expect(result.bookingUrl).toContain('/park/614/408');
  });

  it('parses 8 date columns starting from 2026-08-14', () => {
    const result = parseAvailabilityHtml(html, ridgeTarget)!;
    expect(result.dates).toHaveLength(8);
    expect(result.dates[0]).toBe('2026-08-14');
    expect(result.dates[1]).toBe('2026-08-15');
    expect(result.dates[7]).toBe('2026-08-21');
  });

  it('finds all three target sites', () => {
    const result = parseAvailabilityHtml(html, ridgeTarget)!;
    expect(result.sitesFound).toContain('Hike in Campsite #4');
    expect(result.sitesFound).toContain('Hike in Campsite #5');
    expect(result.sitesFound).toContain('Hike in Campsite #6');
    expect(result.sitesMissing).toHaveLength(0);
  });

  it('classifies all Ridge cells as unavailable', () => {
    const result = parseAvailabilityHtml(html, ridgeTarget)!;
    for (const row of result.siteRows) {
      for (const ds of row) {
        expect(ds.status).toBe('unavailable');
        expect(ds.confidence).toBe('high');
      }
    }
  });

  it('returns zero hits for 2-night candidate (all sites unavailable)', () => {
    const result = parseAvailabilityHtml(html, ridgeTarget)!;
    const candidate: ScanCandidate = {
      arrivalDate: '2026-08-14',
      nights: 2,
      endDate: '2026-08-16',
    };
    const eval_ = evaluateCandidate(candidate, result, ridgeTarget.acceptableSites);
    expect(eval_.isMATCH).toBe(false);
    expect(eval_.hits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Returns null for unknown campground
// ---------------------------------------------------------------------------

describe('parseAvailabilityHtml — wrong campground name', () => {
  it('returns null when the campground section cannot be found', () => {
    const html = loadFixture('angel-island-ridge-2026-08-14-2n.html');
    const target: Target = { ...ridgeTarget, campgroundName: 'Does Not Exist' };
    expect(parseAvailabilityHtml(html, target)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Synthetic HTML fixtures — match logic
// ---------------------------------------------------------------------------

function buildSyntheticHtml(cellsByRow: Record<string, string[]>): string {
  const dates = ['8/14/2026', '8/15/2026', '8/16/2026'];
  const ths = dates.map((d) => `<th>${d}</th>`).join('');

  const rows = Object.entries(cellsByRow)
    .map(([site, cells]) => {
      const tds = cells
        .map((cls) => {
          if (cls === 'available') {
            return `<td class="availability"><a href="#"><span class="text-success fa fa-check" title="Available"></span></a></td>`;
          }
          if (cls === 'unavailable') {
            return `<td class="unavailable"><span class="text-secondary fa-solid fa-xmark" title="Uavailable"></span></td>`;
          }
          // unknown — empty td, no class signal
          return `<td></td>`;
        })
        .join('');
      return `<tr><td class="unit-name">${site}</td>${tds}</tr>`;
    })
    .join('');

  return `
    <section class="card">
      <header class="card-header">
        <h4 style="display:inline">Ridge (sites 4-6)</h4>
        <a href="https://reservecalifornia.com/park/614/408?date=2026-08-14&night=2">Book</a>
      </header>
      <div class="card-body">
        <table>
          <thead><tr><th>Unit</th>${ths}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

describe('evaluateCandidate — match logic', () => {
  it('returns a MATCH when site #5 is available for both required nights', () => {
    const html = buildSyntheticHtml({
      'Hike in Campsite #4': ['unavailable', 'unavailable', 'unavailable'],
      'Hike in Campsite #5': ['available', 'available', 'unavailable'],
      'Hike in Campsite #6': ['unavailable', 'unavailable', 'unavailable'],
    });

    const result = parseAvailabilityHtml(html, ridgeTarget)!;
    expect(result).not.toBeNull();

    const candidate: ScanCandidate = {
      arrivalDate: '2026-08-14',
      nights: 2,
      endDate: '2026-08-16',
    };
    const eval_ = evaluateCandidate(candidate, result, ridgeTarget.acceptableSites);

    expect(eval_.isMATCH).toBe(true);
    expect(eval_.hits.map((h) => h.siteName)).toContain('Hike in Campsite #5');
  });

  it('does NOT require the checkout day to be available (2-night stay)', () => {
    // nights 0=Aug14, 1=Aug15; checkout=Aug16. Aug16 is 'unavailable'.
    const html = buildSyntheticHtml({
      'Hike in Campsite #5': ['available', 'available', 'unavailable'],
      'Hike in Campsite #4': ['unavailable', 'unavailable', 'unavailable'],
      'Hike in Campsite #6': ['unavailable', 'unavailable', 'unavailable'],
    });

    const result = parseAvailabilityHtml(html, ridgeTarget)!;
    const candidate: ScanCandidate = {
      arrivalDate: '2026-08-14',
      nights: 2,
      endDate: '2026-08-16',
    };
    const eval_ = evaluateCandidate(candidate, result, ridgeTarget.acceptableSites);

    // Site #5 covers Aug14 + Aug15 = MATCH even though Aug16 is unavailable
    expect(eval_.isMATCH).toBe(true);
  });

  it('does NOT match when the second night is unavailable', () => {
    const html = buildSyntheticHtml({
      'Hike in Campsite #5': ['available', 'unavailable', 'available'],
      'Hike in Campsite #4': ['unavailable', 'unavailable', 'unavailable'],
      'Hike in Campsite #6': ['unavailable', 'unavailable', 'unavailable'],
    });

    const result = parseAvailabilityHtml(html, ridgeTarget)!;
    const candidate: ScanCandidate = {
      arrivalDate: '2026-08-14',
      nights: 2,
      endDate: '2026-08-16',
    };
    const eval_ = evaluateCandidate(candidate, result, ridgeTarget.acceptableSites);
    expect(eval_.isMATCH).toBe(false);
  });

  it('handles unknown statuses without crashing', () => {
    const html = buildSyntheticHtml({
      'Hike in Campsite #4': ['unknown', 'unknown', 'unknown'],
      'Hike in Campsite #5': ['unknown', 'available', 'unknown'],
      'Hike in Campsite #6': ['unknown', 'unknown', 'unknown'],
    });

    const result = parseAvailabilityHtml(html, ridgeTarget);
    expect(result).not.toBeNull();
    expect(result!.hasUnknownStatuses).toBe(true);

    const candidate: ScanCandidate = {
      arrivalDate: '2026-08-14',
      nights: 2,
      endDate: '2026-08-16',
    };
    // Should not throw, should return false (unknown != available)
    expect(() =>
      evaluateCandidate(candidate, result!, ridgeTarget.acceptableSites)
    ).not.toThrow();

    const eval_ = evaluateCandidate(candidate, result!, ridgeTarget.acceptableSites);
    expect(eval_.isMATCH).toBe(false);
  });
});
