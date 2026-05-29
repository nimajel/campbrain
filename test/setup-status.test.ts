import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  maskEmail,
  getEmailStatus,
  getCalendarStatus,
  getWorkerStatus,
  getStateStatus,
  getAlertsStatus,
  getSetupStatus,
} from '../src/status/setup-status.js';

// ---------------------------------------------------------------------------
// maskEmail helper
// ---------------------------------------------------------------------------

describe('maskEmail', () => {
  it('masks the local part leaving only first character', () => {
    expect(maskEmail('jelvehn@gmail.com')).toBe('j***@gmail.com');
  });

  it('works with short local parts', () => {
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
  });

  it('returns *** for malformed input', () => {
    expect(maskEmail('notanemail')).toBe('***');
  });
});

// ---------------------------------------------------------------------------
// 1. Missing email env vars
// ---------------------------------------------------------------------------

describe('getEmailStatus — missing env vars', () => {
  const saved = {
    RESEND_API_KEY: process.env['RESEND_API_KEY'],
    ALERT_EMAIL_TO: process.env['ALERT_EMAIL_TO'],
    ALERT_EMAIL_FROM: process.env['ALERT_EMAIL_FROM'],
  };

  beforeEach(() => {
    delete process.env['RESEND_API_KEY'];
    delete process.env['ALERT_EMAIL_TO'];
    delete process.env['ALERT_EMAIL_FROM'];
  });

  afterEach(() => {
    if (saved.RESEND_API_KEY !== undefined) process.env['RESEND_API_KEY'] = saved.RESEND_API_KEY;
    if (saved.ALERT_EMAIL_TO !== undefined) process.env['ALERT_EMAIL_TO'] = saved.ALERT_EMAIL_TO;
    if (saved.ALERT_EMAIL_FROM !== undefined) process.env['ALERT_EMAIL_FROM'] = saved.ALERT_EMAIL_FROM;
  });

  it('configured is false when all env vars missing', () => {
    const status = getEmailStatus();
    expect(status.configured).toBe(false);
  });

  it('all hasX flags are false', () => {
    const status = getEmailStatus();
    expect(status.hasResendApiKey).toBe(false);
    expect(status.hasAlertEmailTo).toBe(false);
    expect(status.hasAlertEmailFrom).toBe(false);
  });

  it('safeDestinationLabel is empty string', () => {
    const status = getEmailStatus();
    expect(status.safeDestinationLabel).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 2. Configured email env vars
// ---------------------------------------------------------------------------

describe('getEmailStatus — configured env vars', () => {
  const saved = {
    RESEND_API_KEY: process.env['RESEND_API_KEY'],
    ALERT_EMAIL_TO: process.env['ALERT_EMAIL_TO'],
    ALERT_EMAIL_FROM: process.env['ALERT_EMAIL_FROM'],
  };

  beforeEach(() => {
    process.env['RESEND_API_KEY'] = 're_secret_key_123';
    process.env['ALERT_EMAIL_TO'] = 'jelvehn@gmail.com';
    process.env['ALERT_EMAIL_FROM'] = 'noreply@campbrain.local';
  });

  afterEach(() => {
    if (saved.RESEND_API_KEY !== undefined) process.env['RESEND_API_KEY'] = saved.RESEND_API_KEY;
    else delete process.env['RESEND_API_KEY'];
    if (saved.ALERT_EMAIL_TO !== undefined) process.env['ALERT_EMAIL_TO'] = saved.ALERT_EMAIL_TO;
    else delete process.env['ALERT_EMAIL_TO'];
    if (saved.ALERT_EMAIL_FROM !== undefined) process.env['ALERT_EMAIL_FROM'] = saved.ALERT_EMAIL_FROM;
    else delete process.env['ALERT_EMAIL_FROM'];
  });

  it('configured is true when all env vars present', () => {
    expect(getEmailStatus().configured).toBe(true);
  });

  it('all hasX flags are true', () => {
    const status = getEmailStatus();
    expect(status.hasResendApiKey).toBe(true);
    expect(status.hasAlertEmailTo).toBe(true);
    expect(status.hasAlertEmailFrom).toBe(true);
  });

  it('safeDestinationLabel is masked email, not raw value', () => {
    const status = getEmailStatus();
    expect(status.safeDestinationLabel).toBe('j***@gmail.com');
    expect(status.safeDestinationLabel).not.toBe('jelvehn@gmail.com');
  });

  // ---------------------------------------------------------------------------
  // 5. No raw secrets in output
  // ---------------------------------------------------------------------------

  it('output does not contain the raw RESEND_API_KEY value', () => {
    const status = getEmailStatus();
    const json = JSON.stringify(status);
    expect(json).not.toContain('re_secret_key_123');
  });

  it('output does not contain the raw ALERT_EMAIL_TO value', () => {
    const status = getEmailStatus();
    const json = JSON.stringify(status);
    expect(json).not.toContain('jelvehn@gmail.com');
  });

  it('full setup status output does not contain any raw secret', () => {
    const status = getSetupStatus();
    const json = JSON.stringify(status);
    expect(json).not.toContain('re_secret_key_123');
    expect(json).not.toContain('jelvehn@gmail.com');
  });
});

// ---------------------------------------------------------------------------
// 3. Missing calendar env vars
// ---------------------------------------------------------------------------

describe('getCalendarStatus — missing env vars', () => {
  const saved = {
    GOOGLE_CLIENT_ID: process.env['GOOGLE_CLIENT_ID'],
    GOOGLE_CLIENT_SECRET: process.env['GOOGLE_CLIENT_SECRET'],
    GOOGLE_REDIRECT_URI: process.env['GOOGLE_REDIRECT_URI'],
  };

  beforeEach(() => {
    delete process.env['GOOGLE_CLIENT_ID'];
    delete process.env['GOOGLE_CLIENT_SECRET'];
    delete process.env['GOOGLE_REDIRECT_URI'];
  });

  afterEach(() => {
    if (saved.GOOGLE_CLIENT_ID !== undefined) process.env['GOOGLE_CLIENT_ID'] = saved.GOOGLE_CLIENT_ID;
    if (saved.GOOGLE_CLIENT_SECRET !== undefined) process.env['GOOGLE_CLIENT_SECRET'] = saved.GOOGLE_CLIENT_SECRET;
    if (saved.GOOGLE_REDIRECT_URI !== undefined) process.env['GOOGLE_REDIRECT_URI'] = saved.GOOGLE_REDIRECT_URI;
  });

  it('configured is false when client ID and secret are absent', () => {
    expect(getCalendarStatus('/nonexistent/token.json').configured).toBe(false);
  });

  it('all hasX flags are false', () => {
    const status = getCalendarStatus('/nonexistent/token.json');
    expect(status.hasGoogleClientId).toBe(false);
    expect(status.hasGoogleClientSecret).toBe(false);
    expect(status.hasGoogleRedirectUri).toBe(false);
  });

  it('hasSavedToken is false when token file does not exist', () => {
    expect(getCalendarStatus('/nonexistent/token.json').hasSavedToken).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Saved token detection
// ---------------------------------------------------------------------------

describe('getCalendarStatus — token detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'campbrain-status-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('hasSavedToken is false when token file missing', () => {
    const status = getCalendarStatus(join(tmpDir, 'google-token.json'));
    expect(status.hasSavedToken).toBe(false);
  });

  it('hasSavedToken is true when token file exists', () => {
    const tokenFile = join(tmpDir, 'google-token.json');
    writeFileSync(tokenFile, JSON.stringify({ access_token: 'tok', refresh_token: 'ref' }), 'utf-8');
    const status = getCalendarStatus(tokenFile);
    expect(status.hasSavedToken).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getStateStatus
// ---------------------------------------------------------------------------

describe('getStateStatus', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'campbrain-state-status-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('all false when state directory is empty', () => {
    const status = getStateStatus(tmpDir);
    expect(status.latestScanResultsExists).toBe(false);
    expect(status.availabilityHitsExists).toBe(false);
    expect(status.calendarEventsExists).toBe(false);
  });

  it('detects latest-scan-results.json when present', () => {
    writeFileSync(join(tmpDir, 'latest-scan-results.json'), '{}', 'utf-8');
    expect(getStateStatus(tmpDir).latestScanResultsExists).toBe(true);
  });

  it('detects availability-hits.json when present', () => {
    writeFileSync(join(tmpDir, 'availability-hits.json'), '{}', 'utf-8');
    expect(getStateStatus(tmpDir).availabilityHitsExists).toBe(true);
  });

  it('detects calendar-events.json when present', () => {
    writeFileSync(join(tmpDir, 'calendar-events.json'), '{}', 'utf-8');
    expect(getStateStatus(tmpDir).calendarEventsExists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getWorkerStatus
// ---------------------------------------------------------------------------

describe('getWorkerStatus', () => {
  const savedInterval = process.env['CAMPBRAIN_SCAN_INTERVAL_MINUTES'];
  const savedScanOnStart = process.env['CAMPBRAIN_SCAN_ON_START'];

  afterEach(() => {
    if (savedInterval !== undefined) process.env['CAMPBRAIN_SCAN_INTERVAL_MINUTES'] = savedInterval;
    else delete process.env['CAMPBRAIN_SCAN_INTERVAL_MINUTES'];
    if (savedScanOnStart !== undefined) process.env['CAMPBRAIN_SCAN_ON_START'] = savedScanOnStart;
    else delete process.env['CAMPBRAIN_SCAN_ON_START'];
  });

  it('returns default 60 when CAMPBRAIN_SCAN_INTERVAL_MINUTES is not set', () => {
    delete process.env['CAMPBRAIN_SCAN_INTERVAL_MINUTES'];
    expect(getWorkerStatus().defaultIntervalMinutes).toBe(60);
  });

  it('returns configured interval from env var', () => {
    process.env['CAMPBRAIN_SCAN_INTERVAL_MINUTES'] = '30';
    expect(getWorkerStatus().defaultIntervalMinutes).toBe(30);
  });

  it('falls back to 60 when env var interval is below minimum', () => {
    process.env['CAMPBRAIN_SCAN_INTERVAL_MINUTES'] = '5';
    expect(getWorkerStatus().defaultIntervalMinutes).toBe(60);
  });

  it('minimumIntervalMinutes is always 15', () => {
    expect(getWorkerStatus().minimumIntervalMinutes).toBe(15);
  });

  it('scanOnStart is true by default', () => {
    delete process.env['CAMPBRAIN_SCAN_ON_START'];
    expect(getWorkerStatus().scanOnStart).toBe(true);
  });

  it('scanOnStart is false when env var is "false"', () => {
    process.env['CAMPBRAIN_SCAN_ON_START'] = 'false';
    expect(getWorkerStatus().scanOnStart).toBe(false);
  });

  it('includes recommendedCommand', () => {
    expect(getWorkerStatus().recommendedCommand).toBe('npm run worker');
  });
});

// ---------------------------------------------------------------------------
// 6. Alert counts
// ---------------------------------------------------------------------------

describe('getAlertsStatus', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'campbrain-alerts-status-test-'));
    mkdirSync(join(tmpDir, 'data'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns zeros when targets.json does not exist', () => {
    expect(getAlertsStatus(join(tmpDir, 'data'))).toEqual({
      count: 0,
      enabledCount: 0,
      disabledCount: 0,
    });
  });

  it('counts enabled and disabled alerts', () => {
    const content = {
      targets: [
        { id: 'a', enabled: true },
        { id: 'b', enabled: false },
        { id: 'c', enabled: true },
      ],
    };
    writeFileSync(
      join(tmpDir, 'data', 'targets.json'),
      JSON.stringify(content),
      'utf-8'
    );
    const status = getAlertsStatus(join(tmpDir, 'data'));
    expect(status.count).toBe(3);
    expect(status.enabledCount).toBe(2);
    expect(status.disabledCount).toBe(1);
  });

  it('treats absent enabled field as enabled (default true)', () => {
    const content = { targets: [{ id: 'x' }, { id: 'y', enabled: false }] };
    writeFileSync(
      join(tmpDir, 'data', 'targets.json'),
      JSON.stringify(content),
      'utf-8'
    );
    const status = getAlertsStatus(join(tmpDir, 'data'));
    expect(status.enabledCount).toBe(1);
    expect(status.disabledCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getSetupStatus — aggregate
// ---------------------------------------------------------------------------

describe('getSetupStatus', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'campbrain-full-status-test-'));
    mkdirSync(join(tmpDir, 'state'));
    mkdirSync(join(tmpDir, 'data'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all expected top-level keys', () => {
    const status = getSetupStatus({
      stateDir: join(tmpDir, 'state'),
      tokenPath: join(tmpDir, 'google-token.json'),
      dataDir: join(tmpDir, 'data'),
    });
    expect(status).toHaveProperty('email');
    expect(status).toHaveProperty('calendar');
    expect(status).toHaveProperty('worker');
    expect(status).toHaveProperty('state');
    expect(status).toHaveProperty('targetsOrAlerts');
  });

  it('reports state files correctly for empty dirs', () => {
    const status = getSetupStatus({
      stateDir: join(tmpDir, 'state'),
      tokenPath: join(tmpDir, 'google-token.json'),
      dataDir: join(tmpDir, 'data'),
    });
    expect(status.state.latestScanResultsExists).toBe(false);
    expect(status.state.availabilityHitsExists).toBe(false);
    expect(status.state.calendarEventsExists).toBe(false);
    expect(status.calendar.hasSavedToken).toBe(false);
    expect(status.targetsOrAlerts.count).toBe(0);
  });
});
