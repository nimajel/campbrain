import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('proactive scanner provider filter', () => {
  it('does not have a california-parks-only filter', () => {
    const src = readFileSync('./src/scanner/proactive-scanner.ts', 'utf-8');
    expect(src).not.toContain("p.provider !== 'california-parks'");
    expect(src).not.toContain("provider !== 'california-parks'");
  });
});
