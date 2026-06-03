'use client';

import { useState, useEffect, useCallback } from 'react';
import dayjs from 'dayjs';
import SiteFilterPanel from '../components/SiteFilterPanel';
import { injectBookingDates } from '../../lib/booking-url';
import { ALL_REGIONS, REGION_LABELS } from '../../lib/regions';
import type { CampRegion } from '../../lib/regions';
import type { SearchApiResponse, SearchParkResponse } from '../api/search/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function minCheckOut(checkIn: string): string {
  return checkIn ? dayjs(checkIn).add(1, 'day').format('YYYY-MM-DD') : todayIso();
}

// ---------------------------------------------------------------------------
// ParkCard
// ---------------------------------------------------------------------------

function ParkCard({
  park,
  checkIn,
  nights,
  showWalkUp,
}: {
  park: SearchParkResponse;
  checkIn: string;
  nights: number;
  showWalkUp: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasBookable = park.totalAvailable > 0;

  return (
    <div className="card" style={{ marginBottom: 8, padding: open ? undefined : '8px 16px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          marginBottom: open ? 6 : 0,
        }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen((v) => !v);
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            transition: 'transform .15s',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            display: 'inline-block',
            flexShrink: 0,
          }}
        >
          ▶
        </span>
        <h3 style={{ margin: 0, flex: 1, fontSize: 14, fontWeight: hasBookable ? 600 : 400 }}>
          {park.parkName}
        </h3>
        <span className="badge badge-gray" style={{ fontSize: 10 }}>
          {REGION_LABELS[park.region]}
        </span>
        {hasBookable ? (
          <span className="badge badge-green">
            {park.totalAvailable} site{park.totalAvailable !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="badge badge-gray" style={{ opacity: 0.6 }}>
            walk-up only
          </span>
        )}
      </div>

      {open &&
        park.campgrounds.map((cg) => {
          const hasAvail = cg.availableSites.length > 0;
          const hasWalkUp = showWalkUp && cg.walkUpSites.length > 0;
          if (!hasAvail && !hasWalkUp) return null;

          return (
            <div
              key={cg.name}
              style={{ padding: '7px 0', borderTop: '1px solid var(--border)' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
                  {cg.name}
                </span>
                {cg.nightlyFee !== null && (
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--muted)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ${cg.nightlyFee}/night &middot;{' '}
                    <strong style={{ color: 'var(--text)' }}>
                      ${cg.nightlyFee * nights} total
                    </strong>
                  </span>
                )}
                {cg.bookingUrl && hasAvail && (
                  <a
                    href={injectBookingDates(cg.bookingUrl, checkIn, nights)}
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
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap',
                    marginTop: 5,
                  }}
                >
                  {cg.availableSites.map((site) => (
                    <span
                      key={site}
                      className="chip chip-green"
                      style={{ fontSize: 11 }}
                    >
                      {site}
                    </span>
                  ))}
                </div>
              )}

              {hasWalkUp && (
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap',
                    marginTop: 4,
                    alignItems: 'center',
                  }}
                >
                  <span className="badge badge-gray" style={{ fontSize: 9 }}>
                    walk-up
                  </span>
                  {cg.walkUpSites.map((site) => (
                    <span
                      key={site}
                      className="chip"
                      style={{ fontSize: 11, opacity: 0.6 }}
                    >
                      {site}
                    </span>
                  ))}
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--muted)',
                      fontStyle: 'italic',
                    }}
                  >
                    first-come, not reservable
                  </span>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function FindCampsitesClient() {
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<CampRegion | null>(null);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [data, setData] = useState<SearchApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nights = checkIn && checkOut ? dayjs(checkOut).diff(dayjs(checkIn), 'day') : 0;
  const showWalkUp = !activeFilters.includes('exclude_walk_up');

  // Clear stale results when dates become invalid
  useEffect(() => {
    if (!checkIn || !checkOut || checkIn >= checkOut) setData(null);
  }, [checkIn, checkOut]);

  const runSearch = useCallback(async () => {
    if (!checkIn || !checkOut || checkIn >= checkOut) return;

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ from: checkIn, to: checkOut });
    if (selectedRegion) params.set('region', selectedRegion);
    // exclude_walk_up is display-only; other filters go to the server
    const serverFilters = activeFilters.filter((f) => f !== 'exclude_walk_up');
    if (serverFilters.length > 0) params.set('filters', serverFilters.join(','));

    try {
      const res = await fetch(`/api/search?${params.toString()}`);
      const json = (await res.json()) as SearchApiResponse | { error: string };
      if (!res.ok) {
        setError('error' in json ? json.error : `HTTP ${res.status}`);
        setData(null);
      } else {
        setData(json as SearchApiResponse);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [checkIn, checkOut, selectedRegion, activeFilters]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  const bookableParks = data?.parks.filter((p) => p.totalAvailable > 0) ?? [];
  const walkUpOnlyParks = data?.parks.filter((p) => p.totalAvailable === 0) ?? [];
  const totalAvailable = bookableParks.reduce((n, p) => n + p.totalAvailable, 0);

  return (
    <div>
      {/* Search form */}
      <div className="card" style={{ marginBottom: 20 }}>
        {/* Dates row */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            marginBottom: 16,
          }}
        >
          <label style={{ flex: '0 0 150px' }}>
            Check-in
            <input
              type="date"
              value={checkIn}
              min={todayIso()}
              onChange={(e) => {
                setCheckIn(e.target.value);
                // clear check-out if it would be on or before new check-in
                if (checkOut && e.target.value >= checkOut) setCheckOut('');
              }}
            />
          </label>
          <label style={{ flex: '0 0 150px' }}>
            Check-out
            <input
              type="date"
              value={checkOut}
              min={minCheckOut(checkIn)}
              onChange={(e) => setCheckOut(e.target.value)}
            />
          </label>
          {nights > 0 && (
            <span
              style={{
                fontSize: 13,
                color: 'var(--muted)',
                alignSelf: 'flex-end',
                paddingBottom: 6,
              }}
            >
              {nights} night{nights !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Region chips */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              marginBottom: 8,
            }}
          >
            Region
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${selectedRegion === null ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setSelectedRegion(null)}
            >
              All
            </button>
            {ALL_REGIONS.map((region) => (
              <button
                key={region}
                type="button"
                className={`btn btn-sm ${selectedRegion === region ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() =>
                  setSelectedRegion((prev) => (prev === region ? null : region))
                }
              >
                {selectedRegion === region ? `✓ ${REGION_LABELS[region]}` : REGION_LABELS[region]}
              </button>
            ))}
          </div>
        </div>

        {/* Site filters */}
        <SiteFilterPanel activeFilters={activeFilters} onChange={setActiveFilters} />
      </div>

      {/* Empty states — guarded by !loading to avoid overlap with spinner */}
      {!loading && !checkIn && !checkOut && (
        <div className="empty">
          <p>Pick a check-in and check-out date to see available campsites.</p>
        </div>
      )}

      {!loading && checkIn && !checkOut && (
        <div className="empty">
          <p>Now pick a check-out date.</p>
        </div>
      )}

      {loading && (
        <div className="empty">
          <p>Searching&hellip;</p>
        </div>
      )}

      {error && !loading && (
        <div className="card" style={{ color: 'var(--red)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Results */}
      {!loading && data && (
        <>
          {/* Bookable parks */}
          {bookableParks.length > 0 && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: 16,
                }}
              >
                <h2 style={{ margin: 0, flex: 1 }}>
                  {bookableParks.length} park{bookableParks.length !== 1 ? 's' : ''}
                </h2>
                <span className="badge badge-green">
                  {totalAvailable} site{totalAvailable !== 1 ? 's' : ''} available
                </span>
              </div>
              {bookableParks.map((park) => (
                <ParkCard
                  key={park.parkPageId}
                  park={park}
                  checkIn={checkIn}
                  nights={nights}
                  showWalkUp={showWalkUp}
                />
              ))}
            </>
          )}

          {/* Walk-up-only parks (no bookable sites) */}
          {showWalkUp && walkUpOnlyParks.map((park) => (
            <ParkCard
              key={park.parkPageId}
              park={park}
              checkIn={checkIn}
              nights={nights}
              showWalkUp={showWalkUp}
            />
          ))}

          {/* Fallback panel — shown when no bookable sites found */}
          {data.fallback && (
            <div className="empty" style={{ textAlign: 'left' }}>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>
                {walkUpOnlyParks.length > 0
                  ? 'No reservable campsites — walk-up sites shown above.'
                  : 'No availability for those dates.'}
              </p>

              {activeFilters.length > 0 && (
                <p style={{ fontSize: 13, marginBottom: 12 }}>
                  Try removing some site filters — they may be hiding available sites.
                </p>
              )}

              {data.fallback.alternateDates.length > 0 && (
                <div>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
                    Next bookable openings in{' '}
                    {selectedRegion ? REGION_LABELS[selectedRegion] : 'all regions'}:
                  </p>
                  {data.fallback.alternateDates.map((p) => (
                    <div key={p.parkPageId} style={{ fontSize: 13, marginBottom: 4 }}>
                      <strong>{p.parkName}</strong>{' '}
                      <span style={{ color: 'var(--muted)' }}>
                        &mdash; openings from{' '}
                        {new Date(p.earliestDate + 'T12:00:00').toLocaleDateString(
                          'en-US',
                          { month: 'short', day: 'numeric' }
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {data.fallback.alternateDates.length === 0 && (
                <p style={{ fontSize: 13 }}>
                  No bookable availability found in the next 60 days for this region.
                  Try expanding your region or date range.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
