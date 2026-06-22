import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildAvailabilityUrl, CaliforniaParksProvider } from './california-parks-provider';

// ---------------------------------------------------------------------------
// buildAvailabilityUrl — uses target.parkPageId, not hardcoded 468
// ---------------------------------------------------------------------------

describe('buildAvailabilityUrl', () => {
  const candidate = {
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
// generateCacheWindows — 8-day stepping
// ---------------------------------------------------------------------------

describe('CaliforniaParksProvider.generateCacheWindows', () => {
  const provider = new CaliforniaParksProvider();

  it('produces 8-day windows with correct windowStart and windowEnd', () => {
    // Range: 2026-08-14 to 2026-08-29 (exactly 2 windows of 8 days)
    // Window 1: 2026-08-14 → 2026-08-21 (14 + 7 = 21)
    // Window 2: 2026-08-22 → 2026-08-29 (22 + 7 = 29)
    // Next would be 2026-08-30 which is > rangeEnd so loop stops
    const windows = provider.generateCacheWindows('2026-08-14', '2026-08-29');

    expect(windows).toHaveLength(2);
    expect(windows[0]).toEqual({ windowStart: '2026-08-14', windowEnd: '2026-08-21' });
    expect(windows[1]).toEqual({ windowStart: '2026-08-22', windowEnd: '2026-08-29' });
  });

  it('produces a single window when range fits in one 8-day block', () => {
    // Range: 2026-08-14 to 2026-08-14 (single day → 1 window)
    const windows = provider.generateCacheWindows('2026-08-14', '2026-08-14');
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({ windowStart: '2026-08-14', windowEnd: '2026-08-21' });
  });

  it('steps by exactly WINDOW_DAYS (8) between window starts', () => {
    const windows = provider.generateCacheWindows('2026-09-01', '2026-09-30');
    // Should have 4 windows: 09-01, 09-09, 09-17, 09-25
    expect(windows).toHaveLength(4);
    expect(windows[0]!.windowStart).toBe('2026-09-01');
    expect(windows[1]!.windowStart).toBe('2026-09-09');
    expect(windows[2]!.windowStart).toBe('2026-09-17');
    expect(windows[3]!.windowStart).toBe('2026-09-25');
  });

  it('includes the rangeEnd date in the last window', () => {
    const windows = provider.generateCacheWindows('2026-08-14', '2026-08-22');
    // The loop runs while current <= rangeEnd. After window 1 (starts 2026-08-14), current steps
    // to 2026-08-22 which equals rangeEnd, so a second window is generated (2026-08-22→2026-08-29,
    // extending past rangeEnd). Then current steps to 2026-08-30 > rangeEnd and the loop stops.
    expect(windows.length).toBeGreaterThanOrEqual(2);
    expect(windows[0]).toEqual({ windowStart: '2026-08-14', windowEnd: '2026-08-21' });
    expect(windows[1]).toEqual({ windowStart: '2026-08-22', windowEnd: '2026-08-29' });
  });
});

// ---------------------------------------------------------------------------
// proactiveScanWindow — onUnexpectedHtml hook
// ---------------------------------------------------------------------------

describe('proactiveScanWindow onUnexpectedHtml', () => {
  const UNEXPECTED_HTML = '<html><body><h1>Under Maintenance</h1></body></html>';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls onUnexpectedHtml and returns null when fetch returns an unexpected page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(UNEXPECTED_HTML, { status: 200 }))
    );

    const spy = vi.fn<(html: string, ctx: { parkPageId: string; arrivalDate: string; url: string }) => Promise<void>>(async () => {});
    const provider = new CaliforniaParksProvider();
    const result = await provider.proactiveScanWindow(
      '468',
      { windowStart: '2026-08-14', windowEnd: '2026-08-21' },
      'Test Park',
      [],
      { onUnexpectedHtml: spy }
    );

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
    const firstCall = spy.mock.calls[0];
    expect(firstCall).toBeDefined();
    const htmlArg = firstCall?.[0];
    const ctxArg = firstCall?.[1];
    expect(htmlArg).toBe(UNEXPECTED_HTML);
    expect(ctxArg).toMatchObject({
      parkPageId: '468',
      arrivalDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      url: expect.stringContaining('parks.ca.gov'),
    });
  });

  it('swallows callback errors and still returns null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(UNEXPECTED_HTML, { status: 200 })));
    const provider = new CaliforniaParksProvider();
    const throwing = vi.fn(async () => { throw new Error('disk full'); });
    const result = await provider.proactiveScanWindow(
      '468',
      { windowStart: '2026-08-14', windowEnd: '2026-08-21' },
      'Test Park',
      [],
      { onUnexpectedHtml: throwing }
    );
    expect(result).toBeNull();
    expect(throwing).toHaveBeenCalledOnce();
  });

  it('returns null without throwing when no onUnexpectedHtml callback is provided', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(UNEXPECTED_HTML, { status: 200 }))
    );

    const provider = new CaliforniaParksProvider();
    const result = await provider.proactiveScanWindow(
      '468',
      { windowStart: '2026-08-14', windowEnd: '2026-08-21' },
      'Test Park',
      []
    );

    expect(result).toBeNull();
  });
});
