import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleNotificationService } from '../src/notifications/console-notification-service.js';
import { EmailNotificationService, buildEmailBody, buildEmailSubject } from '../src/notifications/email-notification-service.js';
import type { AvailabilityAlert } from '../src/notifications/notification-service.js';
import type { AvailabilityHitRecord } from '../src/state/scan-state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHit(overrides: Partial<AvailabilityHitRecord> = {}): AvailabilityHitRecord {
  return {
    targetId: 'angel-island',
    targetName: 'Angel Island Ridge',
    siteName: 'Site 4',
    arrivalDate: '2026-08-14',
    departureDate: '2026-08-16',
    nights: 2,
    firstSeenAt: '2026-05-28T12:00:00.000Z',
    lastSeenAt: '2026-05-28T12:00:00.000Z',
    ...overrides,
  };
}

function makeAlert(overrides: Partial<AvailabilityAlert> = {}): AvailabilityAlert {
  return {
    hit: makeHit(),
    parkName: 'Angel Island State Park',
    campgroundName: 'Ridge Campground',
    sourceUrl: 'https://www.parks.ca.gov/AvailabilityInfo?arrival_date=2026-08-14&length=2&page_id=468',
    checkedAt: '2026-05-28T12:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Delivery contract
// ---------------------------------------------------------------------------

describe('EmailNotificationService — delivery results', () => {
  beforeEach(() => {
    delete process.env['RESEND_API_KEY'];
    delete process.env['ALERT_EMAIL_TO'];
    delete process.env['ALERT_EMAIL_FROM'];
  });

  it('returns skipped-unconfigured when env vars are absent', async () => {
    const service = new EmailNotificationService();
    const alert = makeAlert();
    await expect(service.notify([alert])).resolves.toBe('skipped-unconfigured');
  });

  it('returns delivered (nothing to send) with empty alerts list', async () => {
    const service = new EmailNotificationService();
    await expect(service.notify([])).resolves.toBe('delivered');
  });
});

// ---------------------------------------------------------------------------
// 4. Email body includes booking URL and source URL
// ---------------------------------------------------------------------------

describe('buildEmailBody', () => {
  it('includes site name, arrival date, departure date, and nights', () => {
    const alert = makeAlert();
    const body = buildEmailBody([alert]);
    expect(body).toContain('Site 4');
    expect(body).toContain('2026-08-14');
    expect(body).toContain('2026-08-16');
    expect(body).toContain('2 nights');
  });

  it('includes source URL', () => {
    const alert = makeAlert();
    const body = buildEmailBody([alert]);
    expect(body).toContain('parks.ca.gov');
  });

  it('includes booking URL when present', () => {
    const alert = makeAlert({
      hit: makeHit({ bookingUrl: 'https://reservecalifornia.com/book/123' }),
    });
    const body = buildEmailBody([alert]);
    expect(body).toContain('https://reservecalifornia.com/book/123');
  });

  it('omits booking URL line when absent', () => {
    const alert = makeAlert(); // no bookingUrl
    const body = buildEmailBody([alert]);
    expect(body).not.toContain('reservecalifornia.com');
  });

  it('includes the manual booking warning', () => {
    const body = buildEmailBody([makeAlert()]);
    expect(body).toContain('manually');
    expect(body).toContain('official reservation site');
  });

  it('includes target name and park', () => {
    const body = buildEmailBody([makeAlert()]);
    expect(body).toContain('Angel Island Ridge');
    expect(body).toContain('Angel Island State Park');
  });

  it('includes the As-of freshness line when availabilityAsOf is set', () => {
    const alert = makeAlert({ availabilityAsOf: '2026-05-28T21:45:00.000Z' });
    const body = buildEmailBody([alert]);
    expect(body).toContain('As of:');
    expect(body).toContain('verify on the booking site before booking');
  });

  it('omits the As-of line when availabilityAsOf is absent', () => {
    const body = buildEmailBody([makeAlert()]);
    expect(body).not.toContain('As of:');
  });
});

describe('buildEmailSubject', () => {
  it('includes target name for a single alert', () => {
    const subject = buildEmailSubject([makeAlert()]);
    expect(subject).toContain('Angel Island Ridge');
  });

  it('mentions count for multiple alerts', () => {
    const subject = buildEmailSubject([makeAlert(), makeAlert()]);
    expect(subject).toContain('2');
  });
});

// ---------------------------------------------------------------------------
// 5. Console notification formats useful output
// ---------------------------------------------------------------------------

describe('ConsoleNotificationService', () => {
  it('logs target name, site, arrival, and departure', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const service = new ConsoleNotificationService();
      await service.notify([makeAlert()]);

      const output = logSpy.mock.calls.flat().join('\n');
      expect(output).toContain('Angel Island Ridge');
      expect(output).toContain('Site 4');
      expect(output).toContain('2026-08-14');
      expect(output).toContain('2026-08-16');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('logs booking URL when present', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const service = new ConsoleNotificationService();
      const alert = makeAlert({
        hit: makeHit({ bookingUrl: 'https://reservecalifornia.com/book/99' }),
      });
      await service.notify([alert]);

      const output = logSpy.mock.calls.flat().join('\n');
      expect(output).toContain('https://reservecalifornia.com/book/99');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('returns delivered on empty alerts list', async () => {
    const service = new ConsoleNotificationService();
    await expect(service.notify([])).resolves.toBe('delivered');
  });
});
