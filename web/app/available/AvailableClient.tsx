'use client';

import { useState, useMemo, useEffect, memo } from 'react';
import type { AvailableStay } from '../../lib/available-display';
import SiteFilterPanel from '../components/SiteFilterPanel';
import ParkMapPopover from '../components/ParkMapPopover';
import { injectBookingDates } from '../../lib/booking-url';
import {
  buildLookup,
  groupFromLookup,
  parseDateLocal,
  addDaysToIso,
  isWeekendArrival,
} from '../../lib/available-display';
import type { CampgroundResult, ParkGroup, DateGroup } from '../../lib/available-display';

// ---------------------------------------------------------------------------
// Display-only date helpers (not exported — render path only)
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dowLabel(iso: string): string {
  return WEEKDAY_LABELS[parseDateLocal(iso).getDay()] ?? '';
}
function formatDate(iso: string): string {
  return parseDateLocal(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function formatDeparture(arrivalIso: string, nights: number): string {
  const d = parseDateLocal(arrivalIso);
  d.setDate(d.getDate() + nights);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function todayIso(): string { return new Date().toISOString().slice(0, 10); }

// ---------------------------------------------------------------------------
// Sub-components — memoized so unchanged cards don't re-render on filter change
// ---------------------------------------------------------------------------

const CampgroundRow = memo(function CampgroundRow({ cg }: { cg: CampgroundResult }) {
  const hasAvail = cg.availableSites.length > 0;
  const hasWalkUp = (cg.walkUpSites?.length ?? 0) > 0;
  return (
    <div style={{ padding: '7px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
          {cg.name}
          <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>
            → {formatDeparture(cg.arrivalDate, cg.nights)} ({cg.nights}N)
          </span>
        </span>
        {cg.nightlyFee !== undefined && (
          <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            ${cg.nightlyFee}/night ·{' '}
            <strong style={{ color: 'var(--text)' }}>${cg.nightlyFee * cg.nights} total</strong>
          </span>
        )}
        {cg.bookingUrl && hasAvail && (
          <a href={injectBookingDates(cg.bookingUrl, cg.arrivalDate, cg.nights)}
            target="_blank" rel="noreferrer"
            className="btn btn-sm btn-success" style={{ fontSize: 11 }}>
            Book ↗
          </a>
        )}
      </div>
      {hasAvail && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
          {cg.availableSites.map((site) => (
            <span key={site} className="chip chip-green" style={{ fontSize: 11 }}>{site}</span>
          ))}
        </div>
      )}
      {hasWalkUp && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
          <span className="badge badge-gray" style={{ fontSize: 9 }}>walk-up</span>
          {cg.walkUpSites!.map((site) => (
            <span key={site} className="chip" style={{ fontSize: 11, opacity: 0.6 }}>{site}</span>
          ))}
          <span style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic' }}>
            first-come, not reservable
          </span>
        </div>
      )}
    </div>
  );
});

const ParkCard = memo(function ParkCard({
  group, coordsByParkId,
}: {
  group: ParkGroup;
  coordsByParkId: Record<string, { lat: number; lon: number }>;
}) {
  const totalAvail = group.campgrounds.reduce((n, c) => n + c.availableSites.length, 0);
  const hasAvail = totalAvail > 0;
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [group.parkPageId, group.parkName]);

  return (
    <div className="card" style={{ marginBottom: 8, padding: open ? undefined : '8px 16px' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          marginBottom: open ? 6 : 0,
        }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen((v) => !v); }}
      >
        <span style={{
          fontSize: 11, color: 'var(--muted)', transition: 'transform .15s',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          display: 'inline-block', flexShrink: 0,
        }}>▶</span>

        <h3 style={{ margin: 0, flex: 1, fontSize: 14, fontWeight: hasAvail ? 600 : 400 }}>
          <span onClick={(e) => e.stopPropagation()}>
            <ParkMapPopover
              parkName={group.parkName}
              lat={coordsByParkId[group.parkPageId]?.lat}
              lon={coordsByParkId[group.parkPageId]?.lon}
            />
          </span>
        </h3>

        {group.minNightlyFee !== undefined && (
          <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            from <strong style={{ color: 'var(--text)' }}>${group.minNightlyFee}/night</strong>
          </span>
        )}
        {hasAvail
          ? <span className="badge badge-green">{totalAvail} open</span>
          : <span className="badge badge-gray" style={{ opacity: 0.6 }}>No availability</span>}
      </div>

      {open && group.campgrounds.map((cg, i) => <CampgroundRow key={i} cg={cg} />)}
    </div>
  );
});

const DateSection = memo(function DateSection({
  group, coordsByParkId,
}: {
  group: DateGroup;
  coordsByParkId: Record<string, { lat: number; lon: number }>;
}) {
  const isWeekend = isWeekendArrival(group.arrivalDate);
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: isWeekend ? 'var(--text)' : 'var(--muted)' }}>
          {dowLabel(group.arrivalDate)}, {formatDate(group.arrivalDate)}
        </span>
        {group.totalAvailable > 0
          ? <span className="badge badge-green">{group.totalAvailable} site{group.totalAvailable !== 1 ? 's' : ''} open</span>
          : <span className="badge badge-gray">Nothing available</span>}
      </div>
      {group.parks.map((p) => (
        <ParkCard key={p.parkPageId} group={p} coordsByParkId={coordsByParkId} />
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const PAGE_SIZE = 10;

interface RefreshStatus {
  entryCount: number; lastScanAt: string | null; refreshRunning: boolean; minRefreshGapMs: number;
}

export default function AvailableClient({
  initialEntries,
  coordsByParkId = {},
}: {
  initialEntries: AvailableStay[];
  coordsByParkId?: Record<string, { lat: number; lon: number }>;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [loading, setLoading] = useState(initialEntries.length === 0);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [weekendsOnly, setWeekendsOnly] = useState(true);
  const [nightsFilter, setNightsFilter] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);

  useEffect(() => {
    if (initialEntries.length === 0) {
      void fetch('/api/available').then(async (r) => {
        const data = (await r.json()) as { stays: AvailableStay[]; readAt: string };
        setEntries(data.stays);
        setReadAt(data.readAt);
        setLoading(false);
      }).catch(() => { setLoading(false); });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lookup = useMemo(() => buildLookup(entries), [entries]);

  const filterKey = `${activeFilters.join(',')}|${showUnavailable}|${weekendsOnly}|${nightsFilter}|${dateFrom}|${dateTo}`;
  useEffect(() => { setLimit(PAGE_SIZE); }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const { groups, hasMore } = useMemo(
    () => {
      const r = groupFromLookup(lookup, { activeFilters, showUnavailable, weekendsOnly, nightsFilter, dateFrom, dateTo, limit });
      return { groups: r.groups, hasMore: r.hasMore };
    },
    [lookup, activeFilters, showUnavailable, weekendsOnly, nightsFilter, dateFrom, dateTo, limit]
  );

  const totalAvailable = useMemo(() => groups.reduce((n, g) => n + g.totalAvailable, 0), [groups]);

  useEffect(() => {
    void fetch('/api/available/refresh').then(async (r) => {
      setRefreshStatus((await r.json()) as RefreshStatus);
    });
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshMsg('Scanning all parks… this may take 1–2 minutes');
    try {
      const res = await fetch('/api/available/refresh', { method: 'POST' });
      const data = (await res.json()) as {
        summary?: { cacheWrites: number; fetchErrors: number; durationMs: number }; error?: string;
      };
      if (!res.ok) {
        setRefreshMsg(data.error ?? 'Refresh failed');
      } else {
        const s = data.summary!;
        setRefreshMsg(`Done — ${s.cacheWrites} entries updated in ${(s.durationMs / 1000).toFixed(0)}s`);
        const fresh = await fetch('/api/available');
        const { stays: newStays, readAt: newReadAt } = (await fresh.json()) as { stays: AvailableStay[]; readAt: string };
        setEntries(newStays);
        setReadAt(newReadAt);
      }
    } catch (err) {
      setRefreshMsg(err instanceof Error ? err.message : 'Network error');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div>
      {/* Controls */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <SiteFilterPanel activeFilters={activeFilters} onChange={setActiveFilters} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Nights</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([null, 1, 2] as Array<number | null>).map((n) => {
                const active = nightsFilter === n;
                const label = n === null ? 'All' : `${n}N`;
                return (
                  <button key={String(n)} type="button"
                    className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setNightsFilter(n)}>
                    {active ? `✓ ${label}` : label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '0 0 140px' }}>
            From
            <input type="date" value={dateFrom} min={todayIso()} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label style={{ flex: '0 0 140px' }}>
            To
            <input type="date" value={dateTo} min={dateFrom || todayIso()} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          {(dateFrom || dateTo) && (
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => { setDateFrom(''); setDateTo(''); }} style={{ marginBottom: 1 }}>
              Clear dates
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button type="button"
              className={`btn btn-sm ${weekendsOnly ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setWeekendsOnly((v) => !v)}>
              {weekendsOnly ? '✓ Weekends only' : 'Weekends only'}
            </button>
            <button type="button"
              className={`btn btn-sm ${!showUnavailable ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setShowUnavailable((v) => !v)}>
              {!showUnavailable ? '✓ Available only' : 'Available only'}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↺ Refresh now'}
          </button>
          {refreshMsg && (
            <span style={{ fontSize: 12, color: refreshMsg.startsWith('Done') ? 'var(--green)' : 'var(--muted)' }}>
              {refreshMsg}
            </span>
          )}
          {!refreshMsg && readAt && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Data as of {new Date(readAt).toLocaleTimeString()}</span>
          )}
          {refreshStatus && (
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
              {refreshStatus.entryCount} windows cached
            </span>
          )}
        </div>
      </div>

      {loading && (
        <div className="empty">
          <p>Loading availability data…</p>
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div className="empty">
          <p>No cached availability data yet.</p>
          <p style={{ fontSize: 13 }}>Start the worker (<code>npm run worker</code>) or hit <strong>Refresh now</strong>.</p>
        </div>
      )}
      {!loading && entries.length > 0 && groups.length === 0 && (
        <div className="empty">No results match your current filters.</div>
      )}

      {!loading && groups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, flex: 1 }}>
            {groups.length} date{groups.length !== 1 ? 's' : ''}{weekendsOnly ? ' (weekends)' : ''}
            {hasMore && <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>· showing first {limit}</span>}
          </h2>
          {totalAvailable > 0
            ? <span className="badge badge-green">{totalAvailable} total sites open</span>
            : <span className="badge badge-gray">Nothing available right now</span>}
        </div>
      )}

      {groups.map((g) => (
        <DateSection key={g.arrivalDate} group={g} coordsByParkId={coordsByParkId} />
      ))}

      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: 8, marginBottom: 24 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setLimit((l) => l + PAGE_SIZE)}
          >
            Show more dates
          </button>
        </div>
      )}
    </div>
  );
}
