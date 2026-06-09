'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapPark } from '../api/map/catalog/route';

// Fix default icon paths broken by webpack
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const BASE = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img';
const SHADOW = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';

function makeIcon(color: string): L.Icon {
  return new L.Icon({
    iconUrl: `${BASE}/marker-icon-2x-${color}.png`,
    shadowUrl: SHADOW,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });
}

const icons = {
  'state-parks': makeIcon('green'),
  'nps':          makeIcon('blue'),
  'usfs':         makeIcon('orange'),
  'other-federal':makeIcon('violet'),
  selected:       makeIcon('gold'),
  unavailable:    makeIcon('grey'),
};

// Legend entries — kept in sync with icons above
const LEGEND = [
  { color: '#2AAD27', label: 'CA State Parks' },
  { color: '#2A81CB', label: 'National Parks (NPS)' },
  { color: '#CB8427', label: 'National Forests (USFS)' },
  { color: '#9C2BCB', label: 'BLM / Army Corps / Other' },
  { color: '#FFD326', label: 'Selected' },
  { color: '#7B7B7B', label: 'No availability (filtered)' },
];

// Initial view: frame the whole state instead of half the western US.
const CA_BOUNDS: L.LatLngBoundsExpression = [[32.3, -124.6], [42.1, -114.0]];

type ParkCategory = 'state-parks' | 'nps' | 'usfs' | 'other-federal';

function getParkCategory(park: MapPark): ParkCategory {
  if (park.provider === 'california-parks') return 'state-parks';
  switch (park.orgName) {
    case 'National Park Service': return 'nps';
    case 'USDA Forest Service':   return 'usfs';
    default:                       return 'other-federal';
  }
}

function FlyTo({ park }: { park: MapPark | null }) {
  const map = useMap();
  const savedView = useRef<{ center: L.LatLng; zoom: number } | null>(null);
  useEffect(() => {
    if (park?.latitude && park?.longitude) {
      // Remember the view from before the first selection so closing the panel returns to it.
      if (!savedView.current) {
        savedView.current = { center: map.getCenter(), zoom: map.getZoom() };
      }
      map.flyTo([park.latitude, park.longitude], 12, { duration: 0.8 });
    } else if (savedView.current) {
      map.flyTo(savedView.current.center, savedView.current.zoom, { duration: 0.8 });
      savedView.current = null;
    }
  }, [map, park]);
  return null;
}

function FocusOnLocation({
  focusLocation,
  distanceMiles,
}: {
  focusLocation: { lat: number; lon: number } | null;
  distanceMiles: number | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!focusLocation) return;
    let zoom = 9;
    if (distanceMiles !== null) {
      if (distanceMiles <= 25) zoom = 10;
      else if (distanceMiles <= 50) zoom = 9;
      else if (distanceMiles <= 100) zoom = 8;
      else zoom = 7;
    }
    map.flyTo([focusLocation.lat, focusLocation.lon], zoom, { duration: 0.8 });
  }, [map, focusLocation, distanceMiles]);
  return null;
}

interface Props {
  parks: MapPark[];
  selectedPark: MapPark | null;
  onSelectPark: (park: MapPark) => void;
  focusLocation?: { lat: number; lon: number } | null;
  distanceMiles?: number | null;
  matchingParkIds?: Set<string> | null;
}

export default function LeafletMap({ parks, selectedPark, onSelectPark, focusLocation, distanceMiles, matchingParkIds }: Props) {
  const withCoords = parks.filter((p) => p.latitude && p.longitude);
  const isFiltered = matchingParkIds !== null;

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer
        bounds={CA_BOUNDS}
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <ZoomControl position="bottomright" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
        <FlyTo park={selectedPark} />
        <FocusOnLocation focusLocation={focusLocation ?? null} distanceMiles={distanceMiles ?? null} />
        {focusLocation && (
          <CircleMarker
            center={[focusLocation.lat, focusLocation.lon]}
            radius={8}
            color="#e74c3c"
            fillColor="#e74c3c"
            fillOpacity={0.8}
          >
            <Popup>Search location</Popup>
          </CircleMarker>
        )}
        {withCoords.map((park) => {
          const isSelected  = selectedPark?.parkPageId === park.parkPageId;
          const isMatching  = !isFiltered || matchingParkIds!.has(park.parkPageId);
          const icon = isSelected
            ? icons.selected
            : isMatching
              ? icons[getParkCategory(park)]
              : icons.unavailable;

          return (
            <Marker
              key={park.parkPageId}
              position={[park.latitude!, park.longitude!]}
              icon={icon}
              title={park.parkName}
              alt={park.parkName}
              eventHandlers={{ click: () => onSelectPark(park) }}
            >
              <Popup>
                <strong>{park.parkName}</strong>
                <br />
                {park.campgroundCount} campground{park.campgroundCount !== 1 ? 's' : ''} · {park.siteCount} sites
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Map legend */}
      <div style={{
        position: 'absolute',
        bottom: 24,
        left: 16,
        zIndex: 1000,
        background: 'rgba(255,255,255,0.85)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '8px 11px',
        pointerEvents: 'none',
        WebkitBackdropFilter: 'blur(6px)',
        backdropFilter: 'blur(6px)',
        boxShadow: 'var(--shadow-sm)',
      }}>
        {LEGEND.map(({ color, label }, i) => {
          // Only show the "no availability" row when a date filter is active
          if (i === LEGEND.length - 1 && !isFiltered) return null;
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: i < LEGEND.length - 1 ? 4 : 0 }}>
              <span style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: color,
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap' }}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
