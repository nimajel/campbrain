'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from 'react-leaflet';
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

const selectedIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const availableIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const greyIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function FlyTo({ park }: { park: MapPark | null }) {
  const map = useMap();
  useEffect(() => {
    if (park?.latitude && park?.longitude) {
      map.flyTo([park.latitude, park.longitude], 12, { duration: 0.8 });
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

  return (
    <MapContainer
      center={[37.5, -119.5]}
      zoom={6}
      style={{ height: '100%', width: '100%', borderRadius: '8px' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
        const isSelected = selectedPark?.parkPageId === park.parkPageId;
        const isMatching = matchingParkIds == null || matchingParkIds.has(park.parkPageId);

        let icon: L.Icon;
        if (isSelected) {
          icon = selectedIcon;
        } else if (isMatching) {
          icon = availableIcon;
        } else {
          icon = greyIcon;
        }

        return (
          <Marker
            key={park.parkPageId}
            position={[park.latitude!, park.longitude!]}
            icon={icon}
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
  );
}
