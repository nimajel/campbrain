'use client';

import { useState, useMemo, useEffect } from 'react';
import type { AvailabilityCacheEntry } from '../../lib/availability-cache';
import SiteFilterPanel from '../components/SiteFilterPanel';
import ParkMapPopover from '../components/ParkMapPopover';
import { passesSiteFilters, campgroundPassesFilters } from '../../lib/site-filters';
import { injectBookingDates } from '../../lib/booking-url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseDateLocal(iso: string): Date {
  // Parse YYYY-MM-DD without timezone shift
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function formatDate(iso: string): string {
  return parseDateLocal(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}

function formatDeparture(arrivalIso: string, nights: number): string {
  const d = parseDateLocal(arrivalIso);
  d.setDate(d.getDate() + nights);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function isWeekendArrival(iso: string): boolean {
  const dow = parseDateLocal(iso).getDay(); // 0=Sun, 5=Fri, 6=Sat
  return dow === 5 || dow === 6;
}

function dowLabel(iso: string): string {
  return WEEKDAY_LABELS[parseDateLocal(iso).getDay()] ?? '';
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Grouping — by arrival date (not split by nights)
// Each date group holds ALL matching entries for that day across all nights
// ---------------------------------------------------------------------------

type CampgroundResult = AvailabilityCacheEntry['campgrounds'][number] & {
  nights: number;
  departureDate: string;
  bookingUrl?: string;
};

type ParkGroup = {
  parkName: string;
  parkPageId: string;
  campgrounds: CampgroundResult[];
  /** Lowest nightly fee across ALL campgrounds for this park, regardless of availability filter */
  minNightlyFee?: number;
};

type DateGroup = {
  arrivalDate: string;
  parks: ParkGroup[];
  totalAvailable: number;
};

function groupEntries(
  entries: AvailabilityCacheEntry[],
  opts: {
    activeFilters: string[];
    showUnavailable: boolean;
    weekendsOnly: boolean;
    nightsFilter: number | null;
    dateFrom: string;
    dateTo: string;
  }
): DateGroup[] {
  const { activeFilters, showUnavailable, weekendsOnly, nightsFilter, dateFrom, dateTo } = opts;

  // Pre-filter entries
  const eligible = entries.filter((e) => {
    if (weekendsOnly && !isWeekendArrival(e.arrivalDate)) return false;
    if (nightsFilter !== null && e.nights !== nightsFilter) return false;
    if (dateFrom && e.arrivalDate < dateFrom) return false;
    if (dateTo && e.arrivalDate > dateTo) return false;
    return true;
  });

  // Map: arrivalDate → parkPageId → campground results
  const dateMap = new Map<string, Map<string, CampgroundResult[]>>();
  const parkNames = new Map<string, string>();
  // Tracks the lowest fee seen for a park across all its entries, ignoring availability filter
  const parkMinFee = new Map<string, number>();

  for (const entry of eligible) {
    const { arrivalDate, parkPageId, parkName, nights, departureDate } = entry;

    if (!dateMap.has(arrivalDate)) dateMap.set(arrivalDate, new Map());
    const parkMap = dateMap.get(arrivalDate)!;
    if (!parkMap.has(parkPageId)) parkMap.set(parkPageId, []);
    parkNames.set(parkPageId, parkName);

    for (const cg of entry.campgrounds) {
      // Track min fee from ALL campgrounds before any availability filter
      if (cg.nightlyFee !== undefined) {
        const prev = parkMinFee.get(parkPageId);
        if (prev === undefined || cg.nightlyFee < prev) {
          parkMinFee.set(parkPageId, cg.nightlyFee);
        }
      }

      if (!campgroundPassesFilters(cg.name, activeFilters)) continue;

      const filteredSites = cg.availableSites.filter((s) =>
        passesSiteFilters(s, cg.name, activeFilters)
      );

      if (!showUnavailable && filteredSites.length === 0) continue;

      parkMap.get(parkPageId)!.push({
        ...cg,
        availableSites: filteredSites,
        nights,
        departureDate,
      });
    }

    // Remove empty parks
    if (parkMap.get(parkPageId)!.length === 0) parkMap.delete(parkPageId);
  }

  // Build sorted output
  return Array.from(dateMap.entries())
    .filter(([, parkMap]) => parkMap.size > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([arrivalDate, parkMap]) => {
      const parks: ParkGroup[] = Array.from(parkMap.entries())
        .sort(([pidA], [pidB]) => (parkNames.get(pidA) ?? '').localeCompare(parkNames.get(pidB) ?? ''))
        .map(([pid, campgrounds]) => ({
          parkPageId: pid,
          parkName: parkNames.get(pid) ?? pid,
          campgrounds,
          minNightlyFee: parkMinFee.get(pid),
        }));

      const totalAvailable = parks.reduce(
        (n, p) => n + p.campgrounds.reduce((m, c) => m + c.availableSites.length, 0),
        0
      );

      return { arrivalDate, parks, totalAvailable };
    })
    .filter((g) => showUnavailable || g.totalAvailable > 0);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CampgroundRow({ cg }: { cg: CampgroundResult }) {
  const hasAvail = cg.availableSites.length > 0;
  return (
    <div style={{ padding: '7px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
          {cg.name}
          <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>
            → {formatDeparture(
              // reverse-compute arrivalDate from departureDate and nights
              (() => {
                const d = parseDateLocal(cg.departureDate);
                d.setDate(d.getDate() - cg.nights);
                return d.toISOString().slice(0, 10);
              })(),
              cg.nights
            )} ({cg.nights}N)
          </span>
        </span>
        {cg.nightlyFee !== undefined && (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            ${cg.nightlyFee}/night ·{' '}
            <strong style={{ color: 'var(--text)' }}>${cg.nightlyFee * cg.nights} total</strong>
          </span>
        )}
        {cg.bookingUrl && hasAvail && (
          <a
            href={injectBookingDates(cg.bookingUrl, (() => {
              const d = parseDateLocal(cg.departureDate);
              d.setDate(d.getDate() - cg.nights);
              return d.toISOString().slice(0, 10);
            })(), cg.nights)}
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm btn-success"
            style={{ fontSize: 11 }}
          >
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
    </div>
  );
}

function ParkCard({ group, coordsByParkId }: { group: ParkGroup; coordsByParkId: Record<string, { lat: number; lon: number }> }) {
  const totalAvail = group.campgrounds.reduce((n, c) => n + c.availableSites.length, 0);
  const hasAvail = totalAvail > 0;

  // minNightlyFee is pre-computed in groupEntries from the full (pre-filter) campground list
  const minFee = group.minNightlyFee;
  // Start expanded when there's availability; collapse/expand reactively as filters change
  const [open, setOpen] = useState(hasAvail);
  useEffect(() => { setOpen(hasAvail); }, [hasAvail]);

  return (
    <div
      className="card"
      style={{ marginBottom: 8, padding: open ? undefined : '8px 16px' }}
    >
      {/* Header row — not a button so ParkMapPopover's button nests cleanly */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          marginBottom: open ? 6 : 0,
        }}
      >
        {/* Chevron-only toggle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Collapse' : 'Expand'}
          style={{
            background: 'none', border: 'none', padding: '0 2px',
            cursor: 'pointer', color: 'var(--muted)', flexShrink: 0,
            fontSize: 11, lineHeight: 1,
          }}
        >
          <span style={{
            display: 'inline-block', transition: 'transform .15s',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}>▶</span>
        </button>

        <h3
          onClick={() => setOpen((v) => !v)}
          style={{
            margin: 0, flex: 1, fontSize: 14,
            fontWeight: hasAvail ? 600 : 400, cursor: 'pointer',
          }}
        >
          <ParkMapPopover
            parkName={group.parkName}
            lat={coordsByParkId[group.parkPageId]?.lat}
            lon={coordsByParkId[group.parkPageId]?.lon}
          />
        </h3>

        {minFee !== undefined && (
          <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            from <strong style={{ color: 'var(--text)' }}>${minFee}/night</strong>
          </span>
        )}
        {hasAvail
          ? <span className="badge badge-green">{totalAvail} open</span>
          : <span className="badge badge-gray" style={{ opacity: 0.6 }}>No availability</span>}
      </div>

      {open && group.campgrounds.map((cg, i) => <CampgroundRow key={i} cg={cg} />)}
    </div>
  );
}

function DateSection({ group, coordsByParkId }: { group: DateGroup; coordsByParkId: Record<string, { lat: number; lon: number }> }) {
  const dow = dowLabel(group.arrivalDate);
  const isWeekend = isWeekendArrival(group.arrivalDate);
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={{
          fontSize: 15, fontWeight: 700,
          color: isWeekend ? 'var(--text)' : 'var(--muted)',
        }}>
          {dow}, {formatDate(group.arrivalDate)}
        </span>
        {group.totalAvailable > 0
          ? <span className="badge badge-green">{group.totalAvailable} site{group.totalAvailable !== 1 ? 's' : ''} open</span>
          : <span className="badge badge-gray">Nothing available</span>}
      </div>
      {group.parks.map((p) => <ParkCard key={p.parkPageId} group={p} coordsByParkId={coordsByParkId} />)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface RefreshStatus {
  entryCount: number;
  lastScanAt: string | null;
  refreshRunning: boolean;
  minRefreshGapMs: number;
}

export default function AvailableClient({
  initialEntries,
  coordsByParkId = {},
}: {
  initialEntries: AvailabilityCacheEntry[];
  coordsByParkId?: Record<string, { lat: number; lon: number }>;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [weekendsOnly, setWeekendsOnly] = useState(true);
  const [nightsFilter, setNightsFilter] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus | null>(null);

  const lastScanAt = entries.length > 0
    ? entries.map((e) => e.scannedAt).sort().at(-1)
    : null;

  const groups = useMemo(
    () => groupEntries(entries, { activeFilters, showUnavailable, weekendsOnly, nightsFilter, dateFrom, dateTo }),
    [entries, activeFilters, showUnavailable, weekendsOnly, nightsFilter, dateFrom, dateTo]
  );

  const totalAvailable = useMemo(
    () => groups.reduce((n, g) => n + g.totalAvailable, 0),
    [groups]
  );

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshMsg('Scanning all parks… this may take 1–2 minutes');
    try {
      const res = await fetch('/api/available/refresh', { method: 'POST' });
      const data = (await res.json()) as {
        summary?: { cacheWrites: number; fetchErrors: number; durationMs: number };
        error?: string;
      };
      if (!res.ok) {
        setRefreshMsg(data.error ?? 'Refresh failed');
      } else {
        const s = data.summary!;
        setRefreshMsg(`Done — ${s.cacheWrites} entries updated in ${(s.durationMs / 1000).toFixed(0)}s`);
        const fresh = await fetch('/api/available');
        const { entries: newEntries } = (await fresh.json()) as { entries: AvailabilityCacheEntry[] };
        setEntries(newEntries);
      }
    } catch (err) {
      setRefreshMsg(err instanceof Error ? err.message : 'Network error');
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void fetch('/api/available/refresh').then(async (r) => {
      setRefreshStatus((await r.json()) as RefreshStatus);
    });
  }, []);

  return (
    <div>
      {/* Controls card */}
      <div className="card" style={{ marginBottom: 20 }}>

        {/* Row 1: site filters + nights */}
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

        {/* Row 2: date range + toggles */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '0 0 140px' }}>
            From
            <input type="date" value={dateFrom} min={todayIso()}
              onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label style={{ flex: '0 0 140px' }}>
            To
            <input type="date" value={dateTo} min={dateFrom || todayIso()}
              onChange={(e) => setDateTo(e.target.value)} />
          </label>
          {(dateFrom || dateTo) && (
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              style={{ marginBottom: 1 }}>
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

        {/* Row 3: refresh bar */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↺ Refresh now'}
          </button>
          {refreshMsg && (
            <span style={{ fontSize: 12, color: refreshMsg.startsWith('Done') ? 'var(--green)' : 'var(--muted)' }}>
              {refreshMsg}
            </span>
          )}
          {!refreshMsg && lastScanAt && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Last scan {relativeTime(lastScanAt)}</span>
          )}
          {refreshStatus && (
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
              {refreshStatus.entryCount} entries cached
            </span>
          )}
        </div>
      </div>

      {/* Empty states */}
      {entries.length === 0 && (
        <div className="empty">
          <p>No cached availability data yet.</p>
          <p style={{ fontSize: 13 }}>Start the worker (<code>npm run worker</code>) or hit <strong>Refresh now</strong>.</p>
        </div>
      )}
      {entries.length > 0 && groups.length === 0 && (
        <div className="empty">No results match your current filters.</div>
      )}

      {/* Results header */}
      {groups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, flex: 1 }}>
            {groups.length} date{groups.length !== 1 ? 's' : ''}
            {weekendsOnly ? ' (weekends)' : ''}
          </h2>
          {totalAvailable > 0
            ? <span className="badge badge-green">{totalAvailable} total sites open</span>
            : <span className="badge badge-gray">Nothing available right now</span>}
        </div>
      )}

      {groups.map((g) => <DateSection key={g.arrivalDate} group={g} coordsByParkId={coordsByParkId} />)}
    </div>
  );
}
