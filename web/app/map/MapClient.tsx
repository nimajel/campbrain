'use client';

import { useState, useMemo, useCallback, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import type { MapPark } from '../api/map/catalog/route';
import type { ParkAvailabilityResponse, AvailableDateEntry, WeekendEntry } from '../api/map/availability/route';
import SiteFilterPanel from '../components/SiteFilterPanel';
import { passesSiteFilters } from '../../lib/site-filters';
import { injectBookingDates } from '../../lib/booking-url';

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false });

// Render up to `max` site names with a "+N more" suffix.
function siteListText(sites: string[], max = 5): string {
  return sites.slice(0, max).join(', ') + (sites.length > max ? ` +${sites.length - max} more` : '');
}

/** "Book →" link that injects the actual arrival date + nights into the ReserveCalifornia URL. */
function BookLink({ url, arrival, nights }: { url?: string; arrival: string; nights: number }) {
  if (!url) return null;
  return (
    <>
      {' '}
      <a
        href={injectBookingDates(url, arrival, nights)}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: 11, fontWeight: 400 }}
      >
        Book →
      </a>
    </>
  );
}

/** Greyed line listing walk-up / first-come sites that cannot be reserved online. */
function WalkUpLine({ sites }: { sites: string[] }) {
  if (sites.length === 0) return null;
  return (
    <div style={{ fontSize: 11, color: 'var(--muted)', paddingLeft: 8, marginTop: 2 }}>
      <span className="badge badge-gray" style={{ fontSize: 9 }}>walk-up</span>
      {' '}
      {siteListText(sites, 4)}
      <span style={{ fontStyle: 'italic' }}> · first-come, not reservable</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function statusBadge(status?: string): string {
  if (status === 'success') return 'badge-green';
  if (status === 'failed') return 'badge-red';
  if (status === 'pending') return 'badge-blue';
  return 'badge-gray';
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/** "Jun 1" style label for the day before a fully-booked stretch ends. */
function relativeDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const prev = new Date(y!, m! - 1, d!);
  prev.setDate(prev.getDate() - 1);
  return prev.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function relativeTime(iso?: string | null): string {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Availability fetcher — simple hook
// ---------------------------------------------------------------------------

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; data: ParkAvailabilityResponse }
  | { status: 'error'; message: string };

function useParkAvailability(parkPageId: string | null, from: string, to: string): FetchState {
  const [cache, setCache] = useState<Record<string, FetchState>>({});

  // Cache per (park, dateRange) so switching dates refetches the constrained view.
  const key = parkPageId ? `${parkPageId}|${from}|${to}` : null;

  // Trigger fetch when the park or date range changes
  useMemo(() => {
    if (!parkPageId || !key) return;
    if (cache[key]) return;

    setCache((prev) => ({ ...prev, [key]: { status: 'loading' } }));

    const params = new URLSearchParams({ parkPageId });
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    fetch(`/api/map/availability?${params.toString()}`)
      .then((r) => r.json() as Promise<ParkAvailabilityResponse>)
      .then((data) => {
        setCache((prev) => ({ ...prev, [key]: { status: 'done', data } }));
      })
      .catch((err: unknown) => {
        setCache((prev) => ({
          ...prev,
          [key]: { status: 'error', message: String(err) },
        }));
      });
  }, [parkPageId, key, from, to, cache]);

  if (!key) return { status: 'idle' };
  return cache[key] ?? { status: 'loading' };
}

// ---------------------------------------------------------------------------
// Date section
// ---------------------------------------------------------------------------

function DateRow({ entry }: { entry: AvailableDateEntry }) {
  const totalSites = entry.campgrounds.reduce((s, cg) => s + cg.availableSiteCount, 0);
  return (
    <div style={{
      padding: '8px 0',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{
          fontWeight: 600,
          fontSize: 13,
          color: entry.isWeekend ? 'var(--green)' : 'var(--text)',
        }}>
          {entry.dayLabel}
          {entry.isWeekend && (
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--green)', marginLeft: 6 }}>weekend</span>
          )}
        </span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {totalSites} site{totalSites !== 1 ? 's' : ''} open
        </span>
      </div>
      {entry.campgrounds.map((cg) => (
        <div key={cg.name} style={{ fontSize: 12, color: 'var(--muted)', paddingLeft: 8 }}>
          <span style={{ color: 'var(--text)' }}>{cg.name}</span>
          {cg.sites.length > 0 && (
            <>
              {' — '}
              {siteListText(cg.sites, 6)}
              <BookLink url={cg.bookingUrl} arrival={entry.date} nights={1} />
            </>
          )}
          <WalkUpLine sites={cg.walkUpSites} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekend section
// ---------------------------------------------------------------------------

function WeekendRow({ entry, nightCount }: { entry: WeekendEntry; nightCount: number | null }) {
  const show3Night = nightCount !== 1 && nightCount !== 2;
  const show2Night = nightCount !== 1;

  const hasFull3Night = show3Night && entry.campgrounds.some((cg) => cg.sites3Night.length > 0);
  const has2NightFri = show2Night && entry.campgrounds.some((cg) => cg.sites2NightFri.length > 0);
  const has2NightSat = show2Night && entry.campgrounds.some((cg) => cg.sites2NightSat.length > 0);

  return (
    <div style={{
      background: 'rgba(62,207,142,.05)',
      border: '1px solid rgba(62,207,142,.2)',
      borderRadius: 6,
      padding: '10px 12px',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--green)' }}>
          {entry.label}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {hasFull3Night && (
            <span className="badge badge-green" style={{ fontSize: 10 }}>Fri–Mon</span>
          )}
          {has2NightFri && !hasFull3Night && (
            <span className="badge badge-green" style={{ fontSize: 10 }}>Fri–Sun</span>
          )}
          {has2NightSat && !hasFull3Night && (
            <span className="badge badge-green" style={{ fontSize: 10 }}>Sat–Mon</span>
          )}
        </div>
      </div>

      {entry.campgrounds.map((cg) => {
        const fri = entry.fridayDate;
        const sat = entry.saturdayDate;

        // Pick which stay lines to show. Each line books the exact arrival + nights.
        const line3 = show3Night && cg.sites3Night.length > 0;
        const line2Fri = show2Night && cg.sites2NightFri.length > 0 && !line3;
        const line2Sat = show2Night && cg.sites2NightSat.length > 0 && !line3;
        // 1-night options only when explicitly asked for, or nothing longer qualifies.
        const longerShown = line3 || line2Fri || line2Sat;
        const show1Night = nightCount === 1 || (nightCount === null && !longerShown);
        const line1Fri = show1Night && cg.sites1NightFri.length > 0;
        const line1Sat = show1Night && cg.sites1NightSat.length > 0;

        const hasBookable = line3 || line2Fri || line2Sat || line1Fri || line1Sat;
        if (!hasBookable && cg.walkUpSites.length === 0) return null;

        return (
          <div key={cg.name} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{cg.name}</div>
            {line3 && (
              <div style={{ fontSize: 11, color: 'var(--green)', paddingLeft: 8 }}>
                Fri–Mon (3 nights): {siteListText(cg.sites3Night)}
                <BookLink url={cg.bookingUrl} arrival={fri} nights={3} />
              </div>
            )}
            {line2Fri && (
              <div style={{ fontSize: 11, color: 'var(--muted)', paddingLeft: 8 }}>
                Fri–Sun (2 nights): {siteListText(cg.sites2NightFri)}
                <BookLink url={cg.bookingUrl} arrival={fri} nights={2} />
              </div>
            )}
            {line2Sat && (
              <div style={{ fontSize: 11, color: 'var(--muted)', paddingLeft: 8 }}>
                Sat–Mon (2 nights): {siteListText(cg.sites2NightSat)}
                <BookLink url={cg.bookingUrl} arrival={sat} nights={2} />
              </div>
            )}
            {line1Fri && (
              <div style={{ fontSize: 11, color: 'var(--muted)', paddingLeft: 8 }}>
                Fri (1 night): {siteListText(cg.sites1NightFri)}
                <BookLink url={cg.bookingUrl} arrival={fri} nights={1} />
              </div>
            )}
            {line1Sat && (
              <div style={{ fontSize: 11, color: 'var(--muted)', paddingLeft: 8 }}>
                Sat (1 night): {siteListText(cg.sites1NightSat)}
                <BookLink url={cg.bookingUrl} arrival={sat} nights={1} />
              </div>
            )}
            <WalkUpLine sites={cg.walkUpSites} />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function DetailPanel({
  park,
  onClose,
  activeFilters,
  nightCount,
  tab,
  availFrom,
  availTo,
}: {
  park: MapPark;
  onClose: () => void;
  activeFilters: string[];
  nightCount: number | null;
  tab: 'dates' | 'weekends';
  availFrom: string;
  availTo: string;
}) {
  const fetchState = useParkAvailability(park.parkPageId, availFrom, availTo);

  const data = fetchState.status === 'done' ? fetchState.data : null;

  const filteredDates = useMemo(() => {
    if (!data) return [];
    return data.nextAvailableDates
      .map((entry) => ({
        ...entry,
        campgrounds: entry.campgrounds
          .map((cg) => {
            const sites = cg.sites.filter((s) => passesSiteFilters(s, cg.name, activeFilters));
            const walkUpSites = cg.walkUpSites.filter((s) => passesSiteFilters(s, cg.name, activeFilters));
            return { ...cg, sites, walkUpSites, availableSiteCount: sites.length };
          })
          .filter((cg) => cg.sites.length > 0 || cg.walkUpSites.length > 0),
      }))
      .filter((entry) => entry.campgrounds.length > 0);
  }, [data, activeFilters]);

  const filteredWeekends = useMemo(() => {
    if (!data) return [];
    return data.nextAvailableWeekends
      .map((w) => ({
        ...w,
        campgrounds: w.campgrounds
          .map((cg) => {
            const filt = (arr: string[]) => arr.filter((s) => passesSiteFilters(s, cg.name, activeFilters));
            const f3 = (nightCount === 1 || nightCount === 2) ? [] : filt(cg.sites3Night);
            const f2Fri = nightCount === 1 ? [] : filt(cg.sites2NightFri);
            const f2Sat = nightCount === 1 ? [] : filt(cg.sites2NightSat);
            const f1Fri = nightCount === 2 ? [] : filt(cg.sites1NightFri);
            const f1Sat = nightCount === 2 ? [] : filt(cg.sites1NightSat);
            // Walk-up sites are never reservable, so omit them from the 2-night view.
            const walk = nightCount === 2 ? [] : filt(cg.walkUpSites);
            return {
              ...cg,
              sites3Night: f3,
              sites2NightFri: f2Fri,
              sites2NightSat: f2Sat,
              sites1NightFri: f1Fri,
              sites1NightSat: f1Sat,
              walkUpSites: walk,
            };
          })
          .filter((cg) => {
            if (nightCount === 2) return cg.sites2NightFri.length > 0 || cg.sites2NightSat.length > 0;
            return (
              cg.sites1NightFri.length > 0 ||
              cg.sites1NightSat.length > 0 ||
              cg.walkUpSites.length > 0
            );
          }),
      }))
      .filter((w) => w.campgrounds.length > 0);
  }, [data, activeFilters, nightCount]);

  return (
    <div className="map-detail-panel">
      <div className="map-detail-header">
        <div>
          <h2 style={{ margin: 0 }}>{park.parkName}</h2>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
            <span className={`badge ${statusBadge(park.discoveryStatus)}`}>
              {park.discoveryStatus ?? 'unknown'}
            </span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
              {park.campgroundCount} campground{park.campgroundCount !== 1 ? 's' : ''} · {park.siteCount} sites
            </span>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={onClose} style={{ padding: '4px 10px' }}>✕</button>
      </div>

      {data && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          Cache as of {relativeTime(data.asOf)}
        </div>
      )}

      {park.campgroundCount === 0 ? (
        <div className="empty">
          <p>No campground data loaded yet.</p>
          <p style={{ fontSize: 12 }}>Run <code>npm run catalog:refresh</code> to discover campgrounds.</p>
        </div>
      ) : (
        <>
          {fetchState.status === 'loading' && (
            <div className="empty">Loading availability…</div>
          )}

          {fetchState.status === 'error' && (
            <div style={{ color: 'var(--red)', fontSize: 13 }}>
              Failed to load availability.
            </div>
          )}

          {fetchState.status === 'done' && tab === 'weekends' && (
            <>
              {filteredWeekends.length === 0 ? (
                <div className="empty">
                  {filteredDates.length > 0 ? (
                    // Weekday availability exists but no weekends — show accurate next date
                    <>
                      No weekend openings.
                      <br />
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        Next available (weekday): {formatDate(filteredDates[0]!.date)}
                      </span>
                    </>
                  ) : activeFilters.length > 0 ? (
                    // Site filters eliminated everything
                    <>No weekends match your current filters.</>
                  ) : data!.earliestAvailableDate ? (
                    // Genuinely fully booked — no filters involved
                    <>
                      Fully booked through{' '}
                      {relativeDate(data!.earliestAvailableDate)}.
                      <br />
                      <span style={{ fontSize: 12, color: 'var(--green)' }}>
                        Next opening: {formatDate(data!.earliestAvailableDate)}
                      </span>
                    </>
                  ) : (
                    <>
                      No weekend availability in the cached windows.
                      <br />
                      <span style={{ fontSize: 12 }}>Worker scans every 2 hours.</span>
                    </>
                  )}
                </div>
              ) : (
                filteredWeekends.map((w) => (
                  <WeekendRow key={w.fridayDate} entry={w} nightCount={nightCount} />
                ))
              )}
            </>
          )}

          {fetchState.status === 'done' && tab === 'dates' && (
            <>
              {filteredDates.length === 0 ? (
                <div className="empty">
                  {activeFilters.length > 0 ? (
                    // Site filters eliminated everything — don't show unfiltered "next opening"
                    <>No dates match your current filters.</>
                  ) : data!.earliestAvailableDate ? (
                    // Genuinely fully booked — no filters involved
                    <>
                      Fully booked through{' '}
                      {relativeDate(data!.earliestAvailableDate)}.
                      <br />
                      <span style={{ fontSize: 12, color: 'var(--green)' }}>
                        Next opening: {formatDate(data!.earliestAvailableDate)}
                      </span>
                    </>
                  ) : (
                    <>
                      No availability in the cached windows.
                      <br />
                      <span style={{ fontSize: 12 }}>Worker scans every 2 hours.</span>
                    </>
                  )}
                </div>
              ) : (
                <div>
                  {filteredDates.map((d) => (
                    <DateRow key={d.date} entry={d} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main MapClient
// ---------------------------------------------------------------------------

export default function MapClient({ initialParks }: { initialParks: MapPark[] }) {
  const [parks] = useState<MapPark[]>(initialParks);
  const [selectedPark, setSelectedPark] = useState<MapPark | null>(null);
  const [selectedParkId, setSelectedParkId] = useState('');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [nightCount, setNightCount] = useState<number | null>(null);
  const [tab, setTab] = useState<'weekends' | 'dates'>('weekends');

  // Distance filter
  const [locationQuery, setLocationQuery] = useState('');
  const [resolvedLocation, setResolvedLocation] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  // Date availability filter
  const [availFrom, setAvailFrom] = useState('');
  const [availTo, setAvailTo] = useState('');
  const [parksInDateRange, setParksInDateRange] = useState<Set<string> | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  useEffect(() => {
    if (!availFrom && !availTo) {
      setParksInDateRange(null);
      return;
    }
    const id = setTimeout(() => {
      setLoadingAvailability(true);
      const params = new URLSearchParams();
      if (availFrom) params.set('from', availFrom);
      if (availTo) params.set('to', availTo);
      if (activeFilters.length > 0) params.set('filters', activeFilters.join(','));
      if (tab === 'weekends') params.set('weekendsOnly', 'true');
      fetch(`/api/map/availability/summary?${params.toString()}`)
        .then((r) => r.json() as Promise<{ parks: string[] }>)
        .then((data) => { setParksInDateRange(new Set(data.parks)); })
        .catch(() => {})
        .finally(() => { setLoadingAvailability(false); });
    }, 400);
    return () => clearTimeout(id);
  }, [availFrom, availTo, activeFilters, tab]);

  const sortedParks = useMemo(
    () => [...parks].sort((a, b) => a.parkName.localeCompare(b.parkName)),
    [parks],
  );

  const allParksWithCoords = useMemo(
    () => parks.filter((p) => p.latitude && p.longitude),
    [parks],
  );

  // Parks matching ALL filters — used for count display.
  const filteredParks = useMemo(() => {
    let result = selectedParkId
      ? parks.filter((p) => p.parkPageId === selectedParkId)
      : parks;

    if (resolvedLocation && distanceMiles !== null) {
      result = result.filter((p) => {
        if (!p.latitude || !p.longitude) return false;
        return haversine(resolvedLocation.lat, resolvedLocation.lon, p.latitude, p.longitude) <= distanceMiles;
      });
    }

    if (parksInDateRange !== null) {
      result = result.filter((p) => parksInDateRange.has(p.parkPageId));
    }

    return result;
  }, [parks, selectedParkId, resolvedLocation, distanceMiles, parksInDateRange]);

  // Parks visible on map: distance filter hard-removes pins; other filters only grey them.
  const displayedParks = useMemo(() => {
    if (!resolvedLocation || distanceMiles === null) return allParksWithCoords;
    return allParksWithCoords.filter((p) => {
      if (!p.latitude || !p.longitude) return false;
      return haversine(resolvedLocation.lat, resolvedLocation.lon, p.latitude, p.longitude) <= distanceMiles;
    });
  }, [allParksWithCoords, resolvedLocation, distanceMiles]);

  const hasActiveFilters =
    !!selectedParkId || activeFilters.length > 0 || nightCount !== null ||
    resolvedLocation !== null || !!availFrom || !!availTo;

  // Which displayed parks get a blue pin (match non-distance filters).
  // null = no non-distance filter active → all displayed parks are blue.
  const hasOtherFilters = !!selectedParkId || parksInDateRange !== null;
  const matchingParkIds = useMemo(
    () => hasOtherFilters
      ? new Set(filteredParks.filter((p) => p.latitude && p.longitude).map((p) => p.parkPageId))
      : null,
    [hasOtherFilters, filteredParks],
  );

  const handleSelectPark = useCallback((park: MapPark) => {
    setSelectedPark(park);
  }, []);

  async function handleGeocode() {
    const q = locationQuery.trim();
    if (!q) return;
    setGeocoding(true);
    setGeocodeError(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`;
      const res = await fetch(url, { headers: { 'User-Agent': 'CampBrain/1.0 (personal camping assistant)' } });
      const data = await res.json() as Array<{ lat: string; lon: string; display_name: string }>;
      if (!data[0]) {
        setGeocodeError('Location not found — try a city name');
        return;
      }
      setResolvedLocation({
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
        name: data[0].display_name.split(',').slice(0, 2).join(',').trim(),
      });
    } catch {
      setGeocodeError('Geocoding failed');
    } finally {
      setGeocoding(false);
    }
  }

  function handleCurrentLocation() {
    if (!navigator.geolocation) {
      setGeocodeError('Geolocation not supported');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setResolvedLocation({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          name: 'My location',
        });
        setLocationQuery('My location');
        setGeocodeError(null);
      },
      () => setGeocodeError('Location access denied'),
    );
  }

  function handleResetFilters() {
    setSelectedPark(null);
    setSelectedParkId('');
    setActiveFilters([]);
    setNightCount(null);
    setLocationQuery('');
    setResolvedLocation(null);
    setDistanceMiles(null);
    setGeocodeError(null);
    setAvailFrom('');
    setAvailTo('');
    setParksInDateRange(null);
  }

  return (
    <div className="map-page">
      {/* Filter bar */}
      <div className="map-filters">

        {/* Row 1: primary filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Park dropdown */}
          <select
            value={selectedParkId}
            onChange={(e) => {
              const id = e.target.value;
              setSelectedParkId(id);
              // Selecting a park by name should reveal it: open its panel and pan to it.
              const park = id ? parks.find((p) => p.parkPageId === id) ?? null : null;
              setSelectedPark(park);
            }}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: selectedParkId ? 'var(--text)' : 'var(--muted)',
              padding: '4px 8px',
              fontSize: 12,
              fontFamily: 'var(--font)',
              minWidth: 160,
              maxWidth: 240,
            }}
          >
            <option value="">All parks</option>
            {sortedParks.map((p) => (
              <option key={p.parkPageId} value={p.parkPageId}>{p.parkName}</option>
            ))}
          </select>

          {/* View: Weekends / All dates */}
          <div style={{ display: 'flex', gap: 3 }}>
            {(['weekends', 'dates'] as const).map((t) => {
              const active = tab === t;
              const label = t === 'weekends' ? 'Weekends' : 'All dates';
              return (
                <button
                  key={t}
                  type="button"
                  className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setTab(t)}
                  style={active ? { fontWeight: 700 } : {}}
                >
                  {active ? `✓ ${label}` : label}
                </button>
              );
            })}
          </div>

          {/* Nights */}
          <div style={{ display: 'flex', gap: 3 }}>
            {([null, 1, 2] as Array<number | null>).map((n) => {
              const active = nightCount === n;
              const label = n === null ? 'All nights' : `${n}N`;
              return (
                <button
                  key={String(n)}
                  type="button"
                  className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setNightCount(n)}
                  style={active ? { fontWeight: 700 } : {}}
                >
                  {active ? `✓ ${label}` : label}
                </button>
              );
            })}
          </div>

          <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>
            {filteredParks.length} / {parks.length} parks
          </span>

          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleResetFilters}
            >
              ↺ Reset
            </button>
          )}
        </div>

        {/* Row 2: site filters */}
        <SiteFilterPanel activeFilters={activeFilters} onChange={setActiveFilters} />

        {/* Row 3: location + distance + date range */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Location */}
          <form
            onSubmit={(e) => { e.preventDefault(); void handleGeocode(); }}
            style={{ display: 'flex', gap: 4, alignItems: 'center' }}
          >
            <input
              className="form-input"
              placeholder="Near city…"
              value={locationQuery}
              onChange={(e) => {
                setLocationQuery(e.target.value);
                if (!e.target.value) { setResolvedLocation(null); setGeocodeError(null); }
              }}
              style={{ width: 150, padding: '4px 8px', fontSize: 12 }}
            />
            <button type="submit" className="btn btn-ghost btn-sm" disabled={geocoding} title="Search location">
              {geocoding ? '…' : '→'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleCurrentLocation} title="Use my location">
              📍
            </button>
          </form>

          {resolvedLocation && (
            <span style={{ fontSize: 11, color: 'var(--green)', whiteSpace: 'nowrap' }}>
              ✓ {resolvedLocation.name}
            </span>
          )}
          {geocodeError && (
            <span style={{ fontSize: 11, color: 'var(--red)' }}>{geocodeError}</span>
          )}

          {/* Distance chips — only active when location is resolved */}
          <div style={{ display: 'flex', gap: 3 }}>
            {([null, 25, 50, 100, 200] as Array<number | null>).map((d) => {
              const active = distanceMiles === d && resolvedLocation !== null;
              const label = d === null ? 'Any' : `${d}mi`;
              return (
                <button
                  key={String(d)}
                  type="button"
                  className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setDistanceMiles(d)}
                  style={active ? { fontWeight: 700 } : {}}
                >
                  {active ? `✓ ${label}` : label}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

          {/* Date range */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="date"
              value={availFrom}
              min={todayIso()}
              onChange={(e) => setAvailFrom(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', width: 135, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'var(--font)', colorScheme: 'dark' }}
            />
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
            <input
              type="date"
              value={availTo}
              min={availFrom || todayIso()}
              onChange={(e) => setAvailTo(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', width: 135, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'var(--font)', colorScheme: 'dark' }}
            />
            <button
              type="button"
              className={`btn btn-sm ${availFrom === todayIso() && availTo === addDaysIso(todayIso(), 14) ? 'btn-primary' : 'btn-ghost'}`}
              style={availFrom === todayIso() && availTo === addDaysIso(todayIso(), 14) ? { fontWeight: 700 } : {}}
              onClick={() => { setAvailFrom(todayIso()); setAvailTo(addDaysIso(todayIso(), 14)); }}
            >
              {availFrom === todayIso() && availTo === addDaysIso(todayIso(), 14) ? '✓ 2 weeks' : '2 weeks'}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${availFrom === todayIso() && availTo === addDaysIso(todayIso(), 30) ? 'btn-primary' : 'btn-ghost'}`}
              style={availFrom === todayIso() && availTo === addDaysIso(todayIso(), 30) ? { fontWeight: 700 } : {}}
              onClick={() => { setAvailFrom(todayIso()); setAvailTo(addDaysIso(todayIso(), 30)); }}
            >
              {availFrom === todayIso() && availTo === addDaysIso(todayIso(), 30) ? '✓ 1 month' : '1 month'}
            </button>
            {(availFrom || availTo) && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { setAvailFrom(''); setAvailTo(''); }}
              >
                ✕
              </button>
            )}
            {loadingAvailability && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Loading…</span>
            )}
            {parksInDateRange !== null && !loadingAvailability && (
              <span style={{ fontSize: 11, color: 'var(--green)' }}>
                {filteredParks.length} match
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Map — fills remaining space */}
      <div className="map-container">
        <Suspense fallback={<div className="empty">Loading map…</div>}>
          <LeafletMap
            parks={displayedParks}
            selectedPark={selectedPark}
            onSelectPark={handleSelectPark}
            focusLocation={resolvedLocation}
            distanceMiles={distanceMiles}
            matchingParkIds={matchingParkIds}
          />
        </Suspense>
      </div>

      {/* Detail panel — overlays on right when a park is selected */}
      {selectedPark && (
        <DetailPanel
          park={selectedPark}
          onClose={() => setSelectedPark(null)}
          activeFilters={activeFilters}
          nightCount={nightCount}
          tab={tab}
          availFrom={availFrom}
          availTo={availTo}
        />
      )}
    </div>
  );
}
