import { describe, it, expect } from 'vitest';
import {
  MapAvailabilityInputSchema,
  MapSummaryInputSchema,
} from '../src/map';
import type { MapAvailabilityInput, MapSummaryInput } from '../src/map';

// ---------------------------------------------------------------------------
// 1. MapAvailabilityInputSchema
// ---------------------------------------------------------------------------

describe('MapAvailabilityInputSchema', () => {
  it('accepts minimal input with only parkPageId and defaults arrays to []', () => {
    const result = MapAvailabilityInputSchema.parse({ parkPageId: '468' });
    expect(result.parkPageId).toBe('468');
    expect(result.access).toEqual([]);
    expect(result.kinds).toEqual([]);
    expect(result.hide).toEqual([]);
  });

  it('rejects a bad access value', () => {
    const result = MapAvailabilityInputSchema.safeParse({
      parkPageId: '468',
      access: ['car'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid access values', () => {
    const result = MapAvailabilityInputSchema.safeParse({
      parkPageId: '468',
      access: ['drive_in', 'hike_in', 'boat_in'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional from/to dates in iso format', () => {
    const result = MapAvailabilityInputSchema.safeParse({
      parkPageId: '468',
      from: '2026-08-01',
      to: '2026-08-08',
    });
    expect(result.success).toBe(true);
  });

  it('rejects from date in wrong format', () => {
    const result = MapAvailabilityInputSchema.safeParse({
      parkPageId: '468',
      from: '08/01/2026',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional provider field', () => {
    const result = MapAvailabilityInputSchema.safeParse({
      parkPageId: '468',
      provider: 'california-parks',
    });
    expect(result.success).toBe(true);
  });

  it('rejects bad kinds value', () => {
    const result = MapAvailabilityInputSchema.safeParse({
      parkPageId: '468',
      kinds: ['rv'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects bad hide value', () => {
    const result = MapAvailabilityInputSchema.safeParse({
      parkPageId: '468',
      hide: ['dogs'],
    });
    expect(result.success).toBe(false);
  });

  it('inferred type is MapAvailabilityInput', () => {
    const input: MapAvailabilityInput = {
      parkPageId: '468',
      access: [],
      kinds: [],
      hide: [],
    };
    expect(input.parkPageId).toBe('468');
  });
});

// ---------------------------------------------------------------------------
// 2. MapSummaryInputSchema
// ---------------------------------------------------------------------------

describe('MapSummaryInputSchema', () => {
  it('accepts empty object and defaults weekendsOnly=false and arrays to []', () => {
    const result = MapSummaryInputSchema.parse({});
    expect(result.weekendsOnly).toBe(false);
    expect(result.access).toEqual([]);
    expect(result.kinds).toEqual([]);
    expect(result.hide).toEqual([]);
  });

  it('accepts minNights: 2', () => {
    const result = MapSummaryInputSchema.parse({ minNights: 2 });
    expect(result.minNights).toBe(2);
    expect(result.weekendsOnly).toBe(false);
  });

  it('rejects minNights: 4', () => {
    const result = MapSummaryInputSchema.safeParse({ minNights: 4 });
    expect(result.success).toBe(false);
  });

  it('minNights is optional (undefined when not provided)', () => {
    const result = MapSummaryInputSchema.parse({});
    expect(result.minNights).toBeUndefined();
  });

  it('accepts valid from/to dates', () => {
    const result = MapSummaryInputSchema.safeParse({
      from: '2026-08-01',
      to: '2026-08-08',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid to date format', () => {
    const result = MapSummaryInputSchema.safeParse({ to: '2026/08/08' });
    expect(result.success).toBe(false);
  });

  it('accepts weekendsOnly: true', () => {
    const result = MapSummaryInputSchema.parse({ weekendsOnly: true });
    expect(result.weekendsOnly).toBe(true);
  });

  it('rejects minNights: 0', () => {
    const result = MapSummaryInputSchema.safeParse({ minNights: 0 });
    expect(result.success).toBe(false);
  });

  it('accepts all three valid minNights values', () => {
    for (const n of [1, 2, 3] as const) {
      const result = MapSummaryInputSchema.safeParse({ minNights: n });
      expect(result.success).toBe(true);
    }
  });

  it('inferred type is MapSummaryInput', () => {
    const input: MapSummaryInput = {
      weekendsOnly: false,
      access: [],
      kinds: [],
      hide: [],
    };
    expect(input.weekendsOnly).toBe(false);
  });
});
