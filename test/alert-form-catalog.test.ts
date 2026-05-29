import { describe, it, expect } from 'vitest';

import {
  emptyForm,
  applyParkToForm,
  applyCampgroundToForm,
  validateForm,
  formToPayload,
  type FormState,
} from '../src/ui/alert-form.js';
import { getCatalogParkByName } from '../src/catalog/catalog-store.js';
import { CALIFORNIA_PARKS_DEFAULT_RULE } from '../src/catalog/discover-california-parks.js';
import type { ParkCatalogEntry } from '../src/catalog/types.js';

const angel = getCatalogParkByName('Angel Island SP')!;
const ridge = angel.campgrounds.find((c) => c.name === 'Ridge (sites 4-6)')!;

function withIdentity(form: FormState): FormState {
  return { ...form, id: 'my-alert', name: 'My Alert' };
}

// ---------------------------------------------------------------------------
// The user never types a page ID — it is inferred from park selection.
// ---------------------------------------------------------------------------

describe('alert form does not require a manual page ID', () => {
  it('infers parkPageId from the selected catalog park', () => {
    const form = { ...emptyForm(), ...applyParkToForm(emptyForm(), angel) };
    // User selected by name; page ID was filled automatically.
    expect(form.parkPageId).toBe('468');
    expect(form.parkName).toBe('Angel Island SP');
  });

  it('produces a valid payload without the user entering a page ID', () => {
    let form: FormState = { ...emptyForm(), ...applyParkToForm(emptyForm(), angel) };
    form = { ...form, ...applyCampgroundToForm(form, angel, ridge.id) };
    form = withIdentity(form);

    const errors = validateForm(form);
    expect(errors).toEqual([]);

    const payload = formToPayload(form);
    expect(payload.parkPageId).toBe('468');
  });
});

// ---------------------------------------------------------------------------
// Undiscovered parks are handled gracefully (no crash, clear validation).
// ---------------------------------------------------------------------------

describe('alert form handles undiscovered parks gracefully', () => {
  const undiscovered: ParkCatalogEntry = {
    provider: 'california-parks',
    parkName: 'Pfeiffer Big Sur SP',
    parkPageId: '215',
    campgrounds: [],
    defaultBookingRule: CALIFORNIA_PARKS_DEFAULT_RULE,
    discoveryStatus: 'not_started',
  };

  it('selecting an undiscovered park does not throw and clears campground/sites', () => {
    const form = { ...emptyForm(), ...applyParkToForm(emptyForm(), undiscovered) };
    expect(form.parkPageId).toBe('215');
    expect(form.campgroundName).toBe('');
    expect(form.acceptableSites).toEqual([]);
  });

  it('validation reports the missing campground and sites rather than crashing', () => {
    let form: FormState = { ...emptyForm(), ...applyParkToForm(emptyForm(), undiscovered) };
    form = withIdentity(form);
    const fields = validateForm(form).map((e) => e.field);
    expect(fields).toContain('campgroundName');
    expect(fields).toContain('acceptableSites');
  });
});

// ---------------------------------------------------------------------------
// Angel Island Ridge end-to-end through the catalog-driven form.
// ---------------------------------------------------------------------------

describe('Angel Island Ridge end-to-end via catalog', () => {
  it('selecting park + campground populates the Ridge sites', () => {
    let form: FormState = { ...emptyForm(), ...applyParkToForm(emptyForm(), angel) };
    form = { ...form, ...applyCampgroundToForm(form, angel, ridge.id) };

    expect(form.campgroundName).toBe('Ridge (sites 4-6)');
    expect(form.acceptableSites).toContain('Hike in Campsite #4');
    expect(form.acceptableSites).toContain('Hike in Campsite #5');
    expect(form.acceptableSites).toContain('Hike in Campsite #6');
  });

  it('infers the booking rule from the catalog (6 months, 08:00, LA time)', () => {
    let form: FormState = { ...emptyForm(), ...applyParkToForm(emptyForm(), angel) };
    form = { ...form, ...applyCampgroundToForm(form, angel, ridge.id) };
    const payload = formToPayload(form) as { bookingRule: { monthsBefore: number; releaseTime: string; timezone: string } };
    expect(payload.bookingRule.monthsBefore).toBe(6);
    expect(payload.bookingRule.releaseTime).toBe('08:00');
    expect(payload.bookingRule.timezone).toBe('America/Los_Angeles');
  });
});
