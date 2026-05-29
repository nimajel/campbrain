import path from 'path';
import { getSetupStatus } from '../../../src/status/setup-status';

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

export default function SettingsPage() {
  const projectRoot = path.join(process.cwd(), '..');
  const status = getSetupStatus({
    stateDir: path.join(projectRoot, '.campbrain', 'state'),
    tokenPath: path.join(projectRoot, '.campbrain', 'google-token.json'),
    dataDir: path.join(projectRoot, 'data'),
  });

  const { email, calendar, worker, state, targetsOrAlerts } = status;

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
        <h2>Background Worker</h2>
        <div className="kv-row">
          <span className="kv-key">Scan interval</span>
          <span className="kv-val">{worker.defaultIntervalMinutes} minutes</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">Minimum interval</span>
          <span className="kv-val">{worker.minimumIntervalMinutes} minutes</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">Scan on start</span>
          <span className="kv-val">{worker.scanOnStart ? 'Yes' : 'No (CAMPBRAIN_SCAN_ON_START=false)'}</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">Start command</span>
          <span className="kv-val"><code style={{ fontSize: 12, background: 'var(--bg)', padding: '1px 6px', borderRadius: 3 }}>{worker.recommendedCommand}</code></span>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
          Set <code>CAMPBRAIN_SCAN_INTERVAL_MINUTES</code> in <code>.env</code> to change the default interval (minimum 15 minutes).
        </div>
      </div>

      <div className="card">
        <h2>State Files</h2>
        <div className="kv-row">
          <span className="kv-key">
            <span className={`dot ${state.latestScanResultsExists ? 'dot-green' : 'dot-gray'}`} />
            Latest scan results
          </span>
          <span className="kv-val" style={{ color: state.latestScanResultsExists ? 'var(--text)' : 'var(--muted)' }}>
            {state.latestScanResultsExists ? 'Present' : 'Not yet written'}
          </span>
        </div>
        <div className="kv-row">
          <span className="kv-key">
            <span className={`dot ${state.availabilityHitsExists ? 'dot-green' : 'dot-gray'}`} />
            Availability hits
          </span>
          <span className="kv-val" style={{ color: state.availabilityHitsExists ? 'var(--text)' : 'var(--muted)' }}>
            {state.availabilityHitsExists ? 'Present' : 'Not yet written'}
          </span>
        </div>
        <div className="kv-row">
          <span className="kv-key">
            <span className={`dot ${state.calendarEventsExists ? 'dot-green' : 'dot-gray'}`} />
            Calendar events
          </span>
          <span className="kv-val" style={{ color: state.calendarEventsExists ? 'var(--text)' : 'var(--muted)' }}>
            {state.calendarEventsExists ? 'Present' : 'Not yet written'}
          </span>
        </div>
      </div>

      <div className="card">
        <h2>Environment</h2>
        <div className="kv-row">
          <span className="kv-key">Node env</span>
          <span className="kv-val">{process.env.NODE_ENV ?? 'development'}</span>
        </div>
        <div className="kv-row">
          <span className="kv-key">Project root</span>
          <span className="kv-val" style={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all' }}>{projectRoot}</span>
        </div>
      </div>
    </>
  );
}
