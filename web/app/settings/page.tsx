import path from 'path';
import { getSetupStatus } from '../../../src/status/setup-status';
import { getCacheStats } from '../../lib/availability-cache';
import { describeScanCoverageWeb } from '../../lib/catalog';

export const dynamic = 'force-dynamic';

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="kv-row">
      <span className="kv-key">
        <span className={`dot ${ok ? 'dot-green' : 'dot-red'}`} />
        {label}
      </span>
      <span className="kv-val" style={{ color: ok ? 'var(--text)' : 'var(--muted)' }}>
        {detail ?? (ok ? 'Configured' : 'Not configured')}
      </span>
    </div>
  );
}

function KvRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{label}</span>
      <span className="kv-val" style={{ color: muted ? 'var(--muted)' : undefined }}>{value}</span>
    </div>
  );
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZoneName: 'short',
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function workerIsActive(lastScanAt: string | null, proactiveIntervalMinutes: number): boolean {
  if (!lastScanAt) return false;
  const elapsed = Date.now() - new Date(lastScanAt).getTime();
  // Consider active if last scan is within 1.5× the proactive interval
  return elapsed < proactiveIntervalMinutes * 1.5 * 60 * 1000;
}

export default async function SettingsPage() {
  const projectRoot = path.join(process.cwd(), '..');
  const status = getSetupStatus({
    stateDir: path.join(projectRoot, '.campbrain', 'state'),
    tokenPath: path.join(projectRoot, '.campbrain', 'google-token.json'),
    dataDir: path.join(projectRoot, 'data'),
  });

  let cacheStats: { entryCount: number; lastScanAt: string | null; maxWindowEnd: string | null } | null = null;
  try {
    cacheStats = await getCacheStats();
  } catch {
    // DB not available
  }

  const { email, calendar, worker, targetsOrAlerts } = status;
  const workerActive = workerIsActive(cacheStats?.lastScanAt ?? null, worker.proactiveIntervalMinutes);

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
        <p className="page-subtitle">System configuration and setup status</p>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="stat-label">Total alerts</div>
          <div className="stat-value">{targetsOrAlerts.count}</div>
        </div>
        <div className="card">
          <div className="stat-label">Active alerts</div>
          <div className="stat-value" style={{ color: targetsOrAlerts.enabledCount > 0 ? 'var(--green)' : undefined }}>
            {targetsOrAlerts.enabledCount}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Background Worker</h2>
        <div className="kv-row">
          <span className="kv-key">
            <span className={`dot ${workerActive ? 'dot-green' : 'dot-gray'}`} />
            Status
          </span>
          <span className="kv-val" style={{ color: workerActive ? 'var(--text)' : 'var(--muted)' }}>
            {workerActive ? 'Active' : cacheStats?.lastScanAt ? 'Idle (last scan too old)' : 'Not running'}
          </span>
        </div>
        <KvRow label="Cache refresh interval" value={`Every ${worker.proactiveIntervalMinutes} minutes — ${describeScanCoverageWeb()}`} />
        <KvRow label="Alert scan interval" value={`Every ${worker.alertIntervalMinutes} minutes — saved alert targets`} />
        <KvRow label="Scan on start" value={worker.scanOnStart ? 'Yes' : 'No (CAMPBRAIN_SCAN_ON_START=false)'} />
        <KvRow label="Start command" value="npm run worker" />
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
          Set <code>CAMPBRAIN_PROACTIVE_INTERVAL_MINUTES</code> to change cache refresh (default 120).
          Set <code>CAMPBRAIN_SCAN_INTERVAL_MINUTES</code> to change alert scan (default 60). Minimum 15 for both.
        </div>
      </div>

      <div className="card">
        <h2>Cache Health</h2>
        {cacheStats === null ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Database unavailable — is the worker running?</div>
        ) : cacheStats.entryCount === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No cache data yet — run <code>npm run worker</code> to populate.</div>
        ) : (
          <>
            <div className="kv-row">
              <span className="kv-key">
                <span className={`dot ${workerActive ? 'dot-green' : 'dot-gray'}`} />
                Last cache update
              </span>
              <span className="kv-val">{formatTimestamp(cacheStats.lastScanAt)}</span>
            </div>
            <KvRow label="Coverage through" value={formatDate(cacheStats.maxWindowEnd)} />
            <KvRow label="Windows cached" value={`${cacheStats.entryCount.toLocaleString()}`} muted />
          </>
        )}
      </div>

      <div className="card">
        <h2>Email Notifications</h2>
        <StatusRow label="Resend API key" ok={email.hasResendApiKey} detail={email.hasResendApiKey ? 'Set' : 'Missing RESEND_API_KEY'} />
        <StatusRow label="Email destination" ok={email.hasAlertEmailTo}
          detail={email.hasAlertEmailTo ? email.safeDestinationLabel : 'Missing ALERT_EMAIL_TO'} />
        <StatusRow label="Email sender" ok={email.hasAlertEmailFrom} detail={email.hasAlertEmailFrom ? 'Configured' : 'Missing ALERT_EMAIL_FROM'} />

        {!email.configured && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(255,107,107,.08)', border: '1px solid rgba(255,107,107,.2)', borderRadius: 6, fontSize: 12, color: 'var(--muted)' }}>
            Add <code>RESEND_API_KEY</code>, <code>ALERT_EMAIL_TO</code>, and <code>ALERT_EMAIL_FROM</code> to your <code>.env</code> file to enable email alerts.
          </div>
        )}
      </div>

      <div className="card">
        <h2>Google Calendar</h2>
        <StatusRow label="Client ID" ok={calendar.hasGoogleClientId} detail={calendar.hasGoogleClientId ? 'Set' : 'Missing GOOGLE_CLIENT_ID'} />
        <StatusRow label="Client secret" ok={calendar.hasGoogleClientSecret} detail={calendar.hasGoogleClientSecret ? 'Set' : 'Missing GOOGLE_CLIENT_SECRET'} />
        <StatusRow label="Redirect URI" ok={calendar.hasGoogleRedirectUri} detail={calendar.hasGoogleRedirectUri ? 'Set' : 'Using default'} />
        <StatusRow label="OAuth token" ok={calendar.hasSavedToken} detail={calendar.hasSavedToken ? 'Saved' : 'Not authorized — run npm run sync-calendar'} />
      </div>

      <div className="card">
        <h2>Environment</h2>
        <KvRow label="Node env" value={process.env.NODE_ENV ?? 'development'} />
        <KvRow label="Project root" value={projectRoot} muted />
      </div>
    </>
  );
}
