import { describe, it, expect, vi } from 'vitest';
import {
  buildAvailabilityUrl,
  buildBookingUrl,
  monthStartForDate,
  evaluateRecGovCandidate,
  RecreationGovProvider,
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

// ---------------------------------------------------------------------------
// generateCacheWindows
// ---------------------------------------------------------------------------

describe('RecreationGovProvider.generateCacheWindows', () => {
  const provider = new RecreationGovProvider();

  it('returns one window per calendar month spanning the range', () => {
    const windows = provider.generateCacheWindows('2026-07-01', '2026-09-15');
    expect(windows.map((w) => w.windowStart)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
  });

  it('window starts on the 1st of each month', () => {
    const windows = provider.generateCacheWindows('2026-08-15', '2026-09-05');
    expect(windows.every((w) => w.windowStart.endsWith('-01'))).toBe(true);
  });

  it('window ends on the last day of each month', () => {
    const windows = provider.generateCacheWindows('2026-06-10', '2026-07-20');
    const juneWindow = windows.find((w) => w.windowStart === '2026-06-01');
    expect(juneWindow?.windowEnd).toBe('2026-06-30');
    const julyWindow = windows.find((w) => w.windowStart === '2026-07-01');
    expect(julyWindow?.windowEnd).toBe('2026-07-31');
  });

  it('covers a 180-day lookahead without gaps', () => {
    const windows = provider.generateCacheWindows('2026-06-04', '2026-12-01');
    expect(windows.map((w) => w.windowStart)).toContain('2026-06-01');
    expect(windows.map((w) => w.windowStart)).toContain('2026-12-01');
  });
});

// ---------------------------------------------------------------------------
// proactiveScanWindow — mock fetch
// ---------------------------------------------------------------------------

function makeMockResponse(
  siteData: Record<string, Record<string, 'Available' | 'Reserved'>>
): RecGovAvailabilityResponse {
  const campsites: RecGovAvailabilityResponse['campsites'] = {};
  let id = 1;
  for (const [siteName, avail] of Object.entries(siteData)) {
    const campsite_id = String(id++);
    const availabilities: Record<string, string> = {};
    for (const [date, status] of Object.entries(avail)) {
      availabilities[`${date}T00:00:00Z`] = status;
    }
    campsites[campsite_id] = {
      availabilities,
      campsite_id,
      loop: 'MAIN',
      site: siteName,
      type_of_use: 'Overnight',
      max_num_people: 6,
      min_num_people: 1,
    };
  }
  return { campsites, count: Object.keys(campsites).length };
}

describe('RecreationGovProvider.proactiveScanWindow', () => {
  const provider = new RecreationGovProvider();

  it('returns null when fetch fails', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as typeof fetch;
    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );
    expect(result).toBeNull();
    global.fetch = originalFetch;
  });

  it('returns null on non-ok HTTP response (non-429)', async () => {
    // Use 503 so we don't trigger the 429 retry loop
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as typeof fetch;
    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );
    expect(result).toBeNull();
    global.fetch = originalFetch;
  });

  it('retries on 429 then succeeds', async () => {
    const mockResponse = makeMockResponse({ 'A01': { '2026-07-04': 'Available' } });
    const originalFetch = global.fetch;
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { ok: false, status: 429 };
      return { ok: true, json: async () => mockResponse };
    }) as typeof fetch;

    // Use zero delays so the test runs instantly
    const result = await provider.fetchWithRetry(
      'https://www.recreation.gov/api/camps/availability/campground/232447/month?start_date=2026-07-01T00:00:00.000Z',
      'Upper Pines',
      '2026-07-01',
      [0, 0, 0]
    );

    expect(callCount).toBe(2);
    expect(result).not.toBeNull();
    expect(result!.count).toBeDefined();
    global.fetch = originalFetch;
  });

  it('returns an AvailabilityWindowEntry with correct shape on success', async () => {
    const mockResponse = makeMockResponse({
      'A01': { '2026-07-04': 'Available', '2026-07-05': 'Reserved' },
      'A02': { '2026-07-04': 'Available', '2026-07-05': 'Available' },
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as typeof fetch;

    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );

    expect(result).not.toBeNull();
    expect(result!.parkPageId).toBe('232447');
    expect(result!.parkName).toBe('Upper Pines');
    expect(result!.windowStart).toBe('2026-07-01');
    expect(result!.windowEnd).toBe('2026-07-31');
    expect(result!.campgrounds).toHaveLength(1);

    const sites = result!.campgrounds[0]!.sites;
    expect(sites.some((s) => s.name === 'A01')).toBe(true);
    expect(sites.some((s) => s.name === 'A02')).toBe(true);

    const a01 = sites.find((s) => s.name === 'A01')!;
    expect(a01.dates['2026-07-04']).toBe('available');
    expect(a01.dates['2026-07-05']).toBe('unavailable');

    global.fetch = originalFetch;
  });

  it('returns empty campgrounds array when API response has no campsites', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ campsites: {}, count: 0 }),
    }) as typeof fetch;

    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );

    expect(result).not.toBeNull();
    expect(result!.campgrounds).toHaveLength(0);
    global.fetch = originalFetch;
  });
});
