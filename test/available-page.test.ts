import { describe, it, expect } from 'vitest';
import { passesSiteFilters, campgroundPassesFilters } from '../web/lib/site-filters.js';
import { injectBookingDates } from '../web/lib/booking-url.js';
import {
  buildLookup,
  groupFromLookup,
  isWeekendArrival,
  addDaysToIso,
} from '../web/lib/available-display.js';
import type { AvailableStay } from '../src/cache/types.js';

// ---------------------------------------------------------------------------
// Date helpers — all dates computed relative to today so tests stay valid
// ---------------------------------------------------------------------------

function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoToday(): string {
  return localIso(new Date());
}

function daysOut(n: number): string {
  return addDaysToIso(isoToday(), n);
}

/** Next date (from tomorrow) with the given day-of-week (0=Sun … 6=Sat). */
function nextDow(dow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
  return localIso(d);
}

/** First date on or after `iso` with the given day-of-week. */
function nextDowOnOrAfter(iso: string, dow: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  while (date.getDay() !== dow) date.setDate(date.getDate() + 1);
  return localIso(date);
}

// Named anchors used across tests
const NEXT_WEDNESDAY = nextDow(3);   // weekday within next 7 days
const NEXT_FRIDAY    = nextDow(5);   // weekend arrival, within next 7 days
const NEXT_SATURDAY  = nextDow(6);   // weekend arrival, within next 7 days
const NEXT_SUNDAY    = nextDow(0);   // not a weekend arrival
const MID_RANGE      = nextDowOnOrAfter(daysOut(70), 6); // Saturday ~10 weeks out
const LAST_AVAILABLE = daysOut(180); // edge of the 180-day booking window

// Four consecutive days used in the gap/non-consecutive tests
const GAP_D0 = daysOut(30);   // available
const GAP_D1 = daysOut(31);   // available
const GAP_D3 = daysOut(33);   // available again (D2 = daysOut(32) is the gap)

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build minimal AvailableStay entries for a single park/campground. */
function makeStays(
  dates: string[],
  opts: {
    parkPageId?: string;
    parkName?: string;
    cgName?: string;
    nightlyFee?: number | null;
    bookingUrl?: string | null;
    nights?: number;
    sites?: string[];
  } = {}
): AvailableStay[] {
  const parkPageId = opts.parkPageId ?? '468';
  const parkName = opts.parkName ?? 'Angel Island SP';
  const cgName = opts.cgName ?? 'Main Campground';
  const nights = opts.nights ?? 1;
  const sites = opts.sites ?? ['Site #1'];
  return dates.map((d) => ({
    parkPageId,
    parkName,
    campgroundName: cgName,
    nightlyFee: opts.nightlyFee !== undefined ? opts.nightlyFee : 35,
    bookingUrl: opts.bookingUrl !== undefined ? opts.bookingUrl : 'https://reservecalifornia.com/?date=2026-01-01&night=1',
    arrivalDate: d,
    nights,
    availableSites: sites,
    walkUpSites: [],
  }));
}

const BASE_OPTS = {
  activeFilters: [],
  showUnavailable: false,
  weekendsOnly: false,
  nightsFilter: null as null,
  dateFrom: '',
  dateTo: '',
  limit: 20,
};

// ---------------------------------------------------------------------------
// 1. Site filter logic
// ---------------------------------------------------------------------------

describe('passesSiteFilters', () => {
  it('passes everything with no active filters', () => {
    expect(passesSiteFilters('Group Camp #1', 'Group Area', [])).toBe(true);
    expect(passesSiteFilters('Horse Camp #1', 'Equestrian Zone', [])).toBe(true);
  });

  describe('exclude_group', () => {
    const f = ['exclude_group'];
    it('hides site with "group" in name', () => {
      expect(passesSiteFilters('Group Camp #1', 'Main CG', f)).toBe(false);
    });
    it('hides campground name containing "group"', () => {
      expect(passesSiteFilters('Site #1', 'Group Picnic Area', f)).toBe(false);
    });
    it('is case-insensitive', () => {
      expect(passesSiteFilters('GROUP TENT SITE', 'Main CG', f)).toBe(false);
    });
    it('keeps regular sites', () => {
      expect(passesSiteFilters('Site #5', 'Oak Campground', f)).toBe(true);
    });
    it('does not match "grouper" (word-boundary enforced)', () => {
      expect(passesSiteFilters('Grouper Lane Site', 'Main CG', f)).toBe(true);
    });
  });

  describe('exclude_day_use', () => {
    const f = ['exclude_day_use'];
    it('hides "Day Use Area"', () => {
      expect(passesSiteFilters('Day Use Area', 'Main CG', f)).toBe(false);
    });
    it('hides campground named "Picnic Grounds"', () => {
      expect(passesSiteFilters('Site #1', 'Picnic Grounds', f)).toBe(false);
    });
    it('hides "Daily Use Zone" (day-use variant)', () => {
      expect(passesSiteFilters('Dailyuse Zone', 'Main CG', f)).toBe(false);
    });
    it('keeps tent site', () => {
      expect(passesSiteFilters('Tent Site #3', 'Oak CG', f)).toBe(true);
    });
  });

  describe('hike_in_only', () => {
    const f = ['hike_in_only'];
    it('keeps "Hike-in Site #2"', () => {
      expect(passesSiteFilters('Hike-in Site #2', 'Main CG', f)).toBe(true);
    });
    it('keeps "Walk-in Camp #1"', () => {
      expect(passesSiteFilters('Walk-in Camp #1', 'Main CG', f)).toBe(true);
    });
    it('hides drive-in site', () => {
      expect(passesSiteFilters('Drive-in Site #4', 'Main CG', f)).toBe(false);
    });
    it('hides standard numbered site', () => {
      expect(passesSiteFilters('Site #12', 'Main CG', f)).toBe(false);
    });
    it('keeps if campground name contains "hike-in"', () => {
      expect(passesSiteFilters('Site #1', 'Hike-in Campground', f)).toBe(true);
    });
  });

  describe('exclude_equestrian', () => {
    const f = ['exclude_equestrian'];
    it('hides "Horse Camp #1"', () => {
      expect(passesSiteFilters('Horse Camp #1', 'Main CG', f)).toBe(false);
    });
    it('hides "Equestrian Site"', () => {
      expect(passesSiteFilters('Equestrian Site', 'Main CG', f)).toBe(false);
    });
    it('hides if campground name is equestrian', () => {
      expect(passesSiteFilters('Site #1', 'Equestrian Zone', f)).toBe(false);
    });
    it('keeps regular site', () => {
      expect(passesSiteFilters('Site #5', 'Main CG', f)).toBe(true);
    });
  });

  describe('combined filters', () => {
    it('exclude_group + hike_in_only: keeps hike-in non-group site', () => {
      expect(passesSiteFilters('Hike-in Site #1', 'Main CG', ['exclude_group', 'hike_in_only'])).toBe(true);
    });
    it('exclude_group + hike_in_only: hides drive-in non-group site', () => {
      expect(passesSiteFilters('Drive-in Site #4', 'Main CG', ['exclude_group', 'hike_in_only'])).toBe(false);
    });
    it('exclude_group + hike_in_only: hides hike-in group site', () => {
      expect(passesSiteFilters('Hike-in Group Site', 'Main CG', ['exclude_group', 'hike_in_only'])).toBe(false);
    });
  });
});

describe('campgroundPassesFilters', () => {
  it('hides campground with "group" in name under exclude_group', () => {
    expect(campgroundPassesFilters('Group Tent Area', ['exclude_group'])).toBe(false);
  });
  it('keeps campground that has no excluded keywords', () => {
    expect(campgroundPassesFilters('Oak Forest Campground', ['exclude_group', 'exclude_day_use'])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Booking URL injection
// ---------------------------------------------------------------------------

describe('injectBookingDates', () => {
  const stubDate = daysOut(30);
  const baseUrl = `https://reservecalifornia.com/park/660/903?date=${stubDate}&night=1`;

  it('injects the arrival date and nights', () => {
    const arrival = NEXT_SATURDAY;
    const url = injectBookingDates(baseUrl, arrival, 2);
    expect(url).toContain(`date=${arrival}`);
    expect(url).toContain('night=2');
  });

  it('overwrites existing date and night params', () => {
    const arrival = MID_RANGE;
    const url = injectBookingDates(baseUrl, arrival, 1);
    expect(url).toContain(`date=${arrival}`);
    expect(url).toContain('night=1');
    expect(url).not.toContain(`date=${stubDate}`);
  });

  it('returns original string on invalid URL', () => {
    expect(injectBookingDates('not-a-url', NEXT_SATURDAY, 1)).toBe('not-a-url');
  });
});

// ---------------------------------------------------------------------------
// 3. buildLookup
// ---------------------------------------------------------------------------

describe('buildLookup', () => {
  it('indexes stays by date', () => {
    const stays = makeStays([NEXT_SATURDAY]);
    const lookup = buildLookup(stays);
    const bucket = lookup.byDate.get(NEXT_SATURDAY) ?? [];
    expect(bucket).toHaveLength(1);
    expect(bucket[0]?.parkName).toBe('Angel Island SP');
  });

  it('collects unique sorted arrival dates', () => {
    const stays = [
      ...makeStays([NEXT_SATURDAY]),
      ...makeStays([MID_RANGE], { parkPageId: '999' }),
    ];
    const lookup = buildLookup(stays);
    expect(lookup.allDates).toContain(NEXT_SATURDAY);
    expect(lookup.allDates).toContain(MID_RANGE);
    const sorted = [...lookup.allDates].sort();
    expect(lookup.allDates).toEqual(sorted);
  });

  it('deduplicates arrival dates', () => {
    const stays = [
      ...makeStays([NEXT_SATURDAY], { sites: ['Site #1'] }),
      ...makeStays([NEXT_SATURDAY], { sites: ['Site #2'] }),
    ];
    const lookup = buildLookup(stays);
    expect(lookup.allDates.filter((d) => d === NEXT_SATURDAY)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. groupFromLookup — date edge cases and filters
// ---------------------------------------------------------------------------

describe('groupFromLookup', () => {
  describe('weekend detection', () => {
    it('Friday is a weekend arrival', () => {
      expect(isWeekendArrival(NEXT_FRIDAY)).toBe(true);
    });
    it('Saturday is a weekend arrival', () => {
      expect(isWeekendArrival(NEXT_SATURDAY)).toBe(true);
    });
    it('Wednesday is not a weekend arrival', () => {
      expect(isWeekendArrival(NEXT_WEDNESDAY)).toBe(false);
    });
    it('Sunday is not a weekend arrival', () => {
      expect(isWeekendArrival(NEXT_SUNDAY)).toBe(false);
    });
  });

  describe('weekendsOnly filter', () => {
    it('includes Friday arrival when weekendsOnly=true', () => {
      const lookup = buildLookup(makeStays([NEXT_FRIDAY]));
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS, weekendsOnly: true });
      expect(groups.some((g) => g.arrivalDate === NEXT_FRIDAY)).toBe(true);
    });

    it('includes Saturday arrival when weekendsOnly=true', () => {
      const lookup = buildLookup(makeStays([NEXT_SATURDAY]));
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS, weekendsOnly: true });
      expect(groups.some((g) => g.arrivalDate === NEXT_SATURDAY)).toBe(true);
    });

    it('excludes Wednesday arrival when weekendsOnly=true', () => {
      const lookup = buildLookup(makeStays([NEXT_WEDNESDAY]));
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS, weekendsOnly: true });
      expect(groups.some((g) => g.arrivalDate === NEXT_WEDNESDAY)).toBe(false);
    });

    it('includes Wednesday arrival when weekendsOnly=false', () => {
      const lookup = buildLookup(makeStays([NEXT_WEDNESDAY]));
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS, weekendsOnly: false });
      expect(groups.some((g) => g.arrivalDate === NEXT_WEDNESDAY)).toBe(true);
    });
  });

  describe('date range filter', () => {
    it('excludes dates before dateFrom', () => {
      const early = NEXT_SATURDAY;
      const late = addDaysToIso(early, 7);
      const mid = addDaysToIso(early, 3);
      const stays = [...makeStays([early]), ...makeStays([late])];
      const lookup = buildLookup(stays);
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS, dateFrom: mid, dateTo: '' });
      expect(groups.some((g) => g.arrivalDate === early)).toBe(false);
      expect(groups.some((g) => g.arrivalDate === late)).toBe(true);
    });

    it('excludes dates after dateTo', () => {
      const early = NEXT_SATURDAY;
      const late = addDaysToIso(early, 7);
      const mid = addDaysToIso(early, 3);
      const stays = [...makeStays([early]), ...makeStays([late])];
      const lookup = buildLookup(stays);
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS, dateTo: mid });
      expect(groups.some((g) => g.arrivalDate === early)).toBe(true);
      expect(groups.some((g) => g.arrivalDate === late)).toBe(false);
    });
  });

  describe('date edge cases', () => {
    it('includes last available date (~180 days out)', () => {
      const lookup = buildLookup(makeStays([LAST_AVAILABLE]));
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS });
      expect(groups.some((g) => g.arrivalDate === LAST_AVAILABLE)).toBe(true);
    });

    it('includes mid-range Saturday (~10 weeks out)', () => {
      const lookup = buildLookup(makeStays([MID_RANGE]));
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS });
      expect(groups.some((g) => g.arrivalDate === MID_RANGE)).toBe(true);
    });
  });

  describe('nights filter', () => {
    it('shows 1-night result when nightsFilter=1', () => {
      const lookup = buildLookup(makeStays([GAP_D0], { nights: 1 }));
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS, nightsFilter: 1 });
      const cgs = groups.find((g) => g.arrivalDate === GAP_D0)?.parks[0]?.campgrounds;
      expect(cgs?.some((c) => c.nights === 1 && c.availableSites.length > 0)).toBe(true);
    });

    it('does NOT show 2-night result when nightsFilter=2 and no 2N stay exists', () => {
      // Only 1N stays available — no 2N entry in the MV
      const lookup = buildLookup(makeStays([GAP_D0], { nights: 1 }));
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS, nightsFilter: 2 });
      const cgs = groups.find((g) => g.arrivalDate === GAP_D0)?.parks[0]?.campgrounds ?? [];
      expect(cgs.filter((c) => c.nights === 2 && c.availableSites.length > 0)).toHaveLength(0);
    });

    it('shows both 1N and 2N entries when nightsFilter=null', () => {
      const stays = [
        ...makeStays([GAP_D0], { nights: 1 }),
        ...makeStays([GAP_D0], { nights: 2 }),
      ];
      const lookup = buildLookup(stays);
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS, nightsFilter: null });
      const cgs = groups.find((g) => g.arrivalDate === GAP_D0)?.parks[0]?.campgrounds ?? [];
      const nights = cgs.filter((c) => c.availableSites.length > 0).map((c) => c.nights);
      expect(nights).toContain(1);
      expect(nights).toContain(2);
    });

    it('non-consecutive nights: separate stays per arrival date', () => {
      // MV pre-computes stays — D0 has both 1N and 2N; D1 has only 1N; D3 has only 1N
      const stays = [
        ...makeStays([GAP_D0], { nights: 1 }),
        ...makeStays([GAP_D0], { nights: 2 }),
        ...makeStays([GAP_D1], { nights: 1 }),
        ...makeStays([GAP_D3], { nights: 1 }),
      ];
      const lookup = buildLookup(stays);
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS, nightsFilter: null });

      const d0Nights = groups.find((g) => g.arrivalDate === GAP_D0)
        ?.parks[0]?.campgrounds.filter((c) => c.availableSites.length > 0).map((c) => c.nights) ?? [];
      expect(d0Nights).toContain(1);
      expect(d0Nights).toContain(2);

      const d1Nights = groups.find((g) => g.arrivalDate === GAP_D1)
        ?.parks[0]?.campgrounds.filter((c) => c.availableSites.length > 0).map((c) => c.nights) ?? [];
      expect(d1Nights).toContain(1);
      expect(d1Nights).not.toContain(2);

      const d3Nights = groups.find((g) => g.arrivalDate === GAP_D3)
        ?.parks[0]?.campgrounds.filter((c) => c.availableSites.length > 0).map((c) => c.nights) ?? [];
      expect(d3Nights).toContain(1);
    });
  });

  describe('pagination', () => {
    it('returns exactly limit groups and hasMore=true when more dates exist', () => {
      const dates = Array.from({ length: 5 }, (_, i) => addDaysToIso(NEXT_SATURDAY, i * 7));
      const stays = dates.flatMap((d) => makeStays([d]));
      const lookup = buildLookup(stays);
      const { groups, hasMore } = groupFromLookup(lookup, { ...BASE_OPTS, limit: 3 });
      expect(groups).toHaveLength(3);
      expect(hasMore).toBe(true);
    });

    it('returns hasMore=false when fewer groups than limit', () => {
      const lookup = buildLookup(makeStays([NEXT_SATURDAY]));
      const { groups, hasMore } = groupFromLookup(lookup, { ...BASE_OPTS, limit: 10 });
      expect(groups.length).toBeLessThanOrEqual(10);
      expect(hasMore).toBe(false);
    });
  });

  describe('campground filter', () => {
    it('hides group campground when exclude_group active', () => {
      const stays = makeStays([NEXT_SATURDAY], { cgName: 'Group Tent Area' });
      const lookup = buildLookup(stays);
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS, activeFilters: ['exclude_group'] });
      expect(groups.some((g) => g.arrivalDate === NEXT_SATURDAY)).toBe(false);
    });

    it('shows regular campground when exclude_group active', () => {
      const stays = makeStays([NEXT_SATURDAY], { cgName: 'Oak Forest Campground' });
      const lookup = buildLookup(stays);
      const { groups } = groupFromLookup(lookup, { ...BASE_OPTS, activeFilters: ['exclude_group'] });
      expect(groups.some((g) => g.arrivalDate === NEXT_SATURDAY)).toBe(true);
    });
  });
});
