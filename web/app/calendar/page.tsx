import path from 'path';
import { getSetupStatus } from '../../../src/status/setup-status';
import { listAlertsWeb } from '../../lib/alerts';

export const dynamic = 'force-dynamic';

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`dot ${ok ? 'dot-green' : 'dot-red'}`} />;
}

export default function CalendarPage() {
  const projectRoot = path.join(process.cwd(), '..');
  const status = getSetupStatus({
    stateDir: path.join(projectRoot, '.campbrain', 'state'),
    tokenPath: path.join(projectRoot, '.campbrain', 'google-token.json'),
    dataDir: path.join(projectRoot, 'data'),
  });

  const alerts = listAlertsWeb();
  const calendarAlerts = alerts.filter((a) => a.calendarEnabled);
  const cal = status.calendar;

  return (
    <>
      <div className="page-header">
        <h1>Calendar</h1>
        <p className="page-subtitle">Google Calendar integration status and booking reminders</p>
      </div>

      <div className="card">
        <h2>Google Calendar Setup</h2>
        <div className="kv-row">
          <span className="kv-key"><StatusDot ok={cal.hasGoogleClientId} /> Client ID</span>
          <span className="kv-val">{cal.hasGoogleClientId ? 'Configured' : <span style={{ color: 'var(--red)' }}>Missing GOOGLE_CLIENT_ID</span>}</span>
        </div>
        <div className="kv-row">
          <span className="kv-key"><StatusDot ok={cal.hasGoogleClientSecret} /> Client secret</span>
          <span className="kv-val">{cal.hasGoogleClientSecret ? 'Configured' : <span style={{ color: 'var(--red)' }}>Missing GOOGLE_CLIENT_SECRET</span>}</span>
        </div>
        <div className="kv-row">
          <span className="kv-key"><StatusDot ok={cal.hasGoogleRedirectUri} /> Redirect URI</span>
          <span className="kv-val">{cal.hasGoogleRedirectUri ? 'Configured' : <span style={{ color: 'var(--muted)' }}>Using default</span>}</span>
        </div>
        <div className="kv-row">
          <span className="kv-key"><StatusDot ok={cal.hasSavedToken} /> OAuth token</span>
          <span className="kv-val">
            {cal.hasSavedToken
              ? <span style={{ color: 'var(--green)' }}>Saved — calendar sync is active</span>
              : <span style={{ color: 'var(--muted)' }}>Not authenticated — run <code style={{ fontSize: 12, background: 'var(--bg)', padding: '1px 6px', borderRadius: 3 }}>npm run sync-calendar</code> to authorize</span>
            }
          </span>
        </div>

        {!cal.configured && (
          <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(245,200,66,.08)', border: '1px solid rgba(245,200,66,.2)', borderRadius: 6, fontSize: 13 }}>
            <strong style={{ color: 'var(--yellow)' }}>Setup required</strong>
            <div style={{ color: 'var(--muted)', marginTop: 4 }}>
              Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in your <code>.env</code> file, then run <code>npm run sync-calendar</code> to authenticate.
            </div>
          </div>
        )}

        {cal.configured && !cal.hasSavedToken && (
          <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(79,142,247,.08)', border: '1px solid rgba(79,142,247,.2)', borderRadius: 6, fontSize: 13 }}>
            <strong style={{ color: 'var(--accent)' }}>Authorization needed</strong>
            <div style={{ color: 'var(--muted)', marginTop: 4 }}>
              Credentials are configured. Run <code>npm run sync-calendar</code> to open the OAuth consent screen and save your token.
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Calendar-enabled alerts</h2>
        {calendarAlerts.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
            No alerts have calendar sync enabled. Edit an alert and enable "Calendar sync" to get booking reminders in Google Calendar.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Park</th>
                <th>Campground</th>
                <th>Dates</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {calendarAlerts.map((a) => {
                const dateLabel = (() => {
                  switch (a.dateMode) {
                    case 'exact_dates': return `${a.exactStartDate ?? '?'} → ${a.exactEndDate ?? '?'}`;
                    case 'date_range':
                    case 'weekend_range': return `${a.rangeStart ?? '?'} – ${a.rangeEnd ?? '?'}`;
                    case 'next_available_weekend': return `Next ${a.nextWeeksCount ?? 12} weekends`;
                  }
                })();
                return (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{a.parkName}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{a.campgroundName}</td>
                    <td style={{ fontSize: 12 }}>{dateLabel}</td>
                    <td>
                      <span className={`chip ${a.enabled ? 'chip-green' : 'chip-gray'}`}>
                        {a.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>How calendar sync works</h2>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
          <p style={{ margin: '0 0 8px' }}>
            Running <code>npm run sync-calendar</code> creates Google Calendar events for upcoming booking windows:
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li><strong style={{ color: 'var(--text)' }}>3 months before</strong> — "Start planning" reminder</li>
            <li><strong style={{ color: 'var(--text)' }}>Night before</strong> — "Tomorrow morning" reminder at 9 PM</li>
            <li><strong style={{ color: 'var(--text)' }}>Booking opens</strong> — Event at the exact release time (e.g. 8:00 AM)</li>
          </ul>
          <p style={{ margin: '12px 0 0' }}>
            Only alerts with Calendar sync enabled are included. Existing events are updated rather than duplicated.
          </p>
        </div>
      </div>
    </>
  );
}
