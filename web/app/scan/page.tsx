import { loadTargets } from '../../lib/targets';
import ScanClient from './ScanClient';

export const dynamic = 'force-dynamic';

export default function ScanPage() {
  const targets = loadTargets();
  const firstTarget = targets[0];

  return (
    <>
      <div className="page-header">
        <h1>Availability Scan</h1>
        <p className="page-subtitle">
          Checks the next 3 weekends against ReserveCalifornia — no automatic polling
        </p>
      </div>

      {targets.length === 0 && (
        <div className="empty">No targets configured in data/targets.json.</div>
      )}

      {firstTarget && (
        <>
          <div className="card" style={{ marginBottom: 24 }}>
            <h3>{firstTarget.name}</h3>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              {firstTarget.parkName} · {firstTarget.campgroundName}
              {' · '}sites: {firstTarget.acceptableSites.join(', ')}
            </div>
          </div>

          <ScanClient targetId={firstTarget.id} />
        </>
      )}
    </>
  );
}
