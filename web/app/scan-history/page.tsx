import { getLatestScanState, getHitsState } from '../../lib/state';

export const dynamic = 'force-dynamic';

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ScanHistoryPage() {
  const latest = getLatestScanState();
  const hits = getHitsState();

  const latestEntries = Object.entries(latest).sort((a, b) =>
    b[1].scannedAt.localeCompare(a[1].scannedAt)
  );

  const hitRecords = [...hits.hits].sort((a, b) =>
    b.firstSeenAt.localeCompare(a.firstSeenAt)
  );

  return (
    <>
      <div className="page-header">
        <h1>Scan History</h1>
        <p className="page-subtitle">Latest scan results and all availability hits</p>
      </div>

      <h2>Latest Scan Results</h2>
      {latestEntries.length === 0 ? (
        <div className="empty">No scans run yet. Go to Alerts and click "Scan now" on an alert.</div>
      ) : (
        latestEntries.map(([alertId, scan]) => {
          const matches = scan.results.filter((r) => r.hits.length > 0);
          return (
            <div key={alertId} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <h3 style={{ margin: 0, flex: 1 }}>{scan.targetName}</h3>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{relativeTime(scan.scannedAt)}</span>
                <span className={`chip ${scan.matchCount > 0 ? 'chip-green' : 'chip-gray'}`}>
                  {scan.matchCount > 0 ? `🎯 ${scan.matchCount} match${scan.matchCount !== 1 ? 'es' : ''}` : 'No matches'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 24, fontSize: 13, color: 'var(--muted)', marginBottom: matches.length > 0 ? 12 : 0 }}>
                <span>{scan.candidatesScanned} candidates checked</span>
                <span>{scan.scannedAt.slice(0, 19).replace('T', ' ')} UTC</span>
              </div>

              {matches.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th>Arrival</th>
                      <th>Departure</th>
                      <th>Nights</th>
                      <th>Available sites</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((r) => (
                      <tr key={`${r.candidate.arrivalDate}-${r.candidate.nights}`}>
                        <td>{r.candidate.arrivalDate}</td>
                        <td>{r.candidate.endDate}</td>
                        <td>{r.candidate.nights}</td>
                        <td>
                          {r.hits.map((h) => (
                            <span key={h.siteName} className="badge badge-green" style={{ marginRight: 4 }}>
                              {h.siteName}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}

      <h2 style={{ marginTop: 32 }}>All Availability Hits</h2>
      {hitRecords.length === 0 ? (
        <div className="empty">No availability hits recorded yet.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Site</th>
                <th>Arrival</th>
                <th>Nights</th>
                <th>First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {hitRecords.slice(0, 50).map((h, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{h.targetName}</td>
                  <td>
                    <span className="badge badge-match">{h.siteName}</span>
                  </td>
                  <td>{h.arrivalDate}</td>
                  <td>{h.nights}N</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{relativeTime(h.firstSeenAt)}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{relativeTime(h.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hitRecords.length > 50 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
              Showing 50 of {hitRecords.length} hits
            </div>
          )}
        </div>
      )}
    </>
  );
}
