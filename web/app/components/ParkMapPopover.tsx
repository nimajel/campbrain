'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Nominatim geocoder (OpenStreetMap) — free, no API key required
// Rate limit: 1 req/s max. We cache per session to avoid repeat lookups.
// ---------------------------------------------------------------------------

interface GeoResult {
  lat: number;
  lon: number;
  displayName: string;
}

const geocodeCache = new Map<string, GeoResult | null>();

/** Expand common abbreviations so Nominatim can match park names reliably. */
function expandParkName(name: string): string {
  return name
    .replace(/\bSP\b/g, 'State Park')
    .replace(/\bSRA\b/g, 'State Recreation Area')
    .replace(/\bSB\b/g, 'State Beach');
}

async function geocodePark(parkName: string): Promise<GeoResult | null> {
  const cacheKey = parkName.toLowerCase();
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;

  const expanded = expandParkName(parkName);
  const query = encodeURIComponent(`${expanded} California`);
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=us`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'CampBrain/1.0' },
    });
    const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    const result = data[0]
      ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), displayName: data[0].display_name }
      : null;
    geocodeCache.set(cacheKey, result);
    return result;
  } catch {
    geocodeCache.set(cacheKey, null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build the OpenStreetMap embed URL
// Bbox offsets control the zoom level shown in the iframe
// ---------------------------------------------------------------------------

function buildOsmEmbedUrl(lat: number, lon: number, zoomDelta = 0.15): string {
  const d = zoomDelta;
  const params = new URLSearchParams({
    bbox: `${lon - d},${lat - d},${lon + d},${lat + d}`,
    layer: 'mapnik',
    marker: `${lat},${lon}`,
  });
  return `https://www.openstreetmap.org/export/embed.html?${params}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  parkName: string;
  /** Pre-stored coordinates from the catalog — skips the Nominatim call entirely */
  lat?: number;
  lon?: number;
  /** Render the trigger as a custom element; defaults to a styled span */
  children?: React.ReactNode;
}

export default function ParkMapPopover({ parkName, lat, lon, children }: Props) {
  const [open, setOpen] = useState(false);
  // Seed from catalog coords when available — no Nominatim call needed
  const [geo, setGeo] = useState<GeoResult | null | 'loading' | 'error'>(
    lat !== undefined && lon !== undefined
      ? { lat, lon, displayName: parkName }
      : 'loading'
  );
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Fall back to Nominatim geocoding only when catalog coords are missing
  useEffect(() => {
    if (!open || geo !== 'loading') return;
    geocodePark(parkName).then((result) => {
      setGeo(result ?? 'error');
    });
  }, [open, parkName, geo]);

  // Close on click outside
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (
      popoverRef.current &&
      !popoverRef.current.contains(e.target as Node) &&
      triggerRef.current &&
      !triggerRef.current.contains(e.target as Node)
    ) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open, handleOutsideClick]);

  const embedUrl = geo && geo !== 'loading' && geo !== 'error'
    ? buildOsmEmbedUrl(geo.lat, geo.lon)
    : null;

  return (
    <span style={{ position: 'relative', display: 'inline' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="park-map-trigger"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'inherit',
          font: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
        }}
        title={`Show ${parkName} on map`}
      >
        <span style={{
          textDecoration: open ? 'underline' : undefined,
          textDecorationColor: 'var(--muted)',
          textUnderlineOffset: 3,
        }}>
          {children ?? parkName}
        </span>
        {/* Map pin icon — always visible, signals clickability */}
        <svg
          width="12" height="14" viewBox="0 0 12 16" fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="park-map-pin"
          style={{ flexShrink: 0, opacity: open ? 0.9 : 0.35, transition: 'opacity .15s' }}
        >
          <path
            d="M6 0C3.24 0 1 2.24 1 5c0 3.75 5 11 5 11s5-7.25 5-11c0-2.76-2.24-5-5-5zm0 7.5A2.5 2.5 0 1 1 6 2.5 2.5 2.5 0 0 1 6 7.5z"
            fill="currentColor"
          />
        </svg>
      </button>
      <style>{`.park-map-trigger:hover .park-map-pin { opacity: 0.8 !important; }
        .park-map-trigger:hover span { text-decoration: underline; text-decoration-color: var(--muted); text-underline-offset: 3px; }`}
      </style>

      {open && (
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            zIndex: 1000,
            top: (() => {
              const rect = triggerRef.current?.getBoundingClientRect();
              if (!rect) return '50%';
              // Prefer showing below; flip above if not enough space
              const spaceBelow = window.innerHeight - rect.bottom;
              return spaceBelow > 320
                ? `${rect.bottom + 8}px`
                : `${rect.top - 316}px`;
            })(),
            left: (() => {
              const rect = triggerRef.current?.getBoundingClientRect();
              if (!rect) return '50%';
              const left = Math.min(rect.left, window.innerWidth - 330);
              return `${Math.max(8, left)}px`;
            })(),
            width: 320,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,.45)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{parkName}</span>
            <a
              href={geo && geo !== 'loading' && geo !== 'error'
                ? `https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}#map=13/${geo.lat}/${geo.lon}`
                : `https://www.openstreetmap.org/search?query=${encodeURIComponent(parkName + ' California')}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11, color: 'var(--accent)' }}
            >
              Open in OSM ↗
            </a>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', fontSize: 16, padding: '0 2px', lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Map area */}
          <div style={{ width: 320, height: 240, background: 'var(--bg)', position: 'relative' }}>
            {geo === 'loading' && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 12, color: 'var(--muted)',
              }}>
                Locating…
              </div>
            )}
            {geo === 'error' && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 12, color: 'var(--muted)',
              }}>
                Couldn't locate park
              </div>
            )}
            {embedUrl && (
              <iframe
                src={embedUrl}
                title={`Map of ${parkName}`}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                loading="lazy"
              />
            )}
          </div>

          {/* Footer */}
          {geo && geo !== 'loading' && geo !== 'error' && (
            <div style={{
              padding: '6px 12px', fontSize: 10, color: 'var(--muted)',
              borderTop: '1px solid var(--border)',
            }}>
              © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" style={{ color: 'var(--muted)' }}>OpenStreetMap</a> contributors
            </div>
          )}
        </div>
      )}
    </span>
  );
}
