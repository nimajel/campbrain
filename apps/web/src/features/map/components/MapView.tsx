import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Tooltip, CircleMarker, Popup, ZoomControl, useMap } from "react-leaflet";
import L from "leaflet";
import type { MapPark } from "@campbrain/core";
import { getParkType, type PinAvailability } from "../lib/map-pins";
import { makePinIcon } from "./pin-icons";
import MapLegend from "./MapLegend";
import MarkerClusterGroup from "./MarkerClusterGroup";
import type { ParkAvailabilitySummary, ResolvedLocation } from "../lib/types";
import "../map.css";

// Vite marker-icon fix: bundle the PNGs and point Leaflet's default icon at them.
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

// Fixed California center + zoom. Using center/zoom (size-independent) instead of the
// legacy `bounds={CA_BOUNDS}` fit avoids the world-zoom glitch when MapView mounts lazily
// (React.lazy/Suspense) and the container has no measured height yet — fitBounds needs
// pixel dimensions to compute a zoom, setView does not.
const CA_CENTER: L.LatLngExpression = [37.2, -119.3];
const CA_ZOOM = 6;

// MapView mounts lazily (React.lazy/Suspense), so the map can initialize before the
// container reaches its final height — leaving Leaflet with a stale, too-small size that
// only paints tiles for part of the viewport. Observe the container and invalidateSize on
// any resize (initial grow + window resizes) so the tile grid always fills the container.
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const invalidate = () => map.invalidateSize();
    const observer = new ResizeObserver(invalidate);
    observer.observe(container);
    // Lazy/Suspense mount: the container may not have its final size when Leaflet first
    // measures it, leaving the tile grid only partly painted. Re-measure after the browser
    // has laid out (next frame + a short fallback delay).
    const raf = requestAnimationFrame(invalidate);
    const timer = setTimeout(invalidate, 250);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [map]);
  return null;
}

function FlyTo({ park }: { park: MapPark | null }) {
  const map = useMap();
  const savedView = useRef<{ center: L.LatLng; zoom: number } | null>(null);
  useEffect(() => {
    if (park?.latitude && park?.longitude) {
      if (!savedView.current) savedView.current = { center: map.getCenter(), zoom: map.getZoom() };
      map.flyTo([park.latitude, park.longitude], 12, { duration: 0.8 });
    } else if (savedView.current) {
      map.flyTo(savedView.current.center, savedView.current.zoom, { duration: 0.8 });
      savedView.current = null;
    }
  }, [map, park]);
  return null;
}

function FocusOnLocation({ focusLocation, distanceMiles }: { focusLocation: ResolvedLocation | null; distanceMiles: number | null }) {
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
  focusLocation?: ResolvedLocation | null;
  distanceMiles?: number | null;
  availability?: Map<string, ParkAvailabilitySummary> | null;
}

export default function MapView({ parks, selectedPark, onSelectPark, focusLocation, distanceMiles, availability = null }: Props) {
  const withCoords = parks.filter((p) => p.latitude && p.longitude);

  // markercluster doesn't recompute cluster icons when child icons change → remount on availability change.
  const clusterVersion = useRef(0);
  const clusterKey = useMemo(() => String(++clusterVersion.current), [availability]);

  return (
    <div className="cb-map-root relative h-full w-full">
      <MapContainer center={CA_CENTER} zoom={CA_ZOOM} zoomControl={false} style={{ height: "100%", width: "100%" }}>
        <ZoomControl position="bottomright" />
        <InvalidateOnResize />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
        <FlyTo park={selectedPark} />
        <FocusOnLocation focusLocation={focusLocation ?? null} distanceMiles={distanceMiles ?? null} />
        {focusLocation && (
          <CircleMarker center={[focusLocation.lat, focusLocation.lon]} radius={8} color="#b3402f" fillColor="#b3402f" fillOpacity={0.8}>
            <Popup>Search location</Popup>
          </CircleMarker>
        )}
        <MarkerClusterGroup key={clusterKey}>
          {withCoords.map((park) => {
            const isSelected = selectedPark?.parkPageId === park.parkPageId;
            const summary = availability?.get(park.parkPageId);
            const state: PinAvailability = !availability
              ? "match"
              : (summary?.siteCount ?? 0) > 0
                ? "match"
                : (summary?.walkUpCount ?? 0) > 0
                  ? "walk-up"
                  : "none";
            const count = !availability
              ? undefined
              : state === "match"
                ? summary?.siteCount
                : state === "walk-up"
                  ? summary?.walkUpCount
                  : undefined;
            const parkType = getParkType(park.provider);
            return (
              <Marker
                key={park.parkPageId}
                position={[park.latitude!, park.longitude!]}
                icon={makePinIcon({ parkType, availability: state, count, selected: isSelected, label: park.parkName })}
                eventHandlers={{ click: () => onSelectPark(park) }}
              >
                <Tooltip direction="top" offset={[0, -50]}>
                  <strong>{park.parkName}</strong>
                  <br />
                  {parkType === "state" ? "CA State Park" : "Federal · Recreation.gov"}
                  {availability && state === "match" ? ` · ${count} site${count === 1 ? "" : "s"} open` : ""}
                  {availability && state === "walk-up" ? " · walk-up only" : ""}
                  {availability && state === "none" ? " · no availability" : ""}
                </Tooltip>
              </Marker>
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>
      <MapLegend dateFilterActive={availability != null} />
    </div>
  );
}
