import { loadTargets } from '../../lib/targets';
import { getBookingWindows } from '../../lib/windows';
import type { Target } from '../../../src/config/schemas';
import type { BookingWindowInfo } from '../../../src/rules/booking-window';

export const dynamic = 'force-dynamic';

function monthLabel(dateStr: string) {
  return dateStr.slice(0, 7);
}

function groupByMonth(windows: BookingWindowInfo[]) {
  const groups = new Map<string, BookingWindowInfo[]>();
  for (const w of windows) {
    const m = monthLabel(w.arrivalDate);
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m)!.push(w);
  }
  return groups;
}

function TargetWindows({ target }: { target: Target }) {
  const windows = getBookingWindows(target);
  const grouped = groupByMonth(windows);

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2>{target.name}</h2>
      <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
        {target.parkName} · {target.campgroundName}
      </div>

      {windows.length === 0 && (
        <div className="empty">No booking windows in configured date range.</div>
      )}

      {Array.from(grouped.entries()).map(([month, wins]) => (
        <div key={month} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>
            {month}
          </div>
          <table>
            <thead>
              <tr>
                <th>Arrival</th>
                <th>Books at</th>
                <th>7-day reminder</th>
                <th>Night before</th>
                <th>10-min reminder</th>
              </tr>
            </thead>
            <tbody>
              {wins.map((w) => (
                <tr key={w.arrivalDate}>
                  <td>{w.arrivalDate}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {w.bookingOpenTime.slice(0, 16)}
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {w.reminderSevenDaysBefore.slice(0, 16)}
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {w.reminderNightBefore.slice(0, 16)}
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {w.reminderTenMinutesBefore.slice(0, 16)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export default function WindowsPage() {
  const targets = loadTargets();

  return (
    <>
      <div className="page-header">
        <h1>Booking Windows</h1>
        <p className="page-subtitle">Reservation open dates and reminders for all targets</p>
      </div>

      {targets.map((t) => (
        <TargetWindows key={t.id} target={t} />
      ))}
    </>
  );
}
