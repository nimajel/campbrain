// ---------------------------------------------------------------------------
// Alert form state and payload helpers — pure functions, framework-agnostic.
// Importable from both Next.js (web/lib) and root-level tests (test/).
// ---------------------------------------------------------------------------

import type { Alert } from '../config/alerts.js';
import type { CatalogBookingRule, ParkCatalogEntry } from '../catalog/types.js';

// ---------------------------------------------------------------------------
// FormState interface
// ---------------------------------------------------------------------------

export interface FormState {
  // Identity
  id: string;
  name: string;
  // Catalog selections (drive the hidden fields)
  selectedParkPageId: string;
  selectedCampgroundId: string;
  // Derived (populated from catalog or manual)
  provider: 'california-parks' | 'recreation-gov' | 'yosemite-lottery';
  parkName: string;
  parkPageId: string;
  campgroundName: string;
  acceptableSites: string[];
  preferredSites: string[];
  campingType: 'hike-in' | 'drive-to' | 'walk-in';
  // Dates
  people: number;
  dateMode: 'exact_dates' | 'date_range' | 'weekend_range' | 'next_available_weekend';
  exactStartDate: string;
  exactEndDate: string;
  rangeStart: string;
  rangeEnd: string;
  nextWeeksCount: number;
  minNights: number;
  maxNights: number;
  weekendsOnly: boolean;
  // Notifications
  enabled: boolean;
  emailEnabled: boolean;
  calendarEnabled: boolean;
  scanIntervalMinutes: string;
  // UI-only
  showAdvanced: boolean;
  // Booking rule
  bookingRule_monthsBefore: number;
  bookingRule_releaseTime: string;
  bookingRule_timezone: string;
  bookingRuleSource: string; // read-only display text
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function emptyForm(): FormState {
  return {
    id: '',
    name: '',
    selectedParkPageId: '',
    selectedCampgroundId: '',
    provider: 'california-parks',
    parkName: '',
    parkPageId: '',
    campgroundName: '',
    acceptableSites: [],
    preferredSites: [],
    campingType: 'hike-in',
    people: 2,
    dateMode: 'next_available_weekend',
    exactStartDate: '',
    exactEndDate: '',
    rangeStart: '',
    rangeEnd: '',
    nextWeeksCount: 12,
    minNights: 1,
    maxNights: 2,
    weekendsOnly: true,
    enabled: true,
    emailEnabled: true,
    calendarEnabled: false,
    scanIntervalMinutes: '',
    showAdvanced: false,
    bookingRule_monthsBefore: 6,
    bookingRule_releaseTime: '08:00',
    bookingRule_timezone: 'America/Los_Angeles',
    bookingRuleSource: '',
  };
}

// ---------------------------------------------------------------------------
// Alert → FormState (for edit mode)
// ---------------------------------------------------------------------------

export function alertToForm(a: Alert, parks?: ParkCatalogEntry[]): FormState {
  const base = emptyForm();

  // Try to find the campground ID from catalog so dropdowns are pre-selected
  let selectedCampgroundId = '';
  const park = parks?.find((p) => p.parkPageId === a.parkPageId);
  if (park) {
    const cg = park.campgrounds.find((c) => c.name === a.campgroundName);
    if (cg) selectedCampgroundId = cg.id;
  }

  // Build the read-only booking rule description
  const rule =
    park?.campgrounds.find((c) => c.name === a.campgroundName)?.bookingRule ??
    park?.defaultBookingRule;
  const bookingRuleSource = rule ? bookingRuleDescription(rule) : '';

  return {
    ...base,
    id: a.id,
    name: a.name,
    provider: a.provider,
    parkName: a.parkName,
    parkPageId: a.parkPageId,
    selectedParkPageId: a.parkPageId,
    selectedCampgroundId,
    campgroundName: a.campgroundName,
    acceptableSites: [...a.acceptableSites],
    preferredSites: [...a.preferredSites],
    campingType: a.campingType,
    people: a.people,
    dateMode: a.dateMode,
    exactStartDate: a.exactStartDate ?? '',
    exactEndDate: a.exactEndDate ?? '',
    rangeStart: a.rangeStart ?? '',
    rangeEnd: a.rangeEnd ?? '',
    nextWeeksCount: a.nextWeeksCount ?? 12,
    minNights: a.minNights,
    maxNights: a.maxNights,
    weekendsOnly: a.weekendsOnly,
    enabled: a.enabled,
    emailEnabled: a.emailEnabled,
    calendarEnabled: a.calendarEnabled,
    scanIntervalMinutes: a.scanIntervalMinutes?.toString() ?? '',
    bookingRule_monthsBefore: a.bookingRule.monthsBefore,
    bookingRule_releaseTime: a.bookingRule.releaseTime,
    bookingRule_timezone: a.bookingRule.timezone,
    bookingRuleSource,
  };
}

// ---------------------------------------------------------------------------
// FormState → API payload
// ---------------------------------------------------------------------------

export function formToPayload(f: FormState): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: f.id.trim(),
    name: f.name.trim(),
    provider: f.provider,
    parkName: f.parkName.trim(),
    parkPageId: f.parkPageId.trim(),
    campgroundName: f.campgroundName.trim(),
    acceptableSites: f.acceptableSites,
    // If no preferred sites chosen, fall back to all acceptable (preserves scan ordering)
    preferredSites: f.preferredSites.length > 0 ? f.preferredSites : f.acceptableSites,
    campingType: f.campingType,
    people: Number(f.people),
    dateMode: f.dateMode,
    minNights: Number(f.minNights),
    maxNights: Number(f.maxNights),
    weekendsOnly: f.weekendsOnly,
    enabled: f.enabled,
    emailEnabled: f.emailEnabled,
    calendarEnabled: f.calendarEnabled,
    bookingRule: {
      type: 'rolling_months_before',
      monthsBefore: Number(f.bookingRule_monthsBefore),
      releaseTime: f.bookingRule_releaseTime,
      timezone: f.bookingRule_timezone,
    },
  };

  // Date-mode specific fields
  if (f.dateMode === 'exact_dates') {
    base.exactStartDate = f.exactStartDate;
    base.exactEndDate = f.exactEndDate;
  } else if (f.dateMode === 'date_range' || f.dateMode === 'weekend_range') {
    base.rangeStart = f.rangeStart;
    base.rangeEnd = f.rangeEnd;
  } else {
    // next_available_weekend
    base.nextWeeksCount = Number(f.nextWeeksCount);
  }

  if (f.scanIntervalMinutes !== '') {
    base.scanIntervalMinutes = Number(f.scanIntervalMinutes);
  }

  return base;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  message: string;
}

export function validateForm(f: FormState): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!f.id.trim()) errors.push({ field: 'id', message: 'ID is required' });
  if (!f.name.trim()) errors.push({ field: 'name', message: 'Name is required' });
  if (!f.parkPageId.trim()) errors.push({ field: 'parkPageId', message: 'Park is required' });
  if (!f.campgroundName.trim()) errors.push({ field: 'campgroundName', message: 'Campground is required' });
  if (f.acceptableSites.length === 0) {
    errors.push({ field: 'acceptableSites', message: 'At least one site is required' });
  }
  if (f.maxNights < f.minNights) {
    errors.push({ field: 'maxNights', message: 'Max nights must be ≥ min nights' });
  }
  if (f.people < 1) errors.push({ field: 'people', message: 'People must be at least 1' });

  const releaseTimeOk = /^\d{2}:\d{2}$/.test(f.bookingRule_releaseTime);
  if (!releaseTimeOk) {
    errors.push({ field: 'bookingRule_releaseTime', message: 'Release time must be HH:MM' });
  }

  if (f.dateMode === 'exact_dates') {
    if (!f.exactStartDate) errors.push({ field: 'exactStartDate', message: 'Arrival date is required' });
    if (!f.exactEndDate) errors.push({ field: 'exactEndDate', message: 'Departure date is required' });
  }
  if (f.dateMode === 'date_range' || f.dateMode === 'weekend_range') {
    if (!f.rangeStart) errors.push({ field: 'rangeStart', message: 'Range start is required' });
    if (!f.rangeEnd) errors.push({ field: 'rangeEnd', message: 'Range end is required' });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function bookingRuleDescription(rule: CatalogBookingRule): string {
  const conf = rule.confidence === 'high' ? '' : ` (${rule.confidence} confidence)`;
  return `Opens ${rule.monthsBefore} months before arrival at ${rule.releaseTime} ${rule.timezone}${conf}`;
}

export function applyParkToForm(
  f: FormState,
  park: ParkCatalogEntry | null
): Partial<FormState> {
  const rule = park?.defaultBookingRule ?? null;
  return {
    selectedParkPageId: park?.parkPageId ?? '',
    selectedCampgroundId: '',
    provider: park?.provider ?? f.provider,
    parkName: park?.parkName ?? '',
    parkPageId: park?.parkPageId ?? '',
    campgroundName: '',
    acceptableSites: [],
    preferredSites: [],
    bookingRule_monthsBefore: rule?.monthsBefore ?? 6,
    bookingRule_releaseTime: rule?.releaseTime ?? '08:00',
    bookingRule_timezone: rule?.timezone ?? 'America/Los_Angeles',
    bookingRuleSource: rule ? bookingRuleDescription(rule) : '',
  };
}

export function applyCampgroundToForm(
  f: FormState,
  park: ParkCatalogEntry | null,
  campgroundId: string
): Partial<FormState> {
  const cg = park?.campgrounds.find((c) => c.id === campgroundId) ?? null;
  const rule = cg?.bookingRule ?? park?.defaultBookingRule ?? null;
  const siteNames = cg?.sites.map((s) => s.name) ?? [];
  return {
    selectedCampgroundId: campgroundId,
    campgroundName: cg?.name ?? '',
    acceptableSites: siteNames,
    preferredSites: siteNames, // default: all preferred
    bookingRule_monthsBefore: rule?.monthsBefore ?? f.bookingRule_monthsBefore,
    bookingRule_releaseTime: rule?.releaseTime ?? f.bookingRule_releaseTime,
    bookingRule_timezone: rule?.timezone ?? f.bookingRule_timezone,
    bookingRuleSource: rule ? bookingRuleDescription(rule) : f.bookingRuleSource,
  };
}
