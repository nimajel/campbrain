import { describe, it, expect, vi } from 'vitest';
import dayjs from 'dayjs';
import { targetToSavedSearch } from '../src/cli/commands/migrate-targets.js';
import type { Alert } from '../src/config/alerts.js';
import type { MigratedSavedSearch } from '../src/cli/commands/migrate-targets.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TODAY = '2026-06-10';

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'test-target',
    name: 'Test Target',
    provider: 'california-parks',
    parkName: 'Test Park',
    parkPageId: '468',
    campgroundName: 'Main Campground',
    acceptableSites: ['Site A', 'Site B'],
    preferredSites: ['Site A'],
    campingType: 'drive-to',
    people: 2,
    dateMode: 'date_range',
    rangeStart: '2026-07-01',
    rangeEnd: '2026-09-30',
    minNights: 1,
    maxNights: 2,
    weekendsOnly: false,
    bookingRule: {
      type: 'rolling_months_before',
      monthsBefore: 6,
      releaseTime: '08:00',
      timezone: 'America/Los_Angeles',
    },
    enabled: false,
    emailEnabled: true,
    calendarEnabled: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. date_range → fixed_range
// ---------------------------------------------------------------------------

describe('targetToSavedSearch - date_range', () => {
  it('maps dateMode=date_range to fixed_range with rangeStart/rangeEnd', () => {
    const alert = makeAlert({ dateMode: 'date_range', rangeStart: '2026-07-01', rangeEnd: '2026-09-30' });
    const result = targetToSavedSearch(alert, TODAY);
    expect(result).not.toBeNull();
    expect(result!.datePattern.kind).toBe('fixed_range');
    if (result!.datePattern.kind === 'fixed_range') {
      expect(result!.datePattern.from).toBe('2026-07-01');
      expect(result!.datePattern.to).toBe('2026-09-30');
    }
  });

  it('maps parkPageId to scope.parkPageIds array with region=null', () => {
    const result = targetToSavedSearch(makeAlert(), TODAY);
    expect(result!.scope.parkPageIds).toEqual(['468']);
    expect(result!.scope.region).toBeNull();
  });

  it('preserves id and name', () => {
    const alert = makeAlert({ id: 'my-search-id', name: 'Angel Island Weekends' });
    const result = targetToSavedSearch(alert, TODAY);
    expect(result!.id).toBe('my-search-id');
    expect(result!.name).toBe('Angel Island Weekends');
  });

  it('preserves provider', () => {
    const result = targetToSavedSearch(makeAlert({ provider: 'california-parks' }), TODAY);
    expect(result!.provider).toBe('california-parks');
  });

  it('maps emailEnabled=true', () => {
    const result = targetToSavedSearch(makeAlert({ emailEnabled: true }), TODAY);
    expect(result!.emailEnabled).toBe(true);
  });

  it('maps emailEnabled=false', () => {
    const result = targetToSavedSearch(makeAlert({ emailEnabled: false }), TODAY);
    expect(result!.emailEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. weekend_range → any_weekend
// ---------------------------------------------------------------------------

describe('targetToSavedSearch - weekend_range', () => {
  it('maps dateMode=weekend_range to any_weekend', () => {
    const alert = makeAlert({ dateMode: 'weekend_range', rangeStart: '2026-06-15', rangeEnd: '2026-09-15' });
    const result = targetToSavedSearch(alert, TODAY);
    expect(result!.datePattern.kind).toBe('any_weekend');
  });

  it('computes horizonDays from rangeEnd - today, clamped to 180', () => {
    const alert = makeAlert({ dateMode: 'weekend_range', rangeStart: '2026-06-15', rangeEnd: '2026-09-15' });
    const result = targetToSavedSearch(alert, TODAY);
    const expected = Math.min(dayjs('2026-09-15').diff(dayjs(TODAY), 'day'), 180);
    if (result!.datePattern.kind === 'any_weekend') {
      expect(result!.datePattern.horizonDays).toBe(expected);
    }
  });

  it('clamps horizonDays to 180 when rangeEnd is far in the future', () => {
    const alert = makeAlert({ dateMode: 'weekend_range', rangeStart: '2026-06-15', rangeEnd: '2027-12-31' });
    const result = targetToSavedSearch(alert, TODAY);
    if (result!.datePattern.kind === 'any_weekend') {
      expect(result!.datePattern.horizonDays).toBe(180);
    }
  });

  it('defaults horizonDays to 90 when rangeEnd is absent', () => {
    const alert = makeAlert({ dateMode: 'weekend_range', rangeStart: '2026-06-15', rangeEnd: undefined });
    const result = targetToSavedSearch(alert, TODAY);
    if (result!.datePattern.kind === 'any_weekend') {
      expect(result!.datePattern.horizonDays).toBe(90);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. next_available_weekend → any_weekend
// ---------------------------------------------------------------------------

describe('targetToSavedSearch - next_available_weekend', () => {
  it('maps dateMode=next_available_weekend to any_weekend', () => {
    const alert = makeAlert({ dateMode: 'next_available_weekend', nextWeeksCount: 8 });
    const result = targetToSavedSearch(alert, TODAY);
    expect(result!.datePattern.kind).toBe('any_weekend');
  });

  it('computes horizonDays as nextWeeksCount * 7', () => {
    const alert = makeAlert({ dateMode: 'next_available_weekend', nextWeeksCount: 8 });
    const result = targetToSavedSearch(alert, TODAY);
    if (result!.datePattern.kind === 'any_weekend') {
      expect(result!.datePattern.horizonDays).toBe(56);
    }
  });

  it('clamps horizonDays to 180', () => {
    const alert = makeAlert({ dateMode: 'next_available_weekend', nextWeeksCount: 100 });
    const result = targetToSavedSearch(alert, TODAY);
    if (result!.datePattern.kind === 'any_weekend') {
      expect(result!.datePattern.horizonDays).toBe(180);
    }
  });

  it('defaults horizonDays to 90 when nextWeeksCount is absent', () => {
    const alert = makeAlert({ dateMode: 'next_available_weekend', nextWeeksCount: undefined });
    const result = targetToSavedSearch(alert, TODAY);
    if (result!.datePattern.kind === 'any_weekend') {
      expect(result!.datePattern.horizonDays).toBe(90);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. weekendsOnly=true (with date_range) → any_weekend
// ---------------------------------------------------------------------------

describe('targetToSavedSearch - weekendsOnly=true flag', () => {
  it('maps weekendsOnly=true to any_weekend even when dateMode is date_range', () => {
    const alert = makeAlert({ dateMode: 'date_range', weekendsOnly: true, rangeStart: '2026-06-15', rangeEnd: '2026-09-15' });
    const result = targetToSavedSearch(alert, TODAY);
    expect(result!.datePattern.kind).toBe('any_weekend');
  });
});

// ---------------------------------------------------------------------------
// 5. exact_dates → fixed_range
// ---------------------------------------------------------------------------

describe('targetToSavedSearch - exact_dates', () => {
  it('maps dateMode=exact_dates to fixed_range', () => {
    const alert = makeAlert({
      dateMode: 'exact_dates',
      exactStartDate: '2026-08-14',
      exactEndDate: '2026-08-16',
    });
    const result = targetToSavedSearch(alert, TODAY);
    expect(result!.datePattern.kind).toBe('fixed_range');
    if (result!.datePattern.kind === 'fixed_range') {
      expect(result!.datePattern.from).toBe('2026-08-14');
      expect(result!.datePattern.to).toBe('2026-08-16');
    }
  });

  it('falls back to exactStartDate + maxNights when exactEndDate is absent', () => {
    const alert = makeAlert({
      dateMode: 'exact_dates',
      exactStartDate: '2026-08-14',
      exactEndDate: undefined,
      maxNights: 3,
    });
    const result = targetToSavedSearch(alert, TODAY);
    if (result!.datePattern.kind === 'fixed_range') {
      expect(result!.datePattern.from).toBe('2026-08-14');
      expect(result!.datePattern.to).toBe('2026-08-17');
    }
  });
});

// ---------------------------------------------------------------------------
// 6. filters.access from campingType
// ---------------------------------------------------------------------------

describe('targetToSavedSearch - filters.access', () => {
  it('maps campingType=hike-in to access=[hike_in]', () => {
    const result = targetToSavedSearch(makeAlert({ campingType: 'hike-in' }), TODAY);
    expect(result!.filters.access).toEqual(['hike_in']);
  });

  it('leaves access=[] for campingType=drive-to', () => {
    const result = targetToSavedSearch(makeAlert({ campingType: 'drive-to' }), TODAY);
    expect(result!.filters.access).toEqual([]);
  });

  it('leaves access=[] for campingType=walk-in', () => {
    const result = targetToSavedSearch(makeAlert({ campingType: 'walk-in' }), TODAY);
    expect(result!.filters.access).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. minNights clamping
// ---------------------------------------------------------------------------

describe('targetToSavedSearch - minNights', () => {
  it('passes minNights=1 through unchanged', () => {
    const result = targetToSavedSearch(makeAlert({ minNights: 1 }), TODAY);
    expect(result!.filters.minNights).toBe(1);
  });

  it('passes minNights=2 through unchanged', () => {
    const result = targetToSavedSearch(makeAlert({ minNights: 2 }), TODAY);
    expect(result!.filters.minNights).toBe(2);
  });

  it('passes minNights=3 through unchanged', () => {
    const result = targetToSavedSearch(makeAlert({ minNights: 3 }), TODAY);
    expect(result!.filters.minNights).toBe(3);
  });

  it('clamps minNights > 3 down to 3 with a console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = targetToSavedSearch(makeAlert({ minNights: 5 }), TODAY);
    expect(result!.filters.minNights).toBe(3);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 8. yosemite-lottery rows are skipped
// ---------------------------------------------------------------------------

describe('targetToSavedSearch - yosemite-lottery', () => {
  it('returns null for yosemite-lottery provider', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const alert = makeAlert({ provider: 'yosemite-lottery' as Alert['provider'] });
    const result = targetToSavedSearch(alert, TODAY);
    expect(result).toBeNull();
    warnSpy.mockRestore();
  });

  it('logs a warning for yosemite-lottery rows', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const alert = makeAlert({ provider: 'yosemite-lottery' as Alert['provider'] });
    targetToSavedSearch(alert, TODAY);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 9. alert_enabled is always false; legacy.enabled is preserved
// ---------------------------------------------------------------------------

describe('targetToSavedSearch - alertEnabled forced off', () => {
  it('sets alertEnabled=false even when legacy enabled=true', () => {
    const alert = makeAlert({ enabled: true });
    const result = targetToSavedSearch(alert, TODAY);
    expect(result!.alertEnabled).toBe(false);
  });

  it('sets alertEnabled=false when legacy enabled=false', () => {
    const alert = makeAlert({ enabled: false });
    const result = targetToSavedSearch(alert, TODAY);
    expect(result!.alertEnabled).toBe(false);
  });

  it('preserves legacy.enabled=true under result.legacy', () => {
    const alert = makeAlert({ enabled: true });
    const result = targetToSavedSearch(alert, TODAY) as MigratedSavedSearch;
    expect(result.legacy['enabled']).toBe(true);
  });

  it('preserves legacy.enabled=false under result.legacy', () => {
    const alert = makeAlert({ enabled: false });
    const result = targetToSavedSearch(alert, TODAY) as MigratedSavedSearch;
    expect(result.legacy['enabled']).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. acceptableSites and other dropped fields preserved under legacy
// ---------------------------------------------------------------------------

describe('targetToSavedSearch - legacy passthrough', () => {
  it('preserves acceptableSites under legacy', () => {
    const alert = makeAlert({ acceptableSites: ['Group Dailyuse (B) #D A', 'Group Dailyuse (B) #D B'] });
    const result = targetToSavedSearch(alert, TODAY) as MigratedSavedSearch;
    expect(result.legacy['acceptableSites']).toEqual(['Group Dailyuse (B) #D A', 'Group Dailyuse (B) #D B']);
  });

  it('preserves bookingRule under legacy', () => {
    const alert = makeAlert();
    const result = targetToSavedSearch(alert, TODAY) as MigratedSavedSearch;
    expect(result.legacy['bookingRule']).toBeDefined();
    expect((result.legacy['bookingRule'] as Record<string, unknown>)['type']).toBe('rolling_months_before');
  });

  it('preserves maxNights under legacy', () => {
    const alert = makeAlert({ maxNights: 3 });
    const result = targetToSavedSearch(alert, TODAY) as MigratedSavedSearch;
    expect(result.legacy['maxNights']).toBe(3);
  });

  it('preserves people under legacy', () => {
    const alert = makeAlert({ people: 4 });
    const result = targetToSavedSearch(alert, TODAY) as MigratedSavedSearch;
    expect(result.legacy['people']).toBe(4);
  });

  it('preserves preferredSites under legacy', () => {
    const alert = makeAlert({ preferredSites: ['Site A'] });
    const result = targetToSavedSearch(alert, TODAY) as MigratedSavedSearch;
    expect(result.legacy['preferredSites']).toEqual(['Site A']);
  });
});
