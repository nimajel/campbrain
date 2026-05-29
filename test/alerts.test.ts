import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AlertSchema } from '../src/config/alerts.js';
import type { Alert } from '../src/config/alerts.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAlertInput(overrides: Partial<Alert> = {}): Partial<Alert> {
  return {
    id: 'test-alert',
    name: 'Test Alert',
    provider: 'california-parks',
    parkName: 'Test Park',
    parkPageId: '999',
    campgroundName: 'Test Campground',
    acceptableSites: ['Site A'],
    preferredSites: ['Site A'],
    campingType: 'hike-in',
    people: 2,
    dateMode: 'next_available_weekend',
    nextWeeksCount: 4,
    minNights: 1,
    maxNights: 2,
    weekendsOnly: true,
    bookingRule: {
      type: 'rolling_months_before',
      monthsBefore: 6,
      releaseTime: '08:00',
      timezone: 'America/Los_Angeles',
    },
    enabled: true,
    emailEnabled: true,
    calendarEnabled: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Create valid alert
// ---------------------------------------------------------------------------

describe('AlertSchema.parse — valid alert', () => {
  it('parses a complete valid alert', () => {
    const result = AlertSchema.safeParse(makeAlertInput());
    expect(result.success).toBe(true);
  });

  it('defaults enabled to true when absent', () => {
    const input = makeAlertInput();
    delete (input as Record<string, unknown>)['enabled'];
    const result = AlertSchema.parse(input);
    expect(result.enabled).toBe(true);
  });

  it('defaults emailEnabled to true when absent', () => {
    const input = makeAlertInput();
    delete (input as Record<string, unknown>)['emailEnabled'];
    const result = AlertSchema.parse(input);
    expect(result.emailEnabled).toBe(true);
  });

  it('defaults calendarEnabled to false when absent', () => {
    const input = makeAlertInput();
    delete (input as Record<string, unknown>)['calendarEnabled'];
    const result = AlertSchema.parse(input);
    expect(result.calendarEnabled).toBe(false);
  });

  it('preserves explicit enabled: false', () => {
    const result = AlertSchema.parse(makeAlertInput({ enabled: false }));
    expect(result.enabled).toBe(false);
  });

  it('preserves emailEnabled: false', () => {
    const result = AlertSchema.parse(makeAlertInput({ emailEnabled: false }));
    expect(result.emailEnabled).toBe(false);
  });

  it('preserves calendarEnabled: true', () => {
    const result = AlertSchema.parse(makeAlertInput({ calendarEnabled: true }));
    expect(result.calendarEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Reject invalid: no acceptable sites
// ---------------------------------------------------------------------------

describe('AlertSchema.parse — validation rejections', () => {
  it('rejects alert with empty acceptableSites', () => {
    const input = makeAlertInput({ acceptableSites: [] });
    const result = AlertSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('acceptable site'))).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Reject maxNights < minNights
  // ---------------------------------------------------------------------------

  it('rejects alert where maxNights < minNights', () => {
    const input = makeAlertInput({ minNights: 3, maxNights: 1 });
    const result = AlertSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('maxNights'))).toBe(true);
    }
  });

  it('accepts maxNights === minNights', () => {
    const result = AlertSchema.safeParse(makeAlertInput({ minNights: 2, maxNights: 2 }));
    expect(result.success).toBe(true);
  });

  it('rejects people < 1', () => {
    const result = AlertSchema.safeParse(makeAlertInput({ people: 0 }));
    expect(result.success).toBe(false);
  });

  it('rejects minNights < 1', () => {
    const result = AlertSchema.safeParse(makeAlertInput({ minNights: 0, maxNights: 2 }));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Disable alert excludes it from active alerts
// ---------------------------------------------------------------------------

describe('activeAlerts filtering', () => {
  it('enabled alert passes the enabled filter', () => {
    const alert = AlertSchema.parse(makeAlertInput({ enabled: true }));
    const active = [alert].filter((a) => a.enabled);
    expect(active).toHaveLength(1);
  });

  it('disabled alert is excluded from active filter', () => {
    const alert = AlertSchema.parse(makeAlertInput({ enabled: false }));
    const active = [alert].filter((a) => a.enabled);
    expect(active).toHaveLength(0);
  });

  it('mixed enabled/disabled alerts: only enabled appear in active list', () => {
    const a1 = AlertSchema.parse(makeAlertInput({ id: 'a1', enabled: true }));
    const a2 = AlertSchema.parse(makeAlertInput({ id: 'a2', enabled: false }));
    const a3 = AlertSchema.parse(makeAlertInput({ id: 'a3', enabled: true }));
    const active = [a1, a2, a3].filter((a) => a.enabled);
    expect(active.map((a) => a.id)).toEqual(['a1', 'a3']);
  });
});

// ---------------------------------------------------------------------------
// 5. CLI scan would skip disabled alerts (filter logic)
// ---------------------------------------------------------------------------

describe('scan alert filtering', () => {
  it('only enabled alerts are returned by active filter', () => {
    const enabled = AlertSchema.parse(makeAlertInput({ id: 'e1', enabled: true }));
    const disabled = AlertSchema.parse(makeAlertInput({ id: 'd1', enabled: false }));
    const all = [enabled, disabled];
    const toScan = all.filter((a) => a.enabled);
    expect(toScan).toHaveLength(1);
    expect(toScan[0]?.id).toBe('e1');
  });

  it('targetId filter picks specific alert regardless of enabled', () => {
    const disabled = AlertSchema.parse(makeAlertInput({ id: 'specific', enabled: false }));
    const all = [disabled];
    const toScan = all.filter((a) => a.id === 'specific');
    expect(toScan).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Email notification respects emailEnabled
// ---------------------------------------------------------------------------

describe('emailEnabled filtering', () => {
  it('email-enabled alert gets email notifications', () => {
    const alert = AlertSchema.parse(makeAlertInput({ emailEnabled: true }));
    const emailQueue = [alert].filter((a) => a.emailEnabled);
    expect(emailQueue).toHaveLength(1);
  });

  it('email-disabled alert does not get email notifications', () => {
    const alert = AlertSchema.parse(makeAlertInput({ emailEnabled: false }));
    const emailQueue = [alert].filter((a) => a.emailEnabled);
    expect(emailQueue).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Calendar sync respects calendarEnabled
// ---------------------------------------------------------------------------

describe('calendarEnabled filtering', () => {
  it('calendarEnabled alerts are picked for calendar sync', () => {
    const a1 = AlertSchema.parse(makeAlertInput({ id: 'cal', calendarEnabled: true }));
    const a2 = AlertSchema.parse(makeAlertInput({ id: 'nocal', calendarEnabled: false }));
    const forCalendar = [a1, a2].filter((a) => a.calendarEnabled);
    expect(forCalendar.map((a) => a.id)).toEqual(['cal']);
  });

  it('falls back to all active when no calendarEnabled alerts', () => {
    const a1 = AlertSchema.parse(makeAlertInput({ id: 'a1', enabled: true, calendarEnabled: false }));
    const a2 = AlertSchema.parse(makeAlertInput({ id: 'a2', enabled: true, calendarEnabled: false }));
    const calAlerts = [a1, a2].filter((a) => a.calendarEnabled);
    const activeAlerts = [a1, a2].filter((a) => a.enabled);
    const effective = calAlerts.length > 0 ? calAlerts : activeAlerts;
    expect(effective).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 8. Existing Angel Island seed still works
// ---------------------------------------------------------------------------

describe('Angel Island seed compatibility', () => {
  it('parses the seed target config with alert defaults', () => {
    const seed = {
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
      bookingRule: {
        type: 'rolling_months_before',
        monthsBefore: 6,
        releaseTime: '08:00',
        timezone: 'America/Los_Angeles',
      },
      // alert fields (as they now appear in data/targets.json)
      enabled: true,
      emailEnabled: true,
      calendarEnabled: false,
    };

    const result = AlertSchema.parse(seed);
    expect(result.id).toBe('angel-island-ridge-weekends');
    expect(result.enabled).toBe(true);
    expect(result.emailEnabled).toBe(true);
    expect(result.calendarEnabled).toBe(false);
  });

  it('parses the seed without alert fields and applies defaults', () => {
    const legacySeed = {
      id: 'angel-island-ridge-weekends',
      name: 'Angel Island Ridge weekends',
      provider: 'california-parks',
      parkName: 'Angel Island SP',
      parkPageId: '468',
      campgroundName: 'Ridge (sites 4-6)',
      acceptableSites: ['Hike in Campsite #4'],
      preferredSites: ['Hike in Campsite #4'],
      campingType: 'hike-in',
      people: 2,
      dateMode: 'next_available_weekend',
      nextWeeksCount: 12,
      minNights: 1,
      maxNights: 2,
      weekendsOnly: true,
      bookingRule: {
        type: 'rolling_months_before',
        monthsBefore: 6,
        releaseTime: '08:00',
        timezone: 'America/Los_Angeles',
      },
      // No alert fields → should default
    };

    const result = AlertSchema.parse(legacySeed);
    expect(result.enabled).toBe(true);
    expect(result.emailEnabled).toBe(true);
    expect(result.calendarEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. data/targets.json compatibility
// ---------------------------------------------------------------------------

describe('targets.json compatibility', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'campbrain-alerts-test-'));
    mkdirSync(join(tmpDir, 'data'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('targets.json with extra alert fields is still parseable', () => {
    const content = {
      targets: [
        {
          ...makeAlertInput(),
          enabled: false,
          emailEnabled: false,
          calendarEnabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-05-28T00:00:00.000Z',
        },
      ],
    };
    const p = join(tmpDir, 'data', 'targets.json');
    writeFileSync(p, JSON.stringify(content, null, 2), 'utf-8');
    const raw = JSON.parse(require('fs').readFileSync(p, 'utf-8'));
    const result = AlertSchema.safeParse(raw.targets[0]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
      expect(result.data.calendarEnabled).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Dedupe still works with alert IDs
// ---------------------------------------------------------------------------

describe('hit deduplication with alert IDs', () => {
  it('hitKey uses targetId (same as alertId) for dedup', async () => {
    const { hitKey } = await import('../src/state/scan-state.js');
    const hit = {
      targetId: 'angel-island-ridge-weekends',
      targetName: 'Angel Island Ridge',
      siteName: 'Site 4',
      arrivalDate: '2026-08-14',
      departureDate: '2026-08-16',
      nights: 2,
      firstSeenAt: '2026-05-28T12:00:00.000Z',
      lastSeenAt: '2026-05-28T12:00:00.000Z',
    };
    const key = hitKey(hit);
    expect(key).toBe('angel-island-ridge-weekends|Site 4|2026-08-14|2026-08-16');
  });

  it('two hits with the same alertId + site + dates share a dedup key', async () => {
    const { hitKey } = await import('../src/state/scan-state.js');
    const hit1 = {
      targetId: 'my-alert',
      targetName: 'My Alert',
      siteName: 'Site A',
      arrivalDate: '2026-08-14',
      departureDate: '2026-08-16',
      nights: 2,
      firstSeenAt: '2026-05-01T00:00:00.000Z',
      lastSeenAt: '2026-05-01T00:00:00.000Z',
    };
    const hit2 = { ...hit1, firstSeenAt: '2026-05-28T00:00:00.000Z', lastSeenAt: '2026-05-28T00:00:00.000Z' };
    expect(hitKey(hit1)).toBe(hitKey(hit2));
  });
});
