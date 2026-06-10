import { describe, it, expect } from 'vitest';
import { classifySite, isWalkUpSite } from '../src/catalog/site-classifier.js';

describe('classifySite — CA name patterns', () => {
  it('flags hike/bike as walk-up', () => {
    const r = classifySite('Hike/Bike Site 1', 'Main Campground');
    expect(r.isWalkUp).toBe(true);
  });
  it('flags group sites', () => {
    expect(classifySite('Group Tent Site A', 'Group Camp').isGroup).toBe(true);
  });
  it('flags equestrian and horse', () => {
    expect(classifySite('Equestrian Site 3', 'Horse Camp').isEquestrian).toBe(true);
    expect(classifySite('Horse Camp 2', '').isEquestrian).toBe(true);
  });
  it('flags day-use / picnic', () => {
    expect(classifySite('Day Use Area', '').isDayUse).toBe(true);
    expect(classifySite('Picnic Site 4', '').isDayUse).toBe(true);
  });
  it('folds primitive/environmental/hike-in into access=hike_in', () => {
    expect(classifySite('Environmental Site 1', '').access).toBe('hike_in');
    expect(classifySite('Primitive Site', '').access).toBe('hike_in');
    expect(classifySite('Hike-in Site 2', '').access).toBe('hike_in');
    expect(classifySite('Walk-in Site', '').access).toBe('hike_in');
  });
  it('detects boat-in access', () => {
    expect(classifySite('Boat-in Site 5', '').access).toBe('boat_in');
  });
  it('detects site kinds', () => {
    expect(classifySite('Site 12 (E/W Hookup)', '').siteKind).toBe('hookup');
    expect(classifySite('Tent Site 7', '').siteKind).toBe('tent');
    expect(classifySite('Cabin 3', '').siteKind).toBe('cabin');
    expect(classifySite('Yurt 1', '').siteKind).toBe('cabin');
  });
  it('defaults to drive_in with null kind', () => {
    const r = classifySite('047', '');
    expect(r.access).toBe('drive_in');
    expect(r.siteKind).toBeNull();
    expect(r.isGroup).toBe(false);
  });
  it('treats group + tent + hike-in as orthogonal dimensions', () => {
    const r = classifySite('Group Tent Primitive Campsite', '');
    expect(r.isGroup).toBe(true);
    expect(r.access).toBe('hike_in');
    expect(r.siteKind).toBe('tent');
  });
});

describe('classifySite — Rec.gov campsite_type', () => {
  it('prefers campsite_type over name', () => {
    expect(classifySite('047', '', 'TENT ONLY').siteKind).toBe('tent');
    expect(classifySite('B027', '', 'RV NONELECTRIC').siteKind).toBe('hookup');
    expect(classifySite('A1', '', 'WALK TO').access).toBe('hike_in');
    expect(classifySite('A1', '', 'BOAT IN').access).toBe('boat_in');
    expect(classifySite('A1', '', 'GROUP TENT').isGroup).toBe(true);
    expect(classifySite('A1', '', 'EQUESTRIAN').isEquestrian).toBe(true);
    expect(classifySite('A1', '', 'CABIN NONELECTRIC').siteKind).toBe('cabin');
    expect(classifySite('A1', '', 'DAY USE').isDayUse).toBe(true);
  });
  it('falls back to name patterns when campsite_type is absent or empty', () => {
    expect(classifySite('Tent Site 7', '', '').siteKind).toBe('tent');
    expect(classifySite('Tent Site 7', '', undefined).siteKind).toBe('tent');
  });
  it('does not treat NONELECTRIC as a hookup', () => {
    expect(classifySite('047', '', 'STANDARD NONELECTRIC').siteKind).toBeNull();
    expect(classifySite('047', '', 'TENT ONLY NONELECTRIC').siteKind).toBe('tent');
    expect(classifySite('047', '', 'STANDARD ELECTRIC').siteKind).toBe('hookup');
  });
  it('only flags day-use on DAY USE, not other DAY substrings', () => {
    expect(classifySite('047', '', 'STANDARD HOLIDAY').isDayUse).toBe(false);
    expect(classifySite('047', '', 'WEEKDAY STANDARD').isDayUse).toBe(false);
  });
});

describe('isWalkUpSite (re-exported helper)', () => {
  it('matches hike/bike regardless of separator', () => {
    expect(isWalkUpSite('Hike/Bike 1')).toBe(true);
    expect(isWalkUpSite('Hike & Bike Site')).toBe(true);
    expect(isWalkUpSite('Standard Site 4')).toBe(false);
  });
});
