'use client';

import { useState, useMemo, useEffect, memo } from 'react';
import type { AvailabilityWindowEntry } from '../../lib/availability-cache';
import SiteFilterPanel from '../components/SiteFilterPanel';
import ParkMapPopover from '../components/ParkMapPopover';
import { passesSiteFilters, campgroundPassesFilters } from '../../lib/site-filters';
import { injectBookingDates } from '../../lib/booking-url';

// ---------------------------------------------------------------------------
// Date helpers (string-only, no Date objects in hot paths)
// ---------------------------------------------------------------------------

function parseDateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function addDaysToIso(iso: string, n: number): string {
  const d = parseDateLocal(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isWeekendArrival(iso: string): boolean {
  return parseDateLocal(iso).getDay() === 5 || parseDateLocal(iso).getDay() === 6;
}
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
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
function todayIso(): string { return new Date().toISOString().slice(0, 10); }

// ---------------------------------------------------------------------------
// Pre-computed lookup: built once when entries change.
// parkPageId → campgroundName → siteName → date → status
// ---------------------------------------------------------------------------

type SiteStatus = 'available' | 'unavailable' | 'unknown';
type CampgroundMeta = {
  id: string; nightlyFee?: number; bookingUrl?: string;
  sites: Map<string, Map<string, SiteStatus>>;
};
type ParkMeta = { parkName: string; minNightlyFee?: number; campgrounds: Map<string, CampgroundMeta> };
type Lookup = { parks: Map<string, ParkMeta>; allDates: string[] };

function buildLookup(windows: AvailabilityWindowEntry[]): Lookup {
  const parks = new Map<string, ParkMeta>();
  const allDatesSet = new Set<string>();

  for (const w of windows) {
    let d = w.windowStart;
    while (d <= w.windowEnd) { allDatesSet.add(d); d = addDaysToIso(d, 1); }

    if (!parks.has(w.parkPageId)) parks.set(w.parkPageId, { parkName: w.parkName, campgrounds: new Map() });
    const park = parks.get(w.parkPageId)!;

    for (const cg of w.campgrounds) {
      if (!park.campgrounds.has(cg.name)) park.campgrounds.set(cg.name, { id: cg.id, sites: new Map() });
      const cgMeta = park.campgrounds.get(cg.name)!;

      if (cg.nightlyFee !== undefined) {
        if (park.minNightlyFee === undefined || cg.nightlyFee < park.minNightlyFee) park.minNightlyFee = cg.nightlyFee;
        cgMeta.nightlyFee = cg.nightlyFee;
      }
      if (cg.bookingUrl) cgMeta.bookingUrl = cg.bookingUrl;

      for (const site of cg.sites) {
        if (!cgMeta.sites.has(site.name)) cgMeta.sites.set(site.name, new Map());
        const dateLookup = cgMeta.sites.get(site.name)!;
        for (const [date, status] of Object.entries(site.dates)) {
          dateLookup.set(date, status as SiteStatus);
        }
      }
    }
  }

  return { parks, allDates: Array.from(allDatesSet).sort() };
}

// Fast site availability check: O(nights × sites) using the pre-built map
function availableSites(cgMeta: CampgroundMeta, arrivalDate: string, nights: number): string[] {
  // Pre-build required dates once
  const required: string[] = [];
  for (let i = 0; i < nights; i++) required.push(addDaysToIso(arrivalDate, i));

  const out: string[] = [];
  for (const [siteName, dateLookup] of cgMeta.sites) {
    if (required.every((d) => dateLookup.get(d) === 'available')) out.push(siteName);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CampgroundResult = {
  id: string; name: string; nightlyFee?: number; bookingUrl?: string;
  nights: number; arrivalDate: string; departureDate: string; availableSites: string[];
};
type ParkGroup = {
  parkName: string; parkPageId: string; campgrounds: CampgroundResult[]; minNightlyFee?: number;
};
type DateGroup = { arrivalDate: string; parks: ParkGroup[]; totalAvailable: number };

// ---------------------------------------------------------------------------
// Grouping with early exit — stops once `limit` date groups are collected.
// Campground filter results are cached per (name, filterKey) to avoid
// re-running regex on every date × park iteration.
// ---------------------------------------------------------------------------

function groupFromLookup(
  lookup: Lookup,
  opts: {
    activeFilters: string[]; showUnavailable: boolean; weekendsOnly: boolean;
    nightsFilter: number | null; dateFrom: string; dateTo: string; limit: number;
  }
): { groups: DateGroup[]; hasMore: boolean; totalDatesChecked: number } {
  const { activeFilters, showUnavailable, weekendsOnly, nightsFilter, dateFrom, dateTo, limit } = opts;
  const nightsCounts = nightsFilter !== null ? [nightsFilter] : [1, 2];

  // Cache campground filter results for this call (avoids regex per iteration)
  const filterKey = activeFilters.join(',');
  const cgFilterCache = new Map<string, boolean>();
  function cgPasses(name: string): boolean {
    const k = `${name}::${filterKey}`;
    if (!cgFilterCache.has(k)) cgFilterCache.set(k, campgroundPassesFilters(name, activeFilters));
    return cgFilterCache.get(k)!;
  }

  const groups: DateGroup[] = [];
  let totalDatesChecked = 0;

  for (const date of lookup.allDates) {
    if (weekendsOnly && !isWeekendArrival(date)) continue;
    if (dateFrom && date < dateFrom) continue;
    if (dateTo && date > dateTo) continue;
    totalDatesChecked++;

    const parkGroups: ParkGroup[] = [];

    for (const [parkPageId, parkMeta] of lookup.parks) {
      const campgrounds: CampgroundResult[] = [];

      for (const [cgName, cgMeta] of parkMeta.campgrounds) {
        if (!cgPasses(cgName)) continue;

        for (const nights of nightsCounts) {
          const allAvail = availableSites(cgMeta, date, nights);
          const filtered = activeFilters.length
            ? allAvail.filter((s) => passesSiteFilters(s, cgName, activeFilters))
            : allAvail;

          if (!showUnavailable && filtered.length === 0) continue;

          campgrounds.push({
            id: cgMeta.id, name: cgName,
            nightlyFee: cgMeta.nightlyFee, bookingUrl: cgMeta.bookingUrl,
            nights, arrivalDate: date, departureDate: addDaysToIso(date, nights),
            availableSites: filtered,
          });
        }
      }

      if (campgrounds.length > 0) {
        parkGroups.push({ parkPageId, parkName: parkMeta.parkName, campgrounds, minNightlyFee: parkMeta.minNightlyFee });
      }
    }

    if (!showUnavailable && parkGroups.length === 0) continue;

    const totalAvailable = parkGroups.reduce(
      (n, p) => n + p.campgrounds.reduce((m, c) => m + c.availableSites.length, 0), 0
    );
    if (!showUnavailable && totalAvailable === 0) continue;

    parkGroups.sort((a, b) => a.parkName.localeCompare(b.parkName));
    groups.push({ arrivalDate: date, parks: parkGroups, totalAvailable });

    if (groups.length >= limit) {
      // Found enough — check if there are more dates to process
      const remaining = lookup.allDates.filter((d) => {
        if (d <= date) return false;
        if (weekendsOnly && !isWeekendArrival(d)) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
      return { groups, hasMore: remaining.length > 0, totalDatesChecked };
    }
  }

  return { groups, hasMore: false, totalDatesChecked };
}

// ---------------------------------------------------------------------------
// Sub-components — memoized so unchanged cards don't re-render on filter change
// ---------------------------------------------------------------------------

const CampgroundRow = memo(function CampgroundRow({ cg }: { cg: CampgroundResult }) {
  const hasAvail = cg.availableSites.length > 0;
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
  // Start collapsed — expand on click. Keeps the render tree small on initial load
  // and after filter changes (only the header row renders for each park).
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [group.parkPageId, group.parkName]);

  return (
    <div className="card" style={{ marginBottom: 8, padding: open ? undefined : '8px 16px' }}>
      {/* div (not button) — ParkMapPopover renders its own button inside */}
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
  initialEntries: AvailabilityWindowEntry[];
  coordsByParkId?: Record<string, { lat: number; lon: number }>;
}) {
  const [entries, setEntries] = useState(initialEntries);
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

  const lastScanAt = entries.length > 0 ? entries.map((e) => e.scannedAt).sort().at(-1) : null;

  // Build flat lookup once when entries change (O(entries) — amortised across all filter changes)
  const lookup = useMemo(() => buildLookup(entries), [entries]);

  // Reset pagination when filters change (but not when limit changes — that's the "show more" action)
  const filterKey = `${activeFilters.join(',')}|${showUnavailable}|${weekendsOnly}|${nightsFilter}|${dateFrom}|${dateTo}`;
  useEffect(() => { setLimit(PAGE_SIZE); }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Synchronous useMemo — fast because groupFromLookup exits early at `limit` results.
  // With PAGE_SIZE=15 this processes only the first ~15–20 matching dates, not all 180.
  const { groups, hasMore } = useMemo(
    () => {
      const r = groupFromLookup(lookup, { activeFilters, showUnavailable, weekendsOnly, nightsFilter, dateFrom, dateTo, limit });
      return { groups: r.groups, hasMore: r.hasMore };
    },
    [lookup, activeFilters, showUnavailable, weekendsOnly, nightsFilter, dateFrom, dateTo, limit]
  );

  const totalAvailable = useMemo(() => groups.reduce((n, g) => n + g.totalAvailable, 0), [groups]);

  // Fix: useEffect (not useMemo) for the side-effect fetch
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
        const { entries: newEntries } = (await fresh.json()) as { entries: AvailabilityWindowEntry[] };
        setEntries(newEntries);
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
          {!refreshMsg && lastScanAt && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Last scan {relativeTime(lastScanAt)}</span>
          )}
          {refreshStatus && (
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
              {refreshStatus.entryCount} windows cached
            </span>
          )}
        </div>
      </div>

      {entries.length === 0 && (
        <div className="empty">
          <p>No cached availability data yet.</p>
          <p style={{ fontSize: 13 }}>Start the worker (<code>npm run worker</code>) or hit <strong>Refresh now</strong>.</p>
        </div>
      )}
      {entries.length > 0 && groups.length === 0 && (
        <div className="empty">No results match your current filters.</div>
      )}

      {groups.length > 0 && (
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
