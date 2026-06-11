import { listAlertsWeb } from '../../lib/alerts';
import { getActiveOpenings, hitKey } from '../../lib/state';

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Active saved-target openings: future arrivals still present in the cache. */
export default function RecentOpenings({ limit }: { limit?: number }) {
  const openings = getActiveOpenings();
  const alertsById = new Map(listAlertsWeb().map((a) => [a.id, a]));
  const shown = limit ? openings.slice(0, limit) : openings;

  return (
    <>
      <h2>Recent openings</h2>
      {shown.length === 0 ? (
        <div className="card" style={{ marginBottom: 24, color: 'var(--muted)', fontSize: 13 }}>
          No openings found yet.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
          <table>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Park · Campground</th>
                <th>Site</th>
                <th>Stay</th>
                <th>As of</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((h) => {
                const alert = alertsById.get(h.targetId);
                const parkCampground =
                  h.savedSearchId && h.parkName
                    ? `${h.parkName}${h.campgroundName ? ` · ${h.campgroundName}` : ''}`
                    : alert
                    ? `${alert.parkName} · ${alert.campgroundName}`
                    : '—';
                return (
                  <tr key={hitKey(h)}>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {h.savedSearchId ? (
                        <a href="/saved">{h.targetName}</a>
                      ) : (
                        h.targetName
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {parkCampground}
                    </td>
                    <td><span className="badge badge-match">{h.siteName}</span></td>
                    <td style={{ fontSize: 12 }}>
                      {h.arrivalDate} → {h.departureDate} ({h.nights}N)
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {relativeTime(h.availabilityAsOf ?? h.lastSeenAt)}
                    </td>
                    <td>
                      {h.bookingUrl && (
                        <a href={h.bookingUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm" style={{ textDecoration: 'none' }}>
                          Book
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
