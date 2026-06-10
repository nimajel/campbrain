import { describe, it, expect } from 'vitest';
import { cycleDetent } from '../web/lib/sheet-detent.js';

describe('cycleDetent', () => {
  it('peek → half → full → peek', () => {
    expect(cycleDetent('peek')).toBe('half');
    expect(cycleDetent('half')).toBe('full');
    expect(cycleDetent('full')).toBe('peek');
  });
});
