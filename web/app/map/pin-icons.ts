import L from 'leaflet';
import {
  buildPinHtml,
  PIN_W,
  PIN_H,
  PIN_ANCHOR,
  PIN_POPUP_ANCHOR,
  type PinOptions,
} from '../../lib/map-pins';

const cache = new Map<string, L.DivIcon>();

export function makePinIcon(opts: PinOptions): L.DivIcon {
  const key = `${opts.parkType}|${opts.availability}|${opts.count ?? 0}|${opts.selected ? 1 : 0}|${opts.label ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const icon = L.divIcon({
    html: buildPinHtml(opts),
    className: '', // suppress Leaflet's default .leaflet-div-icon white box
    iconSize: [PIN_W, PIN_H],
    iconAnchor: PIN_ANCHOR,
    popupAnchor: PIN_POPUP_ANCHOR,
  });
  cache.set(key, icon);
  return icon;
}
