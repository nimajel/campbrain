import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveIntervalMinutes } from '../src/cli/commands/worker.js';

// ---------------------------------------------------------------------------
// resolveIntervalMinutes — interval configuration and clamping
// ---------------------------------------------------------------------------

describe('resolveIntervalMinutes', () => {
  beforeEach(() => {
    delete process.env['CAMPBRAIN_SCAN_INTERVAL_MINUTES'];
  });

  afterEach(() => {
    delete process.env['CAMPBRAIN_SCAN_INTERVAL_MINUTES'];
  });

  it('returns default 60 when no flag and no env var are set', () => {
    expect(resolveIntervalMinutes(undefined, undefined)).toBe(60);
  });

  it('uses the flag value when provided', () => {
    expect(resolveIntervalMinutes(30, undefined)).toBe(30);
  });

  it('uses the env var when no flag is provided', () => {
    expect(resolveIntervalMinutes(undefined, '45')).toBe(45);
  });

  it('prefers flag over env var', () => {
    expect(resolveIntervalMinutes(20, '90')).toBe(20);
  });

  it('clamps to 15 when flag is below minimum', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(resolveIntervalMinutes(5, undefined)).toBe(15);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('clamps to 15 when env var is below minimum', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(resolveIntervalMinutes(undefined, '10')).toBe(15);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('logs a warning when clamping', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      resolveIntervalMinutes(1, undefined);
      expect(warnSpy).toHaveBeenCalledOnce();
      const msg = warnSpy.mock.calls[0]?.[0] as string;
      expect(msg).toContain('15');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('allows exactly 15 minutes without clamping', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(resolveIntervalMinutes(15, undefined)).toBe(15);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('falls back to default when env var is not a number', () => {
    expect(resolveIntervalMinutes(undefined, 'not-a-number')).toBe(60);
  });
});
