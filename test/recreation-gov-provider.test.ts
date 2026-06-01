import { describe, it, expect } from 'vitest';
import {
  buildAvailabilityUrl,
  buildBookingUrl,
  monthStartForDate,
  evaluateRecGovCandidate,
  type RecGovAvailabilityResponse,
} from '../src/providers/recreation-gov-provider.js';
import type { ScanCandidate } from '../src/types/scanner.js';

// ---------------------------------------------------------------------------
// buildAvailabilityUrl
// ---------------------------------------------------------------------------

describe('buildAvailabilityUrl', () => {
  it('uses the provided campgroundId in the URL', () => {
    const url = buildAvailabilityUrl('999', '2026-08-01');
    expect(url).toContain('/campground/999/');
  });

  it('does not hardcode any specific campground ID', () => {
    const url = buildAvailabilityUrl('999', '2026-08-01');
    expect(url).not.toContain('/campground/232447/');
  });

  it('uses the correct endpoint base URL', () => {
    const url = buildAvailabilityUrl('232447', '2026-08-01');
    expect(url).toMatch(/^https:\/\/www\.recreation\.gov\/api\/camps\/availability\/campground\//);
  });

  it('sets the month start date in the query string', () => {
    const url = buildAvailabilityUrl('232447', '2026-08-01');
    expect(url).toContain('start_date=2026-08-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// buildBookingUrl
// ---------------------------------------------------------------------------

describe('buildBookingUrl', () => {
  it('returns a recreation.gov campground URL', () => {
    const url = buildBookingUrl('232447');
    expect(url).toBe('https://www.recreation.gov/camping/campgrounds/232447');
  });
});

// ---------------------------------------------------------------------------
// monthStartForDate
// ---------------------------------------------------------------------------

describe('monthStartForDate', () => {
  it('returns the first of the month for a mid-month date', () => {
    expect(monthStartForDate('2026-08-14')).toBe('2026-08-01');
  });

  it('returns the same day for the first of the month', () => {
    expect(monthStartForDate('2026-06-01')).toBe('2026-06-01');
  });
});

// ---------------------------------------------------------------------------
// Synthetic response builder — analogous to buildSyntheticHtml in provider.test.ts
// ---------------------------------------------------------------------------

function buildSyntheticResponse(
  siteAvailability: Record<string, Record<string, 'Available' | 'Reserved'>>
): RecGovAvailabilityResponse {
  const campsites: RecGovAvailabilityResponse['campsites'] = {};
  let id = 1;
  for (const [siteName, availability] of Object.entries(siteAvailability)) {
    const campsiteId = String(id++);
    const availabilities: Record<string, string> = {};
    for (const [date, status] of Object.entries(availability)) {
      availabilities[`${date}T00:00:00Z`] = status;
    }
    campsites[campsiteId] = {
      availabilities,
      campsite_id: campsiteId,
      loop: 'MAIN',
      site: siteName,
      type_of_use: 'Overnight',
      max_num_people: 8,
      min_num_people: 1,
    };
  }
  return { campsites, count: Object.keys(campsites).length };
}

// ---------------------------------------------------------------------------
// evaluateRecGovCandidate
// ---------------------------------------------------------------------------

describe('evaluateRecGovCandidate — matches available sites', () => {
  it('returns a hit when a site is available for all required nights', () => {
    const response = buildSyntheticResponse({
      '001': { '2026-08-14': 'Available', '2026-08-15': 'Available' },
      '002': { '2026-08-14': 'Reserved', '2026-08-15': 'Reserved' },
    });
    const monthData = new Map([['2026-08-01', response]]);
    const candidate: ScanCandidate = { arrivalDate: '2026-08-14', nights: 2, endDate: '2026-08-16' };

    const hits = evaluateRecGovCandidate(monthData, candidate, ['001', '002']);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.siteName).toBe('001');
  });

  it('returns no hits when all sites are reserved', () => {
    const response = buildSyntheticResponse({
      '001': { '2026-08-14': 'Reserved', '2026-08-15': 'Reserved' },
    });
    const monthData = new Map([['2026-08-01', response]]);
    const candidate: ScanCandidate = { arrivalDate: '2026-08-14', nights: 2, endDate: '2026-08-16' };

    const hits = evaluateRecGovCandidate(monthData, candidate, ['001']);
    expect(hits).toHaveLength(0);
  });

  it('does not match sites that are not in acceptableSites even if available', () => {
    const response = buildSyntheticResponse({
      '001': { '2026-08-14': 'Available', '2026-08-15': 'Available' },
    });
    const monthData = new Map([['2026-08-01', response]]);
    const candidate: ScanCandidate = { arrivalDate: '2026-08-14', nights: 2, endDate: '2026-08-16' };

    // '002' is acceptable but not in response — '001' is available but not acceptable
    const hits = evaluateRecGovCandidate(monthData, candidate, ['002']);
    expect(hits).toHaveLength(0);
  });

  it('requires ALL nights to be available for a match', () => {
    const response = buildSyntheticResponse({
      '001': { '2026-08-14': 'Available', '2026-08-15': 'Reserved' },
    });
    const monthData = new Map([['2026-08-01', response]]);
    const candidate: ScanCandidate = { arrivalDate: '2026-08-14', nights: 2, endDate: '2026-08-16' };

    const hits = evaluateRecGovCandidate(monthData, candidate, ['001']);
    expect(hits).toHaveLength(0);
  });

  it('matches multiple available sites and returns all of them', () => {
    const response = buildSyntheticResponse({
      'A1': { '2026-08-14': 'Available', '2026-08-15': 'Available' },
      'A2': { '2026-08-14': 'Available', '2026-08-15': 'Available' },
      'A3': { '2026-08-14': 'Reserved', '2026-08-15': 'Available' },
    });
    const monthData = new Map([['2026-08-01', response]]);
    const candidate: ScanCandidate = { arrivalDate: '2026-08-14', nights: 2, endDate: '2026-08-16' };

    const hits = evaluateRecGovCandidate(monthData, candidate, ['A1', 'A2', 'A3']);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.siteName)).toEqual(expect.arrayContaining(['A1', 'A2']));
  });

  it('merges availability from multiple months for a stay spanning month boundary', () => {
    const juneResponse = buildSyntheticResponse({
      '001': { '2026-06-30': 'Available' },
    });
    const julyResponse = buildSyntheticResponse({
      '001': { '2026-07-01': 'Available' },
    });
    const monthData = new Map([
      ['2026-06-01', juneResponse],
      ['2026-07-01', julyResponse],
    ]);
    const candidate: ScanCandidate = { arrivalDate: '2026-06-30', nights: 2, endDate: '2026-07-02' };

    const hits = evaluateRecGovCandidate(monthData, candidate, ['001']);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.siteName).toBe('001');
  });

  it('hits have confidence: high', () => {
    const response = buildSyntheticResponse({
      '001': { '2026-08-14': 'Available' },
    });
    const monthData = new Map([['2026-08-01', response]]);
    const candidate: ScanCandidate = { arrivalDate: '2026-08-14', nights: 1, endDate: '2026-08-15' };

    const hits = evaluateRecGovCandidate(monthData, candidate, ['001']);
    expect(hits[0]?.confidence).toBe('high');
  });
});
