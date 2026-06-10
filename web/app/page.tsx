import { listAlertsWeb } from '../lib/alerts';
import { getLatestScanState, getHitsState } from '../lib/state';
import RecentOpenings from './components/RecentOpenings';
import { Badge, Button, Card, EmptyState, PageHeader, StatCard, StatusDot } from '../components/ui';
import type { Alert } from '../lib/alerts';
import type { LatestScanSummary } from '../lib/state';

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

function dateRangeLabel(alert: Alert): string {
  switch (alert.dateMode) {
    case 'exact_dates': return `${alert.exactStartDate ?? '?'} → ${alert.exactEndDate ?? '?'}`;
    case 'date_range':
    case 'weekend_range': return `${alert.rangeStart ?? '?'} – ${alert.rangeEnd ?? '?'}${alert.weekendsOnly ? ' (wkds)' : ''}`;
    case 'next_available_weekend': return `Next ${alert.nextWeeksCount ?? 12} weekends`;
  }
}

function AlertRow({ alert, scan }: { alert: Alert; scan?: LatestScanSummary }) {
  return (
    <Card style={{ opacity: alert.enabled ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <StatusDot tone={alert.enabled ? 'green' : 'gray'} />
        <h3 style={{ margin: 0, flex: 1 }}>{alert.name}</h3>
        <Badge tone="blue">{alert.provider}</Badge>
        {alert.emailEnabled && <Badge tone="gray" title="Email enabled">📧</Badge>}
        {alert.calendarEnabled && <Badge tone="gray" title="Calendar enabled">📅</Badge>}
      </div>

      <div style={{ display: 'flex', gap: 24, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
        <span>{alert.parkName} · {alert.campgroundName}</span>
        <span>{dateRangeLabel(alert)}</span>
        <span>Sites: {alert.acceptableSites.join(', ')}</span>
      </div>

      {scan && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 20, fontSize: 12 }}>
          <span style={{ color: 'var(--muted)' }}>Last scan {relativeTime(scan.scannedAt)}</span>
          <span style={{ color: scan.matchCount > 0 ? 'var(--green)' : 'var(--muted)', fontWeight: scan.matchCount > 0 ? 600 : 400 }}>
            {scan.matchCount > 0
              ? `🎯 ${scan.matchCount} match${scan.matchCount !== 1 ? 'es' : ''}`
              : `${scan.candidatesScanned} candidates, no matches`}
          </span>
        </div>
      )}

      {!scan && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>
          Not scanned yet
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <Button href="/alerts" variant="ghost" size="sm">Manage →</Button>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const alerts = listAlertsWeb();
  const scanState = getLatestScanState();
  const hitsState = getHitsState();

  const activeAlerts = alerts.filter((a) => a.enabled);
  const totalMatches = Object.values(scanState).reduce((sum, s) => sum + s.matchCount, 0);
  const totalHits = hitsState.hits.length;
  const lastScanTime = Object.values(scanState)
    .map((s) => s.scannedAt)
    .sort()
    .at(-1);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Campsite availability monitoring" />

      <div className="grid-3" style={{ marginBottom: 24 }}>
        <StatCard
          label="Active alerts"
          value={<>{activeAlerts.length}<span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 400 }}>/{alerts.length}</span></>}
        />
        <StatCard
          label="Current matches"
          value={totalMatches}
          valueStyle={totalMatches > 0 ? { color: 'var(--green)' } : undefined}
        />
        <StatCard label="Total hits recorded" value={totalHits} />
      </div>

      {lastScanTime && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 24 }}>
          Last scan {relativeTime(lastScanTime)} · <a href="/scan-history">View full history</a>
        </div>
      )}

      <RecentOpenings limit={5} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0, flex: 1 }}>Alerts</h2>
        <Button href="/alerts" variant="primary" size="sm">+ New alert</Button>
      </div>

      {alerts.length === 0 && (
        <EmptyState>
          No alerts configured. <a href="/alerts">Create your first alert →</a>
        </EmptyState>
      )}

      {alerts.map((a) => (
        <AlertRow key={a.id} alert={a} scan={scanState[a.id]} />
      ))}
    </>
  );
}
