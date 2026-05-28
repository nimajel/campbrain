import { describe, it, expect } from 'vitest';
import {
  buildAvailabilityUrl,
} from '../src/providers/california-parks-provider.js';
import {
  parseAvailabilityHtml,
  evaluateCandidate,
} from '../src/providers/california-parks-parser.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Target } from '../src/config/schemas.js';
import type { ScanCandidate } from '../src/types/scanner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(filename: string): string {
  return readFileSync(join(__dirname, 'fixtures', filename), 'utf-8');
}

const bookingRule = {
  type: 'rolling_months_before' as const,
  monthsBefore: 6,
  releaseTime: '08:00',
  timezone: 'America/Los_Angeles',
};

// ---------------------------------------------------------------------------
// buildAvailabilityUrl — uses target.parkPageId, not hardcoded 468
// ---------------------------------------------------------------------------

describe('buildAvailabilityUrl', () => {
  const candidate: ScanCandidate = {
    arrivalDate: '2026-08-14',
    nights: 2,
    endDate: '2026-08-16',
  };

  it('uses the provided parkPageId in the URL', () => {
    const url = buildAvailabilityUrl('999', candidate);
    expect(url).toContain('page_id=999');
  });

  it('does not hardcode page_id 468', () => {
    const url = buildAvailabilityUrl('999', candidate);
    expect(url).not.toContain('page_id=468');
  });

  it('uses the correct endpoint base URL', () => {
    const url = buildAvailabilityUrl('468', candidate);
    expect(url).toMatch(/^https:\/\/www\.parks\.ca\.gov\/AvailabilityInfo/);
  });

  it('sets arrival_date from the candidate', () => {
    const url = buildAvailabilityUrl('468', candidate);
    expect(url).toContain('arrival_date=2026-08-14');
  });

  it('sets length from the candidate nights', () => {
    const url = buildAvailabilityUrl('468', candidate);
    expect(url).toContain('length=2');
  });
});

// ---------------------------------------------------------------------------
// parseAvailabilityHtml — uses target.campgroundName, not hardcoded Ridge
// ---------------------------------------------------------------------------

describe('parseAvailabilityHtml — uses target.campgroundName', () => {
  const html = loadFixture('angel-island-ridge-2026-08-14-2n.html');

  it('finds the campground by target.campgroundName', () => {
    const target: Target = {
      id: 'test',
      name: 'Test',
      provider: 'california-parks',
      parkName: 'Angel Island SP',
      parkPageId: '468',
      campgroundName: 'Ridge (sites 4-6)',
      acceptableSites: ['Hike in Campsite #4'],
      preferredSites: [],
      campingType: 'hike-in',
      people: 2,
      dateMode: 'next_available_weekend',
      minNights: 1,
      maxNights: 2,
      weekendsOnly: true,
      bookingRule,
    };
    expect(parseAvailabilityHtml(html, target)).not.toBeNull();
  });

  it('returns null when campgroundName does not match anything in the page', () => {
    const target: Target = {
      id: 'test',
      name: 'Test',
      provider: 'california-parks',
      parkName: 'Some Other Park',
      parkPageId: '999',
      campgroundName: 'Some Other Campground',
      acceptableSites: ['Site A'],
      preferredSites: [],
      campingType: 'drive-to',
      people: 4,
      dateMode: 'next_available_weekend',
      minNights: 1,
      maxNights: 2,
      weekendsOnly: false,
      bookingRule,
    };
    expect(parseAvailabilityHtml(html, target)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// evaluateCandidate — uses provided acceptableSites, not hardcoded #4-#6
// ---------------------------------------------------------------------------

function buildSyntheticHtml(campgroundName: string, cellsByRow: Record<string, string[]>): string {
  const dates = ['8/14/2026', '8/15/2026', '8/16/2026'];
  const ths = dates.map((d) => `<th>${d}</th>`).join('');

  const rows = Object.entries(cellsByRow)
    .map(([site, cells]) => {
      const tds = cells
        .map((cls) =>
          cls === 'available'
            ? `<td class="availability"><span class="fa fa-check" title="Available"></span></td>`
            : `<td class="unavailable"><span class="fa-solid fa-xmark" title="Uavailable"></span></td>`
        )
        .join('');
      return `<tr><td class="unit-name">${site}</td>${tds}</tr>`;
    })
    .join('');

  return `
    <section class="card">
      <header class="card-header">
        <h4 style="display:inline">${campgroundName}</h4>
        <a href="https://reservecalifornia.com/park/100/200">Book</a>
      </header>
      <div class="card-body">
        <table>
          <thead><tr><th>Unit</th>${ths}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

describe('evaluateCandidate — uses provided acceptableSites', () => {
  it('matches against custom site names, not hardcoded Ridge sites', () => {
    const campgroundName = 'Sunset Campground';
    const html = buildSyntheticHtml(campgroundName, {
      'Campsite A': ['available', 'available', 'unavailable'],
      'Campsite B': ['unavailable', 'unavailable', 'unavailable'],
    });

    const target: Target = {
      id: 'custom',
      name: 'Custom Target',
      provider: 'california-parks',
      parkName: 'Custom Park',
      parkPageId: '777',
      campgroundName,
      acceptableSites: ['Campsite A', 'Campsite B'],
      preferredSites: [],
      campingType: 'drive-to',
      people: 4,
      dateMode: 'next_available_weekend',
      minNights: 1,
      maxNights: 2,
      weekendsOnly: false,
      bookingRule,
    };

    const parsed = parseAvailabilityHtml(html, target);
    expect(parsed).not.toBeNull();

    const candidate: ScanCandidate = {
      arrivalDate: '2026-08-14',
      nights: 2,
      endDate: '2026-08-16',
    };

    const result = evaluateCandidate(candidate, parsed!, ['Campsite A', 'Campsite B']);
    expect(result.isMATCH).toBe(true);
    expect(result.hits[0]?.siteName).toBe('Campsite A');
  });

  it('does not match sites that are not in acceptableSites even if available', () => {
    const campgroundName = 'Forest Camp';
    const html = buildSyntheticHtml(campgroundName, {
      'Campsite X': ['available', 'available', 'available'],
    });

    const target: Target = {
      id: 'test2',
      name: 'Test 2',
      provider: 'california-parks',
      parkName: 'Forest Park',
      parkPageId: '555',
      campgroundName,
      acceptableSites: ['Campsite Y'], // X is NOT in acceptable sites
      preferredSites: [],
      campingType: 'hike-in',
      people: 2,
      dateMode: 'next_available_weekend',
      minNights: 1,
      maxNights: 2,
      weekendsOnly: true,
      bookingRule,
    };

    const parsed = parseAvailabilityHtml(html, target);
    expect(parsed).not.toBeNull();

    const candidate: ScanCandidate = {
      arrivalDate: '2026-08-14',
      nights: 1,
      endDate: '2026-08-15',
    };

    const result = evaluateCandidate(candidate, parsed!, target.acceptableSites);
    expect(result.isMATCH).toBe(false);
    expect(result.hits).toHaveLength(0);
  });
});
