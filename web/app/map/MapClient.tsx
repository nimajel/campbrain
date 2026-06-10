'use client';

import { useState, useMemo, useCallback, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import type { MapPark } from '../api/map/catalog/route';
import type { ParkAvailabilityResponse, AvailableDateEntry, WeekendEntry } from '../api/map/availability/route';
import SiteFilterPanel from '../components/SiteFilterPanel';
import ProviderBadge from '../../components/ProviderBadge';
import { injectBookingDates } from '../../lib/booking-url';
import { formatSiteName } from '../../lib/site-display';
import ResultsList from './ResultsList';
import { getParkType } from '../../lib/map-pins';
import type { ParkListRow, ParkListSort } from '../../lib/park-list';
import { useIsMobile } from './useIsMobile';
import NavMenu from '../components/NavMenu';
import DateRangePicker from './DateRangePicker';
import { cycleDetent } from '../../lib/sheet-detent';
import type { SheetDetent } from '../../lib/sheet-detent';
import { upcomingWeekendRange } from '../../lib/upcoming-weekend';
import {
  EMPTY_TAXONOMY,
  taxonomyToParams,
  isTaxonomyDefault,
} from '../../lib/site-taxonomy';
import type { TaxonomyState } from '../../lib/site-taxonomy';
import type { SiteAccess } from '../../lib/availability-cache';

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false });

export interface ParkAvailabilitySummary {
  siteCount: number;
  walkUpCount: number;
  soonestDate: string | null;
}

const ACCESS_LABEL: Record<SiteAccess, string> = {
  drive_in: 'drive-in',
  hike_in: 'hike-in',
  boat_in: 'boat-in',
};

/** Site names as capped, expandable chips. */
function SiteChips({ sites, max = 6, muted = false }: { sites: string[]; max?: number; muted?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (sites.length === 0) return null;
  const shown = expanded ? sites : sites.slice(0, max);
  const hidden = sites.length - shown.length;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', flex: 1, minWidth: 0 }}>
      {shown.map((s) => {
        const name = formatSiteName(s);
        return (
          <span key={s} className="site-chip" title={name} style={muted ? { opacity: 0.75 } : undefined}>
            {name}
          </span>
        );
      })}
      {hidden > 0 && (
        <button type="button" className="site-chip site-chip--more" onClick={() => setExpanded(true)}>
          +{hidden} more
        </button>
      )}
      {expanded && sites.length > max && (
        <button type="button" className="site-chip site-chip--more" onClick={() => setExpanded(false)}>
          less
        </button>
      )}
    </div>
  );
}

/** "Book" button that injects the actual arrival date + nights into the ReserveCalifornia URL. */
function BookLink({ url, arrival, nights }: { url?: string; arrival: string; nights: number }) {
  if (!url) return null;
  return (
    <a
      href={injectBookingDates(url, arrival, nights)}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-sm"
      style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11, padding: '2px 10px', textDecoration: 'none' }}
    >
      Book
    </a>
  );
}

/** One bookable stay option: tier label + site chips + Book button. */
function TierLine({ label, sites, url, arrival, nights, highlight = false }: {
  label: string;
  sites: string[];
  url?: string;
  arrival: string;
  nights: number;
  highlight?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingLeft: 8, marginTop: 4 }}>
      <span style={{
        fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', paddingTop: 3,
        color: highlight ? 'var(--green)' : 'var(--muted)',
      }}>
        {label}
      </span>
      <SiteChips sites={sites} />
      <BookLink url={url} arrival={arrival} nights={nights} />
    </div>
  );
}

/** Greyed line listing walk-up / first-come sites that cannot be reserved online. */
function WalkUpLine({ sites }: { sites: string[] }) {
  if (sites.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, paddingLeft: 8, marginTop: 4 }}>
      <span className="badge badge-gray" style={{ fontSize: 9, flexShrink: 0, marginTop: 2 }}>walk-up</span>
      <SiteChips sites={sites} max={4} muted />
      <span style={{ fontSize: 10.5, fontStyle: 'italic', color: 'var(--muted)', whiteSpace: 'nowrap', paddingTop: 2 }}>
        first-come, not reservable
      </span>
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

function formatDate(iso: string): string {
  if (!iso) return '';
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

/** Returns day-of-week 0=Sun..6=Sat for an ISO date string. */
function isoDow(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getDay();
}

/** Check whether a [from, to] range contains any Friday (5) or Saturday (6). */
function rangeHasWeekendDay(from: string, to: string): boolean {
  if (!from || !to) return true; // open range, assume yes
  let cursor = from;
  while (cursor <= to) {
    const dow = isoDow(cursor);
    if (dow === 5 || dow === 6) return true;
    cursor = addDaysIso(cursor, 1);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Availability fetcher — simple hook
// ---------------------------------------------------------------------------

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; data: ParkAvailabilityResponse }
  | { status: 'error'; message: string };

function useParkAvailability(
  parkPageId: string | null,
  facilityPageIds: string[],
  from: string,
  to: string,
  taxonomy: TaxonomyState,
  minNights: 1 | 2 | 3 | null,
  weekendsOnly: boolean,
  provider?: string
): FetchState {
  const [cache, setCache] = useState<Record<string, FetchState>>({});

  // Build the full query string first — use it as the cache key so filter changes
  // always trigger a fresh fetch.
  const cacheKey = useMemo(() => {
    if (!parkPageId) return null;
    const params = new URLSearchParams();
    if (facilityPageIds.length > 0) params.set('facilityIds', facilityPageIds.join(','));
    params.set('parkPageId', parkPageId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (provider) params.set('provider', provider);
    const tax = taxonomyToParams(taxonomy);
    for (const [k, v] of tax) params.set(k, v);
    if (weekendsOnly) params.set('weekendsOnly', 'true');
    if (minNights) params.set('minNights', String(minNights));
    return params.toString();
  }, [parkPageId, facilityPageIds, from, to, provider, taxonomy, weekendsOnly, minNights]);

  useMemo(() => {
    if (!parkPageId || !cacheKey) return;
    if (cache[cacheKey]) return;

    setCache((prev) => ({ ...prev, [cacheKey]: { status: 'loading' } }));

    fetch(`/api/map/availability?${cacheKey}`)
      .then((r) => r.json() as Promise<ParkAvailabilityResponse>)
      .then((data) => {
        setCache((prev) => ({ ...prev, [cacheKey]: { status: 'done', data } }));
      })
      .catch((err: unknown) => {
        setCache((prev) => ({
          ...prev,
          [cacheKey]: { status: 'error', message: String(err) },
        }));
      });
  }, [parkPageId, cacheKey, cache]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cacheKey) return { status: 'idle' };
  return cache[cacheKey] ?? { status: 'loading' };
}

// ---------------------------------------------------------------------------
// Date section
// ---------------------------------------------------------------------------

function DateRow({ entry, nights }: { entry: AvailableDateEntry; nights: number }) {
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
          <span style={{ color: 'var(--text)' }}>
            {cg.name}
            {cg.nightlyFee != null && (
              <span style={{ color: 'var(--muted)' }}> · ${cg.nightlyFee}/night</span>
            )}
          </span>
          {cg.sites.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 2 }}>
              <SiteChips sites={cg.sites} />
              <BookLink url={cg.bookingUrl} arrival={entry.date} nights={nights} />
            </div>
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

function WeekendRow({ entry, minNights }: { entry: WeekendEntry; minNights: number | null }) {
  // minNights=3 → ONLY 3N tier (Fri–Mon)
  // minNights=2 → 2N+3N (a 3N stay satisfies min 2)
  // minNights=1/null → all tiers
  const show3Night = minNights !== 1; // show 3N for null/2/3
  const show2Night = minNights !== 1 && minNights !== 3; // show 2N for null/2 only
  const show3NightOnly = minNights === 3;

  const hasFull3Night = show3Night && entry.campgrounds.some((cg) => cg.sites3Night.length > 0);
  const has2NightFri = show2Night && entry.campgrounds.some((cg) => cg.sites2NightFri.length > 0);
  const has2NightSat = show2Night && entry.campgrounds.some((cg) => cg.sites2NightSat.length > 0);

  // Skip the entire row if no campground will produce visible content for the current minNights.
  const hasAnyVisible = entry.campgrounds.some((cg) => {
    const l3 = show3Night && cg.sites3Night.length > 0;
    const l2f = show2Night && !show3NightOnly && cg.sites2NightFri.length > 0 && !l3;
    const l2s = show2Night && !show3NightOnly && cg.sites2NightSat.length > 0 && !l3;
    const show1 = minNights === 1 || (minNights === null && !(l3 || l2f || l2s));
    return l3 || l2f || l2s ||
      (show1 && (cg.sites1NightFri.length > 0 || cg.sites1NightSat.length > 0)) ||
      cg.walkUpSites.length > 0;
  });
  if (!hasAnyVisible) return null;

  const label = `Weekend of ${formatDate(entry.fridayDate)}`;

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
          {label}
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

        const line3 = show3Night && cg.sites3Night.length > 0;
        // When minNights=3, skip 2-night lines entirely
        const line2Fri = show2Night && !show3NightOnly && cg.sites2NightFri.length > 0 && !line3;
        const line2Sat = show2Night && !show3NightOnly && cg.sites2NightSat.length > 0 && !line3;
        const longerShown = line3 || line2Fri || line2Sat;
        const show1Night = minNights === 1 || (minNights === null && !longerShown);
        const line1Fri = show1Night && cg.sites1NightFri.length > 0;
        const line1Sat = show1Night && cg.sites1NightSat.length > 0;

        const hasBookable = line3 || line2Fri || line2Sat || line1Fri || line1Sat;
        if (!hasBookable && cg.walkUpSites.length === 0) return null;

        return (
          <div key={cg.name} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {cg.name}
              {cg.nightlyFee != null && (
                <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · ${cg.nightlyFee}/night</span>
              )}
            </div>
            {line3 && <TierLine label="Fri–Mon · 3 nights" sites={cg.sites3Night} url={cg.bookingUrl} arrival={fri} nights={3} highlight />}
            {line2Fri && <TierLine label="Fri–Sun · 2 nights" sites={cg.sites2NightFri} url={cg.bookingUrl} arrival={fri} nights={2} />}
            {line2Sat && <TierLine label="Sat–Mon · 2 nights" sites={cg.sites2NightSat} url={cg.bookingUrl} arrival={sat} nights={2} />}
            {line1Fri && <TierLine label="Fri · 1 night" sites={cg.sites1NightFri} url={cg.bookingUrl} arrival={fri} nights={1} />}
            {line1Sat && <TierLine label="Sat · 1 night" sites={cg.sites1NightSat} url={cg.bookingUrl} arrival={sat} nights={1} />}
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
  taxonomy,
  minNights,
  weekendsOnly,
  availFrom,
  availTo,
}: {
  park: MapPark;
  onClose: () => void;
  taxonomy: TaxonomyState;
  minNights: 1 | 2 | 3 | null;
  weekendsOnly: boolean;
  availFrom: string;
  availTo: string;
}) {
  const fetchState = useParkAvailability(
    park.parkPageId,
    park.facilityPageIds,
    availFrom,
    availTo,
    taxonomy,
    minNights,
    weekendsOnly,
    park.provider
  );

  const data = fetchState.status === 'done' ? fetchState.data : null;

  // Server already applies taxonomy — consume the response directly.
  // For the dates view with minNights >= 2, we also need consecutive-nights
  // intersection (stay-shape logic, not taxonomy).
  const processedDates = useMemo(() => {
    if (!data) return [];
    let dates = data.nextAvailableDates;

    if (minNights !== null && minNights >= 2) {
      const byDate = new Map(dates.map((d) => [d.date, d]));
      dates = dates.flatMap((entry) => {
        // Collect N consecutive date entries
        const chain: typeof entry[] = [entry];
        for (let i = 1; i < minNights; i++) {
          const next = byDate.get(addDaysIso(entry.date, i));
          if (!next) return [];
          chain.push(next);
        }
        // Intersect sites across all N dates per campground
        const campgrounds = entry.campgrounds.flatMap((cg) => {
          let sitesIntersection = cg.sites;
          for (let i = 1; i < chain.length; i++) {
            const chainCg = chain[i]!.campgrounds.find((c) => c.name === cg.name);
            if (!chainCg) return [];
            sitesIntersection = sitesIntersection.filter((s) => chainCg.sites.includes(s));
          }
          if (sitesIntersection.length === 0) return [];
          return [{ ...cg, sites: sitesIntersection, walkUpSites: [], availableSiteCount: sitesIntersection.length }];
        });
        if (campgrounds.length === 0) return [];
        return [{ ...entry, campgrounds }];
      });
    }

    return dates;
  }, [data, minNights]);

  const processedWeekends = data?.nextAvailableWeekends ?? [];
  const bookNights = Math.max(minNights ?? 1, 1);

  // Determine empty-state condition
  const noWeekendDays = weekendsOnly && !!availFrom && !!availTo && !rangeHasWeekendDay(availFrom, availTo);
  const taxonomyChanged = !isTaxonomyDefault(taxonomy);

  return (
    <div className="map-detail-panel">
      <div className="map-detail-header">
        <div>
          <h2 style={{ margin: 0 }}>{park.parkName}</h2>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
            <ProviderBadge providerId={park.provider} />
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

          {fetchState.status === 'done' && weekendsOnly && (
            <>
              {noWeekendDays ? (
                <div className="empty">No weekend days in this date range.</div>
              ) : processedWeekends.length === 0 ? (
                <div className="empty">
                  {taxonomyChanged ? (
                    <>No weekends match your current filters.</>
                  ) : data!.earliestAvailableDate ? (
                    <>
                      Fully booked through{' '}
                      {relativeDate(data!.earliestAvailableDate)}.
                      <br />
                      {minNights !== null && minNights >= 2 ? (
                        <span style={{ fontSize: 12 }}>
                          No {minNights}-night stay in this range.
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--green)' }}>
                          Next opening: {formatDate(data!.earliestAvailableDate)}
                        </span>
                      )}
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
                processedWeekends.map((w) => (
                  <WeekendRow key={w.fridayDate} entry={w} minNights={minNights} />
                ))
              )}
            </>
          )}

          {fetchState.status === 'done' && !weekendsOnly && (
            <>
              {processedDates.length === 0 ? (
                <div className="empty">
                  {taxonomyChanged ? (
                    <>No dates match your current filters.</>
                  ) : data!.earliestAvailableDate ? (
                    <>
                      Fully booked through{' '}
                      {relativeDate(data!.earliestAvailableDate)}.
                      <br />
                      {minNights !== null && minNights >= 2 ? (
                        <span style={{ fontSize: 12 }}>
                          No {minNights}-night stay in this range.
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--green)' }}>
                          Next opening: {formatDate(data!.earliestAvailableDate)}
                        </span>
                      )}
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
                  {processedDates.map((d) => (
                    <DateRow key={d.date} entry={d} nights={bookNights} />
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

type Preset = 'this_weekend' | 'next_2_weeks' | 'next_month' | 'anytime';

export default function MapClient({ initialParks }: { initialParks: MapPark[] }) {
  const [parks] = useState<MapPark[]>(initialParks);
  const [selectedPark, setSelectedPark] = useState<MapPark | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // New filter model
  const [taxonomy, setTaxonomy] = useState<TaxonomyState>(EMPTY_TAXONOMY);
  const [minNights, setMinNights] = useState<1 | 2 | 3 | null>(null);
  const [preset, setPreset] = useState<Preset>('this_weekend');
  const [weekendsOnly, setWeekendsOnly] = useState(true);

  // Distance filter
  const [locationQuery, setLocationQuery] = useState('');
  const [resolvedLocation, setResolvedLocation] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  // Date availability filter
  const [availFrom, setAvailFrom] = useState('');
  const [availTo, setAvailTo] = useState('');
  const [availByFacility, setAvailByFacility] = useState<Map<string, ParkAvailabilitySummary> | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  // Results drawer
  const [listOpen, setListOpen] = useState(false);
  const [listSortChoice, setListSortChoice] = useState<ParkListSort | null>(null);
  const listSort: ParkListSort = listSortChoice ?? (resolvedLocation ? 'distance' : 'sites');

  // Mobile
  const isMobile = useIsMobile();
  const [detent, setDetent] = useState<SheetDetent>('peek');
  const [navMenuOpen, setNavMenuOpen] = useState(false);

  // Apply a preset: sets dates and weekendsOnly state
  function applyPreset(p: Preset) {
    setPreset(p);
    if (p === 'this_weekend') {
      const { from, to } = upcomingWeekendRange(new Date());
      setAvailFrom(from);
      setAvailTo(to);
      setWeekendsOnly(true);
    } else if (p === 'next_2_weeks') {
      setAvailFrom(todayIso());
      setAvailTo(addDaysIso(todayIso(), 14));
    } else if (p === 'next_month') {
      setAvailFrom(todayIso());
      setAvailTo(addDaysIso(todayIso(), 30));
    } else {
      // anytime — no clamp: from today, no `to`
      setAvailFrom(todayIso());
      setAvailTo('');
    }
  }

  // Default to the upcoming weekend so pins show weekend availability on first load.
  useEffect(() => {
    const { from, to } = upcomingWeekendRange(new Date());
    setAvailFrom(from);
    setAvailTo(to);
  }, []);

  // Derive active preset from current dates (for display parity with manual edits)
  function derivePreset(from: string, to: string): Preset | null {
    const wk = upcomingWeekendRange(new Date());
    if (from === wk.from && to === wk.to) return 'this_weekend';
    const today = todayIso();
    if (from === today && to === addDaysIso(today, 14)) return 'next_2_weeks';
    if (from === today && to === addDaysIso(today, 30)) return 'next_month';
    if (from === today && to === '') return 'anytime';
    return null;
  }

  // Summary fetch — always runs (no early return for empty dates)
  useEffect(() => {
    const id = setTimeout(() => {
      setLoadingAvailability(true);
      const params = new URLSearchParams(taxonomyToParams(taxonomy));
      if (availFrom) params.set('from', availFrom);
      if (availTo) params.set('to', availTo);
      if (weekendsOnly) params.set('weekendsOnly', 'true');
      if (minNights) params.set('minNights', String(minNights));
      fetch(`/api/map/availability/summary?${params.toString()}`)
        .then((r) => r.json() as Promise<{ parks: { parkPageId: string; siteCount: number; walkUpCount: number; soonestDate: string | null }[] }>)
        .then((data) => {
          setAvailByFacility(
            new Map(data.parks.map((p) => [p.parkPageId, { siteCount: p.siteCount, walkUpCount: p.walkUpCount, soonestDate: p.soonestDate ?? null }])),
          );
        })
        .catch(() => {})
        .finally(() => { setLoadingAvailability(false); });
    }, 400);
    return () => clearTimeout(id);
  }, [availFrom, availTo, taxonomy, weekendsOnly, minNights]);

  const sortedParks = useMemo(
    () => [...parks].sort((a, b) => a.parkName.localeCompare(b.parkName)),
    [parks],
  );

  const allParksWithCoords = useMemo(
    () => parks.filter((p) => p.latitude && p.longitude),
    [parks],
  );

  const filteredParks = useMemo(() => {
    let result = parks;

    if (resolvedLocation && distanceMiles !== null) {
      result = result.filter((p) => {
        if (!p.latitude || !p.longitude) return false;
        return haversine(resolvedLocation.lat, resolvedLocation.lon, p.latitude, p.longitude) <= distanceMiles;
      });
    }

    if (availByFacility !== null) {
      result = result.filter((p) =>
        p.facilityPageIds.some((fid) => (availByFacility.get(fid)?.siteCount ?? 0) > 0)
      );
    }

    return result;
  }, [parks, resolvedLocation, distanceMiles, availByFacility]);

  const displayedParks = useMemo(() => {
    if (!resolvedLocation || distanceMiles === null) return allParksWithCoords;
    return allParksWithCoords.filter((p) => {
      if (!p.latitude || !p.longitude) return false;
      return haversine(resolvedLocation.lat, resolvedLocation.lon, p.latitude, p.longitude) <= distanceMiles;
    });
  }, [allParksWithCoords, resolvedLocation, distanceMiles]);

  const availByPark = useMemo(() => {
    if (!availByFacility) return null;
    const byPark = new Map<string, ParkAvailabilitySummary>();
    for (const p of parks) {
      let siteCount = 0;
      let walkUpCount = 0;
      let soonestDate: string | null = null;
      for (const fid of p.facilityPageIds) {
        const a = availByFacility.get(fid);
        if (!a) continue;
        siteCount += a.siteCount;
        walkUpCount += a.walkUpCount;
        if (a.soonestDate && (soonestDate === null || a.soonestDate < soonestDate)) {
          soonestDate = a.soonestDate;
        }
      }
      byPark.set(p.parkPageId, { siteCount, walkUpCount, soonestDate });
    }
    return byPark;
  }, [parks, availByFacility]);

  // Drawer rows: distance-filtered parks with any availability (bookable OR walk-up —
  // unlike filteredParks, which counts only bookable parks).
  const listRows = useMemo<ParkListRow[]>(() => {
    if (!availByPark) return [];
    return displayedParks.flatMap((p) => {
      const a = availByPark.get(p.parkPageId);
      if (!a || (a.siteCount === 0 && a.walkUpCount === 0)) return [];
      return [{
        parkPageId: p.parkPageId,
        parkName: p.parkName,
        isFederal: getParkType(p.provider) === 'federal',
        siteCount: a.siteCount,
        walkUpCount: a.walkUpCount,
        distanceMi: resolvedLocation && p.latitude && p.longitude
          ? haversine(resolvedLocation.lat, resolvedLocation.lon, p.latitude, p.longitude)
          : null,
        soonestDate: a.soonestDate,
      }];
    });
  }, [displayedParks, availByPark, resolvedLocation]);

  // Summary sentence (Row 4)
  const summarySentence = useMemo(() => {
    const matchCount = filteredParks.length;
    const total = parks.length;
    const parts: string[] = [];
    if (minNights) parts.push(`${minNights}-night`);
    if (taxonomy.access.length === 1) parts.push(ACCESS_LABEL[taxonomy.access[0]!]);
    if (weekendsOnly) parts.push('weekend');
    parts.push('stay');
    const dateClause = availTo ? ` ${formatDate(availFrom)} – ${formatDate(availTo)}` : ' anytime';
    const nearClause = resolvedLocation && distanceMiles ? ` within ${distanceMiles} mi of ${resolvedLocation.name}` : '';
    return { matchCount, total, parts, dateClause, nearClause };
  }, [filteredParks.length, parks.length, minNights, taxonomy.access, weekendsOnly, availFrom, availTo, resolvedLocation, distanceMiles]);

  // Reset is shown when state differs from defaults
  const isDefaultState =
    preset === 'this_weekend' && weekendsOnly && minNights === null &&
    isTaxonomyDefault(taxonomy) && resolvedLocation === null;

  // Filters hidden while collapsed that the summary sentence may not spell out.
  const activeFilterCount =
    taxonomy.access.length + taxonomy.kinds.length + taxonomy.hide.length +
    (minNights !== null ? 1 : 0) +
    (resolvedLocation && distanceMiles !== null ? 1 : 0);

  function handleResetFilters() {
    setTaxonomy(EMPTY_TAXONOMY);
    setMinNights(null);
    setWeekendsOnly(true);
    setLocationQuery('');
    setResolvedLocation(null);
    setDistanceMiles(null);
    setGeocodeError(null);
    applyPreset('this_weekend');
    // NOTE: selectedPark is NOT reset (park selection is navigation, not filter)
  }

  const handleSelectPark = useCallback((park: MapPark) => {
    setSelectedPark(park);
  }, []);

  // Row click = pin click: setSelectedPark flows into FlyTo, so the map zooms to the park.
  const handleSelectRow = useCallback((parkPageId: string) => {
    const park = parks.find((p) => p.parkPageId === parkPageId);
    if (park) setSelectedPark(park);
  }, [parks]);

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

  const PRESETS: { id: Preset; label: string }[] = [
    { id: 'this_weekend', label: 'This weekend' },
    { id: 'next_2_weeks', label: 'Next 2 weeks' },
    { id: 'next_month', label: 'Next month' },
    { id: 'anytime', label: 'Anytime' },
  ];

  const MIN_STAY_OPTIONS: { value: 1 | 2 | 3 | null; label: string }[] = [
    { value: null, label: 'Any' },
    { value: 1, label: '1 night' },
    { value: 2, label: '2 nights' },
    { value: 3, label: '3 nights' },
  ];

  return (
    <div className="map-page">
      {/* Filter bar */}
      <div className={`map-filters${isMobile && filtersOpen ? ' filters-sheet-open' : ''}`}>

        {/* Header row — always visible: toggle, summary sentence, reset, park finder */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {isMobile && !filtersOpen && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-label="Menu"
              onClick={() => setNavMenuOpen(true)}
              style={{ flexShrink: 0, fontWeight: 600 }}
            >
              ☰
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${filtersOpen ? 'btn-slate' : 'btn-ghost'}`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            style={{ flexShrink: 0, fontWeight: 600 }}
          >
            {filtersOpen ? '▾' : '▸'} Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {loadingAvailability ? (
              'Loading…'
            ) : (
              <>
                <strong style={{ color: 'var(--text)' }}>
                  {summarySentence.matchCount} of {summarySentence.total} parks
                </strong>
                {' '}have a {summarySentence.parts.join(' ')}{summarySentence.dateClause}{summarySentence.nearClause}
              </>
            )}
          </span>
          {!isDefaultState && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleResetFilters}
              style={{ flexShrink: 0 }}
            >
              ↺ Reset
            </button>
          )}
          <ParkFinder parks={sortedParks} onSelect={(p) => setSelectedPark(p)} />
        </div>

        {filtersOpen && (
        <>
        {/* Row 1: When */}
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <RowLabel>When</RowLabel>
            {/* Horizon presets */}
            <div style={{ display: 'flex', gap: 3 }}>
              {PRESETS.map(({ id, label }) => {
                const active = preset === id;
                const cls = active ? 'btn-primary' : 'btn-ghost';
                return (
                  <button
                    key={id}
                    type="button"
                    className={`btn btn-sm ${cls}`}
                    onClick={() => applyPreset(id)}
                    style={active ? { fontWeight: 700 } : {}}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Date range picker */}
            <DateRangePicker
              from={availFrom}
              to={availTo}
              mobile={isMobile}
              onChange={(f, t) => {
                setAvailFrom(f);
                setAvailTo(t);
                const derived = derivePreset(f, t);
                if (derived) setPreset(derived);
              }}
            />

            {/* Weekends-only pill: locked when preset is this_weekend */}
            {(() => {
              const locked = preset === 'this_weekend';
              const active = weekendsOnly;
              const cls = active ? 'btn-primary' : 'btn-ghost';
              return (
                <button
                  type="button"
                  className={`btn btn-sm ${cls}`}
                  disabled={locked}
                  onClick={() => !locked && setWeekendsOnly((v) => !v)}
                  style={{ fontWeight: active ? 700 : undefined, opacity: locked ? 0.8 : 1 }}
                  title={locked ? 'Locked on for This weekend preset' : undefined}
                >
                  Weekends only
                </button>
              );
            })()}
          </div>
        </div>

        {/* Row 2: Min stay + Near */}
        <div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Min stay */}
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <RowLabel>Min stay</RowLabel>
                {MIN_STAY_OPTIONS.map(({ value, label }) => {
                  const active = minNights === value;
                  const cls = active ? 'btn-primary' : 'btn-ghost';
                  return (
                    <button
                      key={String(value)}
                      type="button"
                      className={`btn btn-sm ${cls}`}
                      onClick={() => setMinNights(value)}
                      style={active ? { fontWeight: 700 } : {}}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Near */}
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <RowLabel>Near</RowLabel>
                <form
                  onSubmit={(e) => { e.preventDefault(); void handleGeocode(); }}
                  style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                >
                  <input
                    className="form-input"
                    placeholder="City or place…"
                    value={locationQuery}
                    onChange={(e) => {
                      setLocationQuery(e.target.value);
                      if (!e.target.value) { setResolvedLocation(null); setGeocodeError(null); }
                    }}
                    style={{ width: 150, padding: '4px 8px', fontSize: 12 }}
                  />
                  <button type="submit" className="btn btn-ghost btn-sm" disabled={geocoding}>
                    {geocoding ? 'Searching…' : 'Search'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={handleCurrentLocation}>
                    📍 Use my location
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

                {/* Distance pills — disabled until location resolves */}
                <div style={{ display: 'flex', gap: 3 }}>
                  {([null, 25, 50, 100, 200] as Array<number | null>).map((d) => {
                    const active = distanceMiles === d && resolvedLocation !== null;
                    const label = d === null ? 'Any' : `${d}mi`;
                    const disabled = d !== null && !resolvedLocation;
                    return (
                      <button
                        key={String(d)}
                        type="button"
                        className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                        disabled={disabled}
                        onClick={() => {
                          if (d === null) { setDistanceMiles(null); setGeocodeError(null); return; }
                          if (!resolvedLocation) return;
                          setDistanceMiles(d);
                        }}
                        style={{
                          ...(active ? { fontWeight: 700 } : {}),
                          ...(disabled ? { opacity: 0.5 } : {}),
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Row 3: Taxonomy filters */}
        <div>
          <SiteFilterPanel state={taxonomy} onChange={setTaxonomy} dense />
        </div>

        {isMobile && (
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => setFiltersOpen(false)}
          >
            Show {summarySentence.matchCount} park{summarySentence.matchCount !== 1 ? 's' : ''}
          </button>
        )}
        </>
        )}
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
            availability={availByPark}
          />
        </Suspense>
        {!isMobile && (
          <button
            type="button"
            className="btn btn-sm map-results-toggle"
            onClick={() => setListOpen((o) => !o)}
            aria-expanded={listOpen}
          >
            ☰ {listRows.length} park{listRows.length !== 1 ? 's' : ''}
          </button>
        )}
        <ResultsList
          rows={listRows}
          sort={listSort}
          onSortChange={setListSortChoice}
          hasLocation={resolvedLocation !== null}
          selectedParkId={selectedPark?.parkPageId ?? null}
          onSelectRow={handleSelectRow}
          open={isMobile ? true : listOpen}
          mobile={isMobile}
          detent={detent}
          onCycleDetent={() => setDetent((d) => cycleDetent(d))}
        />
      </div>

      {/* Detail panel — right-side on desktop; rising sheet over a backdrop on mobile */}
      {selectedPark && (
        <>
          {isMobile && <div className="map-detail-backdrop" onClick={() => setSelectedPark(null)} />}
          <DetailPanel
            park={selectedPark}
            onClose={() => setSelectedPark(null)}
            taxonomy={taxonomy}
            minNights={minNights}
            weekendsOnly={weekendsOnly}
            availFrom={availFrom}
            availTo={availTo}
          />
        </>
      )}

      {isMobile && <NavMenu open={navMenuOpen} onClose={() => setNavMenuOpen(false)} />}
    </div>
  );
}

function RowLabel({ children }: { children: string }) {
  return (
    <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Park finder overlay (Task 15)
// ---------------------------------------------------------------------------

function ParkFinder({ parks, onSelect }: { parks: MapPark[]; onSelect: (park: MapPark) => void }) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return parks
      .filter((p) => p.parkName.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, parks]);

  return (
    <div className="park-finder">
      <input
        className="form-input"
        placeholder="Find a park…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: 220, fontSize: 12, padding: '6px 10px' }}
      />
      {matches.length > 0 && (
        <ul className="park-finder-results">
          {matches.map((p) => (
            <li key={p.parkPageId}>
              <button
                type="button"
                onClick={() => { onSelect(p); setQuery(''); }}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'var(--text)', padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}
              >
                {p.parkName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
