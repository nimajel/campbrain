import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailStatus {
  configured: boolean;
  hasResendApiKey: boolean;
  hasAlertEmailTo: boolean;
  hasAlertEmailFrom: boolean;
  safeDestinationLabel: string; // masked email, never raw secret
}

export interface CalendarStatus {
  configured: boolean;
  hasGoogleClientId: boolean;
  hasGoogleClientSecret: boolean;
  hasGoogleRedirectUri: boolean;
  hasSavedToken: boolean;
}

export interface WorkerStatus {
  defaultIntervalMinutes: number;
  minimumIntervalMinutes: number;
  scanOnStart: boolean;
  recommendedCommand: string;
}

export interface StateStatus {
  latestScanResultsExists: boolean;
  availabilityHitsExists: boolean;
  calendarEventsExists: boolean;
}

export interface AlertsStatus {
  count: number;
  enabledCount: number;
  disabledCount: number;
}

export interface SetupStatus {
  email: EmailStatus;
  calendar: CalendarStatus;
  worker: WorkerStatus;
  state: StateStatus;
  targetsOrAlerts: AlertsStatus;
}

export interface StatusCheckOptions {
  stateDir?: string | undefined;
  tokenPath?: string | undefined;
  dataDir?: string | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function maskEmail(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return '***';
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx); // includes @
  const masked = local.slice(0, 1) + '***';
  return masked + domain;
}

function defaultStateDir(): string {
  return path.join(process.cwd(), '.campbrain', 'state');
}

function defaultTokenPath(): string {
  return path.join(process.cwd(), '.campbrain', 'google-token.json');
}

function defaultDataDir(): string {
  return path.join(process.cwd(), 'data');
}

// ---------------------------------------------------------------------------
// Individual status getters
// ---------------------------------------------------------------------------

export function getEmailStatus(): EmailStatus {
  const hasApiKey = Boolean(process.env['RESEND_API_KEY']);
  const hasTo = Boolean(process.env['ALERT_EMAIL_TO']);
  const hasFrom = Boolean(process.env['ALERT_EMAIL_FROM']);
  const configured = hasApiKey && hasTo && hasFrom;

  const rawTo = process.env['ALERT_EMAIL_TO'] ?? '';
  const safeDestinationLabel = rawTo ? maskEmail(rawTo) : '';

  return {
    configured,
    hasResendApiKey: hasApiKey,
    hasAlertEmailTo: hasTo,
    hasAlertEmailFrom: hasFrom,
    safeDestinationLabel,
  };
}

export function getCalendarStatus(tokenPath?: string): CalendarStatus {
  const hasClientId = Boolean(process.env['GOOGLE_CLIENT_ID']);
  const hasClientSecret = Boolean(process.env['GOOGLE_CLIENT_SECRET']);
  const hasRedirectUri = Boolean(process.env['GOOGLE_REDIRECT_URI']);
  const configured = hasClientId && hasClientSecret;

  const resolvedTokenPath = tokenPath ?? defaultTokenPath();
  const hasSavedToken = fs.existsSync(resolvedTokenPath);

  return {
    configured,
    hasGoogleClientId: hasClientId,
    hasGoogleClientSecret: hasClientSecret,
    hasGoogleRedirectUri: hasRedirectUri,
    hasSavedToken,
  };
}

export function getWorkerStatus(): WorkerStatus {
  const envInterval = process.env['CAMPBRAIN_SCAN_INTERVAL_MINUTES'];
  const parsedInterval = envInterval ? parseInt(envInterval, 10) : NaN;
  const defaultIntervalMinutes = !isNaN(parsedInterval) && parsedInterval >= 15
    ? parsedInterval
    : 60;

  const scanOnStart = process.env['CAMPBRAIN_SCAN_ON_START'] !== 'false';

  return {
    defaultIntervalMinutes,
    minimumIntervalMinutes: 15,
    scanOnStart,
    recommendedCommand: 'npm run worker',
  };
}

export function getStateStatus(stateDir?: string): StateStatus {
  const dir = stateDir ?? defaultStateDir();
  return {
    latestScanResultsExists: fs.existsSync(path.join(dir, 'latest-scan-results.json')),
    availabilityHitsExists: fs.existsSync(path.join(dir, 'availability-hits.json')),
    calendarEventsExists: fs.existsSync(path.join(dir, 'calendar-events.json')),
  };
}

export function getAlertsStatus(dataDir?: string): AlertsStatus {
  const dir = dataDir ?? defaultDataDir();
  const targetsFile = path.join(dir, 'targets.json');

  if (!fs.existsSync(targetsFile)) {
    return { count: 0, enabledCount: 0, disabledCount: 0 };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(targetsFile, 'utf-8')) as { targets?: unknown[] };
    const items = Array.isArray(raw.targets) ? raw.targets : [];

    let enabledCount = 0;
    let disabledCount = 0;

    for (const item of items) {
      if (typeof item === 'object' && item !== null) {
        const rec = item as Record<string, unknown>;
        // Default enabled = true if field absent
        const enabled = rec['enabled'] !== false;
        if (enabled) enabledCount++;
        else disabledCount++;
      }
    }

    return { count: items.length, enabledCount, disabledCount };
  } catch {
    return { count: 0, enabledCount: 0, disabledCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Aggregate status
// ---------------------------------------------------------------------------

export function getSetupStatus(options: StatusCheckOptions = {}): SetupStatus {
  return {
    email: getEmailStatus(),
    calendar: getCalendarStatus(options.tokenPath),
    worker: getWorkerStatus(),
    state: getStateStatus(options.stateDir),
    targetsOrAlerts: getAlertsStatus(options.dataDir),
  };
}
