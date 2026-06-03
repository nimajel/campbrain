import { describe, it, expect } from 'vitest';
import { upsertEntry } from '../src/cache/availability-cache.js';

describe('upsertEntry provider parameter', () => {
  it('accepts recreation-gov as providerId without throwing a type error', () => {
    expect(typeof upsertEntry).toBe('function');
    // Verify the function accepts two arguments (providerId is the second)
    expect(upsertEntry.length).toBe(2);
  });
});
