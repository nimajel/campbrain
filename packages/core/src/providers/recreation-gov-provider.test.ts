import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildAvailabilityUrl,
  buildBookingUrl,
  monthStartForDate,
  RecreationGovProvider,
  type RecGovAvailabilityResponse,
} from './recreation-gov-provider';

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
    expect(url).toContain('start_date=2026-08-01T00%3A00%3A00.000Z');
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
  siteData: Record<string, Record<string, 'Available' | 'Reserved'>>,
  campsiteTypes: Record<string, string> = {}
): RecGovAvailabilityResponse {
  const campsites: RecGovAvailabilityResponse['campsites'] = {};
  let id = 1;
  for (const [siteName, avail] of Object.entries(siteData)) {
    const campsite_id = String(id++);
    const availabilities: Record<string, string> = {};
    for (const [date, status] of Object.entries(avail)) {
      availabilities[`${date}T00:00:00Z`] = status;
    }
    const campsiteType = campsiteTypes[siteName];
    campsites[campsite_id] = {
      availabilities,
      campsite_id,
      loop: 'MAIN',
      site: siteName,
      type_of_use: 'Overnight',
      max_num_people: 6,
      min_num_people: 1,
      ...(campsiteType !== undefined ? { campsite_type: campsiteType } : {}),
    };
  }
  return { campsites, count: Object.keys(campsites).length };
}

describe('RecreationGovProvider.proactiveScanWindow', () => {
  const provider = new RecreationGovProvider();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when fetch fails (network reject)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );
    expect(result).toBeNull();
  });

  it('returns null on non-ok HTTP response (non-429, e.g. 503)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );
    expect(result).toBeNull();
  });

  it("returns 'unsupported' on 400", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );
    expect(result).toBe('unsupported');
  });

  it("returns 'unsupported' on 404", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );
    expect(result).toBe('unsupported');
  });

  it('retries on 429 then succeeds', async () => {
    const mockResponse = makeMockResponse({ A01: { '2026-07-04': 'Available' } });
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { ok: false, status: 429 };
        return { ok: true, json: async () => mockResponse };
      })
    );

    // Zero delays so the test runs instantly — no real waits.
    const result = await provider.fetchWithRetry(
      'https://www.recreation.gov/api/camps/availability/campground/232447/month?start_date=2026-07-01T00:00:00.000Z',
      'Upper Pines',
      '2026-07-01',
      [0, 0, 0]
    );

    expect(callCount).toBe(2);
    expect(result).not.toBeNull();
    expect(result).not.toBe('unsupported');
    if (result && result !== 'unsupported') expect(result.count).toBeDefined();
  });

  it('returns an AvailabilityWindowEntry with correct shape on success', async () => {
    const mockResponse = makeMockResponse({
      A01: { '2026-07-04': 'Available', '2026-07-05': 'Reserved' },
      A02: { '2026-07-04': 'Available', '2026-07-05': 'Available' },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })
    );

    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );

    if (!result || result === 'unsupported') throw new Error('Expected entry');
    expect(result.parkPageId).toBe('232447');
    expect(result.parkName).toBe('Upper Pines');
    expect(result.windowStart).toBe('2026-07-01');
    expect(result.windowEnd).toBe('2026-07-31');
    expect(result.campgrounds).toHaveLength(1);

    const sites = result.campgrounds[0]!.sites;
    expect(sites.some((s) => s.name === 'A01')).toBe(true);
    expect(sites.some((s) => s.name === 'A02')).toBe(true);

    const a01 = sites.find((s) => s.name === 'A01')!;
    expect(a01.dates['2026-07-04']).toBe('available');
    expect(a01.dates['2026-07-05']).toBe('unavailable');
  });

  it('clips dates to the [windowStart, windowEnd] range', async () => {
    const mockResponse = makeMockResponse({
      A01: {
        '2026-06-30': 'Available', // before windowStart — must be dropped
        '2026-07-04': 'Available',
        '2026-08-01': 'Available', // after windowEnd — must be dropped
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })
    );

    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );

    if (!result || result === 'unsupported') throw new Error('Expected entry');
    const a01 = result.campgrounds[0]!.sites.find((s) => s.name === 'A01')!;
    expect(Object.keys(a01.dates)).toEqual(['2026-07-04']);
  });

  it('passes through recGovCampsiteType when present', async () => {
    const mockResponse = makeMockResponse(
      { A01: { '2026-07-04': 'Available' } },
      { A01: 'STANDARD NONELECTRIC' }
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })
    );

    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );

    if (!result || result === 'unsupported') throw new Error('Expected entry');
    const sites = result.campgrounds[0]!.sites;
    expect(sites[0]?.recGovCampsiteType).toBe('STANDARD NONELECTRIC');
  });

  it('returns empty campgrounds array when API response has no campsites', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ campsites: {}, count: 0 }),
      })
    );

    const result = await provider.proactiveScanWindow(
      '232447',
      { windowStart: '2026-07-01', windowEnd: '2026-07-31' },
      'Upper Pines',
      []
    );

    expect(result).not.toBeNull();
    expect(result).not.toBe('unsupported');
    if (!result || result === 'unsupported') throw new Error('Expected entry');
    expect(result.campgrounds).toHaveLength(0);
  });
});
