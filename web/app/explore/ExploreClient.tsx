'use client';

import { useState, useMemo } from 'react';
import type { ParkCatalogEntry } from '../../lib/catalog';
import type { ExploreResponse, ExploreResult } from '../api/explore/route';
import SiteFilterPanel from '../components/SiteFilterPanel';
import ParkMapPopover from '../components/ParkMapPopover';
import { passesSiteFilters, campgroundPassesFilters } from '../../lib/site-filters';
import { injectBookingDates } from '../../lib/booking-url';

function upcomingWeekends(count = 6): { label: string; arrivalDate: string }[] {
  const weekends: { label: string; arrivalDate: string }[] = [];
  const today = new Date();
  let d = new Date(today);
  d.setDate(d.getDate() + 1);

  while (weekends.length < count) {
    const dow = d.getDay();
    if (dow === 5 || dow === 6) {
      const iso = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      weekends.push({ label: `${dow === 5 ? 'Fri' : 'Sat'} ${label}`, arrivalDate: iso });
    }
    d = new Date(d);
    d.setDate(d.getDate() + 1);
  }
  return weekends;
}

function groupResultsByPark(results: ExploreResult[]): Map<string, ExploreResult[]> {
  const map = new Map<string, ExploreResult[]>();
  for (const r of results) {
    const key = `${r.parkPageId}::${r.parkName}`;
    const existing = map.get(key) ?? [];
    existing.push(r);
    map.set(key, existing);
  }
  return map;
}

function ParkResults({
  parkName,
  results,
  activeFilters,
  lat,
  lon,
}: {
  parkName: string;
  results: ExploreResult[];
  activeFilters: string[];
  lat?: number;
  lon?: number;
}) {
  const noData = results.length === 1 && results[0]?.noSiteData;

  // Apply filters to each campground's available sites
  const filteredResults = results
    .filter((r) => r.noSiteData || campgroundPassesFilters(r.campgroundName, activeFilters))
    .map((r) => ({
      ...r,
      availableSites: r.availableSites.filter((site) =>
        passesSiteFilters(site, r.campgroundName, activeFilters)
      ),
    }));

  const totalAvailable = filteredResults.reduce((n, r) => n + r.availableSites.length, 0);
  const hasError = filteredResults.some((r) => r.error);
  const allFiltered =
    !noData && filteredResults.length === 0 && results.length > 0;

  if (allFiltered) return null;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: noData ? 0 : 12 }}>
        <h3 style={{ margin: 0, flex: 1 }}>
          <ParkMapPopover parkName={parkName} lat={lat} lon={lon} />
        </h3>
        {noData ? (
          <span className="badge badge-gray">No site data</span>
        ) : totalAvailable > 0 ? (
          <span className="badge badge-green">{totalAvailable} available</span>
        ) : hasError ? (
          <span className="badge badge-red">Error</span>
        ) : (
          <span className="badge badge-gray">No availability</span>
        )}
      </div>

      {noData && (
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>
          This park doesn&apos;t have site data in the catalog yet. Run a catalog refresh to populate it.
        </p>
      )}

      {!noData &&
        filteredResults.map((r, i) => (
          <div
            key={i}
            style={{
              padding: '10px 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{r.campgroundName}</span>
              {r.availableSites.length > 0 && (
                <span className="badge badge-match">{r.availableSites.length} open</span>
              )}
              {r.error && <span className="badge badge-red">scan error</span>}
              {/* Fee + Book pushed to the right */}
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                {r.nightlyFee !== undefined && (
                  <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    ${r.nightlyFee}/night · <strong style={{ color: 'var(--text)' }}>${r.nightlyFee * r.nights} total</strong>
                  </span>
                )}
                {r.bookingUrl && r.availableSites.length > 0 && (
                  <a
                    href={injectBookingDates(r.bookingUrl, r.arrivalDate, r.nights)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-sm btn-success"
                    style={{ fontSize: 11 }}
                  >
                    Book ↗
                  </a>
                )}
              </span>
            </div>

            {r.availableSites.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                {r.availableSites.map((site) => (
                  <span key={site} className="chip chip-green" style={{ fontSize: 11 }}>
                    {site}
                  </span>
                ))}
              </div>
            )}

            {r.sourceUrl && !r.bookingUrl && (
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--accent)' }}
                >
                  {r.provider === 'recreation-gov' ? 'View on Recreation.gov ↗' : 'View on ReserveCalifornia ↗'}
                </a>
              </div>
            )}

            {r.error && (
              <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{r.error}</div>
            )}
          </div>
        ))}
    </div>
  );
}

export default function ExploreClient({ parks }: { parks: ParkCatalogEntry[] }) {
  const [arrivalDate, setArrivalDate] = useState('');
  const [nights, setNights] = useState(2);
  const [people, setPeople] = useState(2);
  const [selectedParkIds, setSelectedParkIds] = useState<Set<string>>(new Set());
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ExploreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const weekends = useMemo(() => upcomingWeekends(6), []);

  const parksWithData = parks.filter((p) =>
    p.campgrounds.some((c) => c.sites.length > 0)
  );
  const parksWithoutData = parks.filter((p) =>
    !p.campgrounds.some((c) => c.sites.length > 0)
  );

  function togglePark(pageId: string) {
    setSelectedParkIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }

  async function handleSearch() {
    if (!arrivalDate || !nights || selectedParkIds.size === 0) return;
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch('/api/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arrivalDate,
          nights,
          people,
          parkPageIds: Array.from(selectedParkIds),
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as ExploreResponse;
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const grouped = response ? groupResultsByPark(response.results) : null;

  // Filtered totals for the results header
  const filteredTotal = useMemo(() => {
    if (!response) return 0;
    return response.results.reduce((sum, r) => {
      if (r.noSiteData || !campgroundPassesFilters(r.campgroundName, activeFilters)) return sum;
      const kept = r.availableSites.filter((site) =>
        passesSiteFilters(site, r.campgroundName, activeFilters)
      );
      return sum + kept.length;
    }, 0);
  }, [response, activeFilters]);

  const canSearch = arrivalDate && nights > 0 && selectedParkIds.size > 0 && !loading;

  return (
    <div>
      {/* Search form */}
      <div className="card" style={{ marginBottom: 24 }}>
        {/* Date / nights / people row */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <label style={{ flex: '1 1 160px' }}>
            Arrival date
            <input
              type="date"
              value={arrivalDate}
              onChange={(e) => setArrivalDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
          </label>

          <label style={{ flex: '0 0 100px' }}>
            Nights
            <input
              type="number"
              value={nights}
              min={1}
              max={14}
              onChange={(e) => setNights(Math.max(1, Math.min(14, Number(e.target.value))))}
            />
          </label>

          <label style={{ flex: '0 0 100px' }}>
            People
            <input
              type="number"
              value={people}
              min={1}
              max={99}
              onChange={(e) => setPeople(Math.max(1, Math.min(99, Number(e.target.value))))}
            />
          </label>
        </div>

        {/* Quick weekend picker */}
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
            Upcoming weekends
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {weekends.map((w) => (
              <button
                key={w.arrivalDate}
                className={`btn btn-sm ${arrivalDate === w.arrivalDate ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setArrivalDate(w.arrivalDate)}
                type="button"
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div style={{ marginBottom: 16 }}>
          <SiteFilterPanel activeFilters={activeFilters} onChange={setActiveFilters} />
        </div>

        {/* Park selector */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div
              style={{
                fontSize: 11,
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '.06em',
                flex: 1,
              }}
            >
              Parks ({selectedParkIds.size} selected)
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSelectedParkIds(new Set(parksWithData.map((p) => p.parkPageId)))}
              type="button"
            >
              All
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSelectedParkIds(new Set())}
              type="button"
            >
              None
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 6,
            }}
          >
            {parksWithData.map((park) => (
              <label
                key={park.parkPageId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selectedParkIds.has(park.parkPageId)
                    ? 'rgba(79,142,247,.08)'
                    : 'transparent',
                  fontSize: 13,
                  color: 'var(--text)',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedParkIds.has(park.parkPageId)}
                  onChange={() => togglePark(park.parkPageId)}
                />
                <span style={{ flex: 1, lineHeight: 1.3 }}>{park.parkName}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {park.campgrounds.reduce((n, c) => n + c.sites.length, 0)} sites
                </span>
              </label>
            ))}

            {parksWithoutData.map((park) => (
              <label
                key={park.parkPageId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  cursor: 'not-allowed',
                  opacity: 0.45,
                  fontSize: 13,
                  color: 'var(--muted)',
                }}
              >
                <input type="checkbox" disabled />
                <span style={{ flex: 1, lineHeight: 1.3 }}>{park.parkName}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>no data</span>
              </label>
            ))}
          </div>
        </div>

        <button
          className="btn btn-primary"
          disabled={!canSearch}
          onClick={handleSearch}
          type="button"
        >
          {loading ? 'Scanning…' : 'Search availability'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="card scan-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Results */}
      {response && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <h2 style={{ margin: 0, flex: 1 }}>
              Results for {arrivalDate} · {nights}N · {people}p
            </h2>
            {filteredTotal > 0 ? (
              <span className="badge badge-green">{filteredTotal} sites available</span>
            ) : (
              <span className="badge badge-gray">No availability found</span>
            )}
          </div>

          {activeFilters.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <SiteFilterPanel activeFilters={activeFilters} onChange={setActiveFilters} />
            </div>
          )}

          {grouped &&
            Array.from(grouped.entries()).map(([key, results]) => {
              const parkPageId = key.split('::')[0]!;
              const parkName = key.split('::').slice(1).join('::');
              const parkMeta = parks.find((p) => p.parkPageId === parkPageId);
              return (
                <ParkResults
                  key={key}
                  parkName={parkName}
                  results={results}
                  activeFilters={activeFilters}
                  lat={parkMeta?.lat}
                  lon={parkMeta?.lon}
                />
              );
            })}

          {response.skippedParks.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
              Scan limit reached — {response.skippedParks.length} park(s) not fully scanned:{' '}
              {response.skippedParks.map((p) => p.parkName).join(', ')}
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            Scanned at {new Date(response.scannedAt).toLocaleTimeString()}
          </div>
        </>
      )}
    </div>
  );
}
