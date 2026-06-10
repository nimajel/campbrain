// Pure pin/legend HTML builders for the /map markers. No React, no Leaflet —
// colors are CSS custom properties that resolve once the HTML is in the DOM.

export type ParkType = 'state' | 'federal';
export type PinAvailability = 'match' | 'none' | 'walk-up';

export interface PinOptions {
  parkType: ParkType;
  availability: PinAvailability;
  count?: number;
  selected?: boolean;
  label?: string;
}

export function getParkType(provider: string): ParkType {
  return provider === 'california-parks' ? 'state' : 'federal';
}

const TEARDROP =
  'M12.5 0C5.6 0 0 5.6 0 12.5 0 21.9 12.5 41 12.5 41s12.5-19.1 12.5-28.5C25 5.6 19.4 0 12.5 0z';

export const GLYPHS: Record<ParkType, string> = {
  state: 'M8 5 h6 v6.2 l4.8 5.6 v2.7 h-5.6 L8.2 11.5 z',
  federal:
    'M12.5 5.2 l2.1 4.3 4.7.7 -3.4 3.3 .8 4.7 -4.2-2.2 -4.2 2.2 .8-4.7 -3.4-3.3 4.7-.7 z',
};

const PIN_FILL: Record<PinAvailability, string> = {
  match: 'var(--accent)',
  'walk-up': 'var(--walkup)',
  none: 'var(--surface-2)',
};

const GLYPH_FILL: Record<PinAvailability, string> = {
  match: '#ffffff',
  'walk-up': '#ffffff',
  none: 'var(--muted)',
};

// Tone-on-tone selection ring: the pin's own fill darkened, so selection reads
// as "this pin, emphasized" without borrowing any availability color.
const RING_STROKE: Record<PinAvailability, string> = {
  match: 'color-mix(in srgb, var(--accent) 60%, black)',
  'walk-up': 'color-mix(in srgb, var(--walkup) 60%, black)',
  none: 'var(--muted)',
};

// Rendered size; viewBox is the 25×41 teardrop padded by 2.5 on every side so the
// selection ring is not clipped, scaled ~1.2× so pins read clearly among 141 parks.
// Tip of the teardrop maps to pixel (18, 52).
export const PIN_W = 36;
export const PIN_H = 55;
export const PIN_ANCHOR: [number, number] = [18, 52];
export const PIN_POPUP_ANCHOR: [number, number] = [0, -44];

export function formatCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function buildPinHtml(opts: PinOptions): string {
  const { parkType, availability, count, selected, label } = opts;

  const stroke = availability === 'none' ? 'var(--muted)' : 'rgba(47,58,46,0.25)';
  const opacity = availability === 'none' ? '0.8' : '1';
  const aria = label ? ` role="img" aria-label="${escapeAttr(label)}"` : '';

  // Drawn after the teardrop so it halos the pin head instead of hiding under it.
  // White casing separates the ring from the fill; the ring color is set via
  // style= because color-mix() needs a CSS context, not an SVG attribute.
  const ring = selected
    ? `<circle cx="12.5" cy="12.5" r="13" fill="none" stroke="#ffffff" stroke-width="4"/>` +
      `<circle cx="12.5" cy="12.5" r="13" fill="none" style="stroke:${RING_STROKE[availability]}" stroke-width="2.5"/>`
    : '';

  const badgeColor = availability === 'walk-up' ? 'var(--walkup)' : 'var(--accent)';
  const badge =
    count && availability !== 'none'
      ? `<span class="cb-badge" style="position:absolute;top:-6px;right:-9px;background:var(--surface);color:${badgeColor};border:1.5px solid ${badgeColor};border-radius:9px;font-size:10px;font-weight:700;line-height:15px;padding:0 5px;white-space:nowrap;">${formatCount(count)}</span>`
      : '';

  return (
    `<div class="cb-pin cb-pin--${availability}"${aria} style="position:relative;width:${PIN_W}px;height:${PIN_H}px;opacity:${opacity};">` +
    `<svg width="${PIN_W}" height="${PIN_H}" viewBox="-2.5 -2.5 30 46" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${TEARDROP}" fill="${PIN_FILL[availability]}" stroke="${stroke}" stroke-width="1"/>` +
    `<path d="${GLYPHS[parkType]}" fill="${GLYPH_FILL[availability]}"/>` +
    ring +
    `</svg>${badge}</div>`
  );
}

export const CLUSTER_SIZE = 44;

// Two-teardrop "stack of pins" glyph — marks the bubble as a group of parks.
const MULTI_PIN =
  '<path d="M8 2C5 2 2.7 4.4 2.7 7.3 2.7 11.3 8 19 8 19s5.3-7.7 5.3-11.7C13.3 4.4 11 2 8 2z"/>' +
  '<path opacity=".55" d="M17 6c-2.2 0-4 1.8-4 4 0 3 4 8.7 4 8.7s4-5.7 4-8.7c0-2.2-1.8-4-4-4z"/>';

/**
 * Donut cluster: body shows total park count, the ring's green arc is the share
 * of those parks with bookable availability (full ring = all, sand ring = none).
 */
export function buildClusterHtml(total: number, matching: number): string {
  const RADIUS = 20;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const none = matching === 0;
  const full = matching >= total;

  let arc = '';
  if (full) {
    arc = `<circle cx="24" cy="24" r="${RADIUS}" fill="none" stroke="var(--accent)" stroke-width="4"/>`;
  } else if (matching > 0) {
    // Floor at 6 units so 1-of-many still shows a visible sliver.
    const len = Math.max((matching / total) * CIRCUMFERENCE, 6);
    arc = `<circle cx="24" cy="24" r="${RADIUS}" fill="none" stroke="var(--accent)" stroke-width="4" stroke-dasharray="${len.toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 24 24)"/>`;
  }

  const ink = none ? 'var(--muted)' : 'var(--text)';
  const glyphInk = none ? 'var(--muted)' : 'var(--accent)';

  return (
    `<div class="cb-cluster${none ? ' cb-cluster--none' : ''}" style="position:relative;width:${CLUSTER_SIZE}px;height:${CLUSTER_SIZE}px;">` +
    `<svg width="${CLUSTER_SIZE}" height="${CLUSTER_SIZE}" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">` +
    `<circle cx="24" cy="24" r="${RADIUS}" fill="var(--surface)"/>` +
    `<circle cx="24" cy="24" r="${RADIUS}" fill="none" stroke="var(--border)" stroke-width="4"/>` +
    arc +
    `</svg>` +
    `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:2px;font-weight:700;font-size:12px;color:${ink};">` +
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="${glyphInk}">${MULTI_PIN}</svg><span>${total}</span></div>` +
    `</div>`
  );
}

export type LegendKind = 'pin-match' | 'pin-walkup' | 'pin-none' | 'glyph-state' | 'glyph-federal';

export interface LegendEntry {
  kind: LegendKind;
  label: string;
  onlyWhenFiltered?: boolean;
}

export const PIN_LEGEND: LegendEntry[] = [
  { kind: 'pin-match', label: 'Sites available' },
  { kind: 'pin-walkup', label: 'Walk-up only' },
  { kind: 'pin-none', label: 'No availability', onlyWhenFiltered: true },
  { kind: 'glyph-state', label: 'CA State Park' },
  { kind: 'glyph-federal', label: 'Federal · Recreation.gov' },
];

export function buildLegendSwatchHtml(kind: LegendKind): string {
  if (kind === 'glyph-state' || kind === 'glyph-federal') {
    const type: ParkType = kind === 'glyph-state' ? 'state' : 'federal';
    return `<svg width="12" height="12" viewBox="4 3 17 17" xmlns="http://www.w3.org/2000/svg"><path d="${GLYPHS[type]}" fill="var(--accent)"/></svg>`;
  }
  const availability: PinAvailability =
    kind === 'pin-match' ? 'match' : kind === 'pin-walkup' ? 'walk-up' : 'none';
  const border = availability === 'none' ? 'var(--muted)' : 'transparent';
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${PIN_FILL[availability]};border:1px solid ${border};"></span>`;
}
