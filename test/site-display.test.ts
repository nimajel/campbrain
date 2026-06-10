import { describe, it, expect } from 'vitest';
import { formatSiteName } from '../web/lib/site-display.js';

describe('formatSiteName', () => {
  it('title-cases all-caps words', () => {
    expect(formatSiteName('MARSHALL BEACH BOAT IN GROUP 1')).toBe('Marshall Beach Boat In Group 1');
  });

  it('leaves mixed-case names untouched', () => {
    expect(formatSiteName('Campsite #42')).toBe('Campsite #42');
  });

  it('keeps single letters and capacity ranges as-is', () => {
    expect(formatSiteName('BOAT A, 1-6 people')).toBe('Boat A, 1-6 people');
  });

  it('keeps digit-bearing tokens untouched', () => {
    expect(formatSiteName('SITE #12B')).toBe('Site #12B');
  });

  it('collapses runs of whitespace', () => {
    expect(formatSiteName('  BOAT   ONLY,  15-25 people ')).toBe('Boat Only, 15-25 people');
  });

  it('leaves #-prefixed site codes uppercase', () => {
    expect(formatSiteName('GROUP TENT CAMPSITE #GTC')).toBe('Group Tent Campsite #GTC');
  });
});
