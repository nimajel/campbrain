import { describe, it, expect } from 'vitest';
import {
  emptyForm,
  alertToForm,
  formToPayload,
  validateForm,
  bookingRuleDescription,
  applyParkToForm,
  applyCampgroundToForm,
} from '../src/ui/alert-form.js';
import type { FormState } from '../src/ui/alert-form.js';
import type { Alert } from '../src/config/alerts.js';
import type { ParkCatalogEntry } from '../src/catalog/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const bookingRule = {
  type: 'rolling_months_before' as const,
  monthsBefore: 6,
  releaseTime: '08:00',
  timezone: 'America/Los_Angeles',
};

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'angel-island-ridge-weekends',
    name: 'Angel Island Ridge weekends',
    provider: 'california-parks',
    parkName: 'Angel Island SP',
    parkPageId: '468',
    campgroundName: 'Ridge (sites 4-6)',
    acceptableSites: ['Hike in Campsite #4', 'Hike in Campsite #5', 'Hike in Campsite #6'],
    preferredSites: ['Hike in Campsite #5', 'Hike in Campsite #4', 'Hike in Campsite #6'],
    campingType: 'hike-in',
    people: 2,
    dateMode: 'next_available_weekend',
    nextWeeksCount: 12,
    minNights: 1,
    maxNights: 2,
    weekendsOnly: true,
    bookingRule,
    enabled: true,
    emailEnabled: true,
    calendarEnabled: false,
    ...overrides,
  };
}

const catalogBookingRule = {
  type: 'rolling_months_before' as const,
  monthsBefore: 6,
  releaseTime: '08:00',
  timezone: 'America/Los_Angeles',
  source: 'known' as const,
  confidence: 'high' as const,
};

function makeParks(): ParkCatalogEntry[] {
  return [
    {
      provider: 'california-parks',
      parkName: 'Angel Island SP',
      parkPageId: '468',
      campgrounds: [
        {
          id: 'ridge-sites-4-6',
          name: 'Ridge (sites 4-6)',
          sites: [
            { id: 'hike-in-campsite-4', name: 'Hike in Campsite #4' },
            { id: 'hike-in-campsite-5', name: 'Hike in Campsite #5' },
            { id: 'hike-in-campsite-6', name: 'Hike in Campsite #6' },
          ],
        },
        {
          id: 'east-bay-sites-1-3',
          name: 'East Bay (sites 1-3)',
          sites: [
            { id: 'hike-in-campsite-1', name: 'Hike in Campsite #1' },
            { id: 'hike-in-campsite-2', name: 'Hike in Campsite #2' },
            { id: 'hike-in-campsite-3', name: 'Hike in Campsite #3' },
          ],
        },
      ],
      defaultBookingRule: catalogBookingRule,
    },
  ];
}

// ---------------------------------------------------------------------------
// emptyForm
// ---------------------------------------------------------------------------

describe('emptyForm', () => {
  it('returns default FormState', () => {
    const f = emptyForm();
    expect(f.id).toBe('');
    expect(f.provider).toBe('california-parks');
    expect(f.acceptableSites).toEqual([]);
    expect(f.preferredSites).toEqual([]);
    expect(f.enabled).toBe(true);
    expect(f.emailEnabled).toBe(true);
    expect(f.calendarEnabled).toBe(false);
    expect(f.showAdvanced).toBe(false);
  });

  it('defaults to next_available_weekend', () => {
    expect(emptyForm().dateMode).toBe('next_available_weekend');
  });

  it('defaults booking rule to California Parks standard', () => {
    const f = emptyForm();
    expect(f.bookingRule_monthsBefore).toBe(6);
    expect(f.bookingRule_releaseTime).toBe('08:00');
    expect(f.bookingRule_timezone).toBe('America/Los_Angeles');
  });
});

// ---------------------------------------------------------------------------
// alertToForm
// ---------------------------------------------------------------------------

describe('alertToForm', () => {
  it('maps all required fields from alert', () => {
    const a = makeAlert();
    const f = alertToForm(a);
    expect(f.id).toBe(a.id);
    expect(f.name).toBe(a.name);
    expect(f.provider).toBe(a.provider);
    expect(f.parkName).toBe(a.parkName);
    expect(f.parkPageId).toBe(a.parkPageId);
    expect(f.campgroundName).toBe(a.campgroundName);
    expect(f.acceptableSites).toEqual(a.acceptableSites);
    expect(f.preferredSites).toEqual(a.preferredSites);
  });

  it('sets selectedParkPageId from alert parkPageId', () => {
    const f = alertToForm(makeAlert());
    expect(f.selectedParkPageId).toBe('468');
  });

  it('selectedCampgroundId is empty when no parks provided', () => {
    const f = alertToForm(makeAlert());
    expect(f.selectedCampgroundId).toBe('');
  });

  it('resolves selectedCampgroundId from parks when campground name matches', () => {
    const f = alertToForm(makeAlert(), makeParks());
    expect(f.selectedCampgroundId).toBe('ridge-sites-4-6');
  });

  it('populates bookingRuleSource from catalog when park matches', () => {
    const f = alertToForm(makeAlert(), makeParks());
    expect(f.bookingRuleSource).toContain('6 months');
    expect(f.bookingRuleSource).toContain('08:00');
  });

  it('bookingRuleSource is empty when no catalog provided', () => {
    const f = alertToForm(makeAlert());
    expect(f.bookingRuleSource).toBe('');
  });

  it('maps booking rule fields from alert', () => {
    const f = alertToForm(makeAlert());
    expect(f.bookingRule_monthsBefore).toBe(6);
    expect(f.bookingRule_releaseTime).toBe('08:00');
    expect(f.bookingRule_timezone).toBe('America/Los_Angeles');
  });

  it('sets scanIntervalMinutes to empty string when absent', () => {
    const f = alertToForm(makeAlert());
    expect(f.scanIntervalMinutes).toBe('');
  });

  it('converts scanIntervalMinutes to string when present', () => {
    const f = alertToForm(makeAlert({ scanIntervalMinutes: 30 }));
    expect(f.scanIntervalMinutes).toBe('30');
  });

  it('maps optional date fields to empty string when absent', () => {
    const f = alertToForm(makeAlert());
    expect(f.exactStartDate).toBe('');
    expect(f.exactEndDate).toBe('');
    expect(f.rangeStart).toBe('');
    expect(f.rangeEnd).toBe('');
  });

  it('maps exact date fields when present', () => {
    const f = alertToForm(makeAlert({
      dateMode: 'exact_dates',
      exactStartDate: '2026-09-01',
      exactEndDate: '2026-09-03',
    }));
    expect(f.exactStartDate).toBe('2026-09-01');
    expect(f.exactEndDate).toBe('2026-09-03');
  });
});

// ---------------------------------------------------------------------------
// formToPayload
// ---------------------------------------------------------------------------

describe('formToPayload', () => {
  function validForm(): FormState {
    return {
      ...emptyForm(),
      id: 'test-alert',
      name: 'Test Alert',
      parkName: 'Angel Island SP',
      parkPageId: '468',
      campgroundName: 'Ridge (sites 4-6)',
      acceptableSites: ['Hike in Campsite #4', 'Hike in Campsite #5'],
      preferredSites: ['Hike in Campsite #5'],
      people: 2,
      nextWeeksCount: 12,
    };
  }

  it('produces expected top-level fields', () => {
    const p = formToPayload(validForm());
    expect(p.id).toBe('test-alert');
    expect(p.name).toBe('Test Alert');
    expect(p.parkName).toBe('Angel Island SP');
    expect(p.parkPageId).toBe('468');
    expect(p.campgroundName).toBe('Ridge (sites 4-6)');
    expect(p.provider).toBe('california-parks');
  });

  it('includes acceptableSites and preferredSites', () => {
    const p = formToPayload(validForm());
    expect(p.acceptableSites).toEqual(['Hike in Campsite #4', 'Hike in Campsite #5']);
    expect(p.preferredSites).toEqual(['Hike in Campsite #5']);
  });

  it('uses acceptableSites as preferredSites fallback when preferredSites is empty', () => {
    const f = { ...validForm(), preferredSites: [] };
    const p = formToPayload(f);
    expect(p.preferredSites).toEqual(f.acceptableSites);
  });

  it('includes bookingRule with correct shape', () => {
    const p = formToPayload(validForm());
    expect(p.bookingRule).toEqual({
      type: 'rolling_months_before',
      monthsBefore: 6,
      releaseTime: '08:00',
      timezone: 'America/Los_Angeles',
    });
  });

  it('includes nextWeeksCount for next_available_weekend mode', () => {
    const p = formToPayload({ ...validForm(), dateMode: 'next_available_weekend', nextWeeksCount: 8 });
    expect(p.nextWeeksCount).toBe(8);
    expect(p).not.toHaveProperty('exactStartDate');
    expect(p).not.toHaveProperty('rangeStart');
  });

  it('includes exact dates for exact_dates mode', () => {
    const p = formToPayload({
      ...validForm(),
      dateMode: 'exact_dates',
      exactStartDate: '2026-09-01',
      exactEndDate: '2026-09-03',
    });
    expect(p.exactStartDate).toBe('2026-09-01');
    expect(p.exactEndDate).toBe('2026-09-03');
    expect(p).not.toHaveProperty('nextWeeksCount');
  });

  it('includes range dates for date_range mode', () => {
    const p = formToPayload({
      ...validForm(),
      dateMode: 'date_range',
      rangeStart: '2026-09-01',
      rangeEnd: '2026-11-30',
    });
    expect(p.rangeStart).toBe('2026-09-01');
    expect(p.rangeEnd).toBe('2026-11-30');
  });

  it('omits scanIntervalMinutes when empty', () => {
    const p = formToPayload({ ...validForm(), scanIntervalMinutes: '' });
    expect(p).not.toHaveProperty('scanIntervalMinutes');
  });

  it('includes scanIntervalMinutes as number when set', () => {
    const p = formToPayload({ ...validForm(), scanIntervalMinutes: '30' });
    expect(p.scanIntervalMinutes).toBe(30);
  });

  it('trims whitespace from string fields', () => {
    const p = formToPayload({ ...validForm(), id: '  test-alert  ', name: '  Name  ' });
    expect(p.id).toBe('test-alert');
    expect(p.name).toBe('Name');
  });

  it('coerces numeric fields from form numbers', () => {
    const p = formToPayload({ ...validForm(), people: 4, minNights: 2, maxNights: 3 });
    expect(p.people).toBe(4);
    expect(p.minNights).toBe(2);
    expect(p.maxNights).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// validateForm
// ---------------------------------------------------------------------------

describe('validateForm', () => {
  function validForm(): FormState {
    return {
      ...emptyForm(),
      id: 'test-alert',
      name: 'Test Alert',
      parkPageId: '468',
      campgroundName: 'Ridge (sites 4-6)',
      acceptableSites: ['Hike in Campsite #4'],
    };
  }

  it('returns no errors for a valid form', () => {
    expect(validateForm(validForm())).toEqual([]);
  });

  it('requires id', () => {
    const errs = validateForm({ ...validForm(), id: '' });
    expect(errs.some((e) => e.field === 'id')).toBe(true);
  });

  it('requires name', () => {
    const errs = validateForm({ ...validForm(), name: '' });
    expect(errs.some((e) => e.field === 'name')).toBe(true);
  });

  it('requires parkPageId', () => {
    const errs = validateForm({ ...validForm(), parkPageId: '' });
    expect(errs.some((e) => e.field === 'parkPageId')).toBe(true);
  });

  it('requires campgroundName', () => {
    const errs = validateForm({ ...validForm(), campgroundName: '' });
    expect(errs.some((e) => e.field === 'campgroundName')).toBe(true);
  });

  it('requires at least one acceptable site', () => {
    const errs = validateForm({ ...validForm(), acceptableSites: [] });
    expect(errs.some((e) => e.field === 'acceptableSites')).toBe(true);
  });

  it('requires maxNights >= minNights', () => {
    const errs = validateForm({ ...validForm(), minNights: 3, maxNights: 1 });
    expect(errs.some((e) => e.field === 'maxNights')).toBe(true);
  });

  it('allows maxNights === minNights', () => {
    const errs = validateForm({ ...validForm(), minNights: 2, maxNights: 2 });
    expect(errs.some((e) => e.field === 'maxNights')).toBe(false);
  });

  it('requires HH:MM format for releaseTime', () => {
    const errs = validateForm({ ...validForm(), bookingRule_releaseTime: '8am' });
    expect(errs.some((e) => e.field === 'bookingRule_releaseTime')).toBe(true);
  });

  it('accepts 08:00 as valid releaseTime', () => {
    const errs = validateForm({ ...validForm(), bookingRule_releaseTime: '08:00' });
    expect(errs.some((e) => e.field === 'bookingRule_releaseTime')).toBe(false);
  });

  it('requires exactStartDate and exactEndDate for exact_dates mode', () => {
    const errs = validateForm({ ...validForm(), dateMode: 'exact_dates', exactStartDate: '', exactEndDate: '' });
    expect(errs.some((e) => e.field === 'exactStartDate')).toBe(true);
    expect(errs.some((e) => e.field === 'exactEndDate')).toBe(true);
  });

  it('requires rangeStart and rangeEnd for date_range mode', () => {
    const errs = validateForm({ ...validForm(), dateMode: 'date_range', rangeStart: '', rangeEnd: '' });
    expect(errs.some((e) => e.field === 'rangeStart')).toBe(true);
    expect(errs.some((e) => e.field === 'rangeEnd')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bookingRuleDescription
// ---------------------------------------------------------------------------

describe('bookingRuleDescription', () => {
  it('includes monthsBefore, releaseTime, and timezone', () => {
    const desc = bookingRuleDescription(catalogBookingRule);
    expect(desc).toContain('6 months');
    expect(desc).toContain('08:00');
    expect(desc).toContain('America/Los_Angeles');
  });

  it('does not include confidence marker for high confidence', () => {
    const desc = bookingRuleDescription({ ...catalogBookingRule, confidence: 'high' });
    expect(desc).not.toContain('confidence');
  });

  it('includes confidence marker for medium confidence', () => {
    const desc = bookingRuleDescription({ ...catalogBookingRule, confidence: 'medium' });
    expect(desc).toContain('medium confidence');
  });
});

// ---------------------------------------------------------------------------
// applyParkToForm / applyCampgroundToForm
// ---------------------------------------------------------------------------

describe('applyParkToForm', () => {
  it('resets downstream fields when park changes', () => {
    const partial = applyParkToForm(emptyForm(), makeParks()[0]!);
    expect(partial.selectedParkPageId).toBe('468');
    expect(partial.selectedCampgroundId).toBe('');
    expect(partial.campgroundName).toBe('');
    expect(partial.acceptableSites).toEqual([]);
    expect(partial.preferredSites).toEqual([]);
  });

  it('applies park booking rule', () => {
    const partial = applyParkToForm(emptyForm(), makeParks()[0]!);
    expect(partial.bookingRule_monthsBefore).toBe(6);
    expect(partial.bookingRule_releaseTime).toBe('08:00');
  });

  it('clears fields when park is null', () => {
    const partial = applyParkToForm(emptyForm(), null);
    expect(partial.selectedParkPageId).toBe('');
    expect(partial.parkName).toBe('');
    expect(partial.parkPageId).toBe('');
    expect(partial.bookingRuleSource).toBe('');
  });
});

describe('applyCampgroundToForm', () => {
  it('sets campground name and sites from catalog', () => {
    const park = makeParks()[0]!;
    const partial = applyCampgroundToForm(emptyForm(), park, 'ridge-sites-4-6');
    expect(partial.selectedCampgroundId).toBe('ridge-sites-4-6');
    expect(partial.campgroundName).toBe('Ridge (sites 4-6)');
    expect(partial.acceptableSites).toEqual([
      'Hike in Campsite #4',
      'Hike in Campsite #5',
      'Hike in Campsite #6',
    ]);
  });

  it('sets all sites as preferred by default', () => {
    const park = makeParks()[0]!;
    const partial = applyCampgroundToForm(emptyForm(), park, 'ridge-sites-4-6');
    expect(partial.preferredSites).toEqual(partial.acceptableSites);
  });

  it('uses park default booking rule for campground without override', () => {
    const park = makeParks()[0]!;
    const partial = applyCampgroundToForm(emptyForm(), park, 'ridge-sites-4-6');
    expect(partial.bookingRule_monthsBefore).toBe(6);
    expect(partial.bookingRule_releaseTime).toBe('08:00');
  });

  it('returns empty campground name when campground id not found', () => {
    const park = makeParks()[0]!;
    const partial = applyCampgroundToForm(emptyForm(), park, 'nonexistent-id');
    expect(partial.campgroundName).toBe('');
    expect(partial.acceptableSites).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: alertToForm → formToPayload produces valid-looking payload
// ---------------------------------------------------------------------------

describe('alertToForm → formToPayload round-trip', () => {
  it('round-trips the Angel Island alert correctly', () => {
    const a = makeAlert();
    const f = alertToForm(a, makeParks());
    const p = formToPayload(f);

    expect(p.id).toBe(a.id);
    expect(p.parkPageId).toBe(a.parkPageId);
    expect(p.campgroundName).toBe(a.campgroundName);
    expect(p.acceptableSites).toEqual(a.acceptableSites);
    expect(p.bookingRule).toEqual({
      type: 'rolling_months_before',
      monthsBefore: 6,
      releaseTime: '08:00',
      timezone: 'America/Los_Angeles',
    });
  });

  it('round-trip validates cleanly', () => {
    const a = makeAlert();
    const f = alertToForm(a, makeParks());
    const errs = validateForm(f);
    expect(errs).toEqual([]);
  });
});
