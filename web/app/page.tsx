import { loadTargets } from '../lib/targets';
import { getBookingWindows } from '../lib/windows';
import type { Target } from '../../src/config/schemas';
import type { BookingWindowInfo } from '../../src/rules/booking-window';

export const dynamic = 'force-dynamic';

function nextWindows(target: Target, limit: number): BookingWindowInfo[] {
  const now = new Date().toISOString();
  return getBookingWindows(target)
    .filter((w) => w.bookingOpenTime > now)
    .slice(0, limit);
}

function dateRangeLabel(target: Target): string {
  switch (target.dateMode) {
    case 'exact_dates':
      return `${target.exactStartDate ?? '?'} → ${target.exactEndDate ?? '?'}`;
    case 'date_range':
    case 'weekend_range':
      return `${target.rangeStart ?? '?'} – ${target.rangeEnd ?? '?'}${target.weekendsOnly ? ' (weekends)' : ''}`;
    case 'next_available_weekend':
      return `next ${target.nextWeeksCount ?? 12} weekends`;
  }
}

function TargetCard({ target }: { target: Target }) {
  const windows = nextWindows(target, 3);
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{target.name}</h3>
        <span className="badge badge-blue">{target.provider}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">Park</span>
        <span className="kv-val">{target.parkName}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">Campground</span>
        <span className="kv-val">{target.campgroundName}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">Sites</span>
        <span className="kv-val">{target.acceptableSites.join(', ')}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">Dates</span>
        <span className="kv-val">{dateRangeLabel(target)}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">Nights</span>
        <span className="kv-val">{target.minNights}–{target.maxNights}</span>
      </div>
      {windows.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginBottom: 8 }}>
            Next booking windows
          </div>
          {windows.map((w) => (
            <div key={w.arrivalDate} style={{ display: 'flex', gap: 16, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span style={{ color: 'var(--muted)', width: 100, flexShrink: 0 }}>
                {w.arrivalDate}
              </span>
              <span>opens {w.bookingOpenTime.slice(0, 10)} at {w.bookingOpenTime.slice(11, 16)}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <a href={`/scan?target=${target.id}`} className="btn" style={{ fontSize: 12 }}>🔍 Scan</a>
        <a href="/targets" className="btn" style={{ fontSize: 12 }}>Edit</a>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const targets = loadTargets();

  const totalWindows = targets.reduce(
    (sum, t) => sum + getBookingWindows(t).length,
    0
  );

  const allUpcoming = targets
    .flatMap((t) => nextWindows(t, 999))
    .sort((a, b) => a.bookingOpenTime.localeCompare(b.bookingOpenTime))
    .slice(0, 1);

  const nextWindow = allUpcoming[0];

  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="page-subtitle">
          {targets.length} target{targets.length !== 1 ? 's' : ''} configured
        </p>
      </div>

      <div className="grid-3" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="stat-label">Targets</div>
          <div className="stat-value">{targets.length}</div>
        </div>
        <div className="card">
          <div className="stat-label">Booking windows</div>
          <div className="stat-value">{totalWindows}</div>
        </div>
        <div className="card">
          <div className="stat-label">Next opens</div>
          <div className="stat-value" style={{ fontSize: 16, paddingTop: 4 }}>
            {nextWindow ? nextWindow.bookingOpenTime.slice(0, 10) : '—'}
          </div>
        </div>
      </div>

      <h2>Targets</h2>
      {targets.length === 0 && (
        <div className="empty">
          No targets configured. <a href="/targets">Add a target</a>.
        </div>
      )}
      {targets.map((t) => (
        <TargetCard key={t.id} target={t} />
      ))}
    </>
  );
}
