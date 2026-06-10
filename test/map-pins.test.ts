import { describe, it, expect } from 'vitest';
import {
  buildPinHtml,
  buildClusterHtml,
  buildLegendSwatchHtml,
  formatCount,
  getParkType,
  GLYPHS,
  PIN_LEGEND,
} from '../web/lib/map-pins.js';

describe('getParkType', () => {
  it('maps california-parks to state', () => {
    expect(getParkType('california-parks')).toBe('state');
  });
  it('maps every other provider to federal', () => {
    expect(getParkType('recreation-gov')).toBe('federal');
    expect(getParkType('anything-else')).toBe('federal');
  });
});

describe('formatCount', () => {
  it('passes small counts through', () => {
    expect(formatCount(12)).toBe('12');
  });
  it('caps at 99+', () => {
    expect(formatCount(100)).toBe('99+');
    expect(formatCount(99)).toBe('99');
  });
});

describe('buildPinHtml', () => {
  it('uses the CA outline glyph for state parks', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'match' });
    expect(html).toContain(GLYPHS.state);
    expect(html).not.toContain(GLYPHS.federal);
  });

  it('uses the star glyph for federal parks', () => {
    const html = buildPinHtml({ parkType: 'federal', availability: 'match' });
    expect(html).toContain(GLYPHS.federal);
    expect(html).not.toContain(GLYPHS.state);
  });

  it('fills match pins with the accent token and a white glyph', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'match' });
    expect(html).toContain('fill="var(--accent)"');
    expect(html).toContain('fill="#ffffff"');
  });

  it('fills walk-up pins with the amber walkup token', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'walk-up' });
    expect(html).toContain('fill="var(--walkup)"');
  });

  it('renders no-match pins hollow with a muted glyph', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'none' });
    expect(html).toContain('fill="var(--surface-2)"');
    expect(html).toContain('fill="var(--muted)"');
    expect(html).toContain('opacity:0.8');
  });

  it('shows a count badge on match pins', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'match', count: 12 });
    expect(html).toContain('cb-badge');
    expect(html).toContain('>12<');
  });

  it('shows an amber badge on walk-up pins', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'walk-up', count: 3 });
    expect(html).toContain('cb-badge');
    expect(html).toContain('border:1.5px solid var(--walkup)');
  });

  it('hides the badge on no-match pins even when a count is passed', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'none', count: 5 });
    expect(html).not.toContain('cb-badge');
  });

  it('hides the badge when count is 0 or undefined', () => {
    expect(buildPinHtml({ parkType: 'state', availability: 'match', count: 0 })).not.toContain('cb-badge');
    expect(buildPinHtml({ parkType: 'state', availability: 'match' })).not.toContain('cb-badge');
  });

  it('caps the badge display at 99+', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'match', count: 150 });
    expect(html).toContain('>99+<');
  });

  it('draws the selection ring only when selected', () => {
    const selected = buildPinHtml({ parkType: 'state', availability: 'match', selected: true });
    const normal = buildPinHtml({ parkType: 'state', availability: 'match' });
    expect(selected).toContain('<circle');
    expect(normal).not.toContain('<circle');
  });

  it('rings are tone-on-tone: darkened self per fill', () => {
    expect(buildPinHtml({ parkType: 'state', availability: 'match', selected: true }))
      .toContain('stroke:color-mix(in srgb, var(--accent) 60%, black)');
    expect(buildPinHtml({ parkType: 'state', availability: 'walk-up', selected: true }))
      .toContain('stroke:color-mix(in srgb, var(--walkup) 60%, black)');
    expect(buildPinHtml({ parkType: 'state', availability: 'none', selected: true }))
      .toContain('stroke:var(--muted)');
  });

  it('sets role and an escaped aria-label from label', () => {
    const html = buildPinHtml({ parkType: 'state', availability: 'match', label: 'Tomales "Bay" SP' });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Tomales &quot;Bay&quot; SP"');
  });
});

describe('buildClusterHtml', () => {
  it('shows the total park count with the multi-pin glyph', () => {
    const html = buildClusterHtml(17, 3);
    expect(html).toContain('>17<');
    expect(html).toContain('M8 2C5 2');
  });
  it('draws a partial green arc for mixed availability', () => {
    const html = buildClusterHtml(8, 1);
    expect(html).toContain('stroke-dasharray');
    expect(html).toContain('stroke="var(--accent)"');
  });
  it('draws a full green ring when every park matches', () => {
    const html = buildClusterHtml(8, 8);
    expect(html).toContain('stroke="var(--accent)"');
    expect(html).not.toContain('stroke-dasharray');
  });
  it('draws no green arc and mutes the body when nothing matches', () => {
    const html = buildClusterHtml(8, 0);
    expect(html).not.toContain('var(--accent)');
    expect(html).toContain('cb-cluster--none');
    expect(html).toContain('var(--muted)');
  });
  it('keeps a visible sliver for 1-of-many', () => {
    const html = buildClusterHtml(40, 1);
    const dash = html.match(/stroke-dasharray="([\d.]+) /);
    expect(Number(dash?.[1])).toBeGreaterThanOrEqual(6);
  });
});

describe('PIN_LEGEND', () => {
  it('has exactly the five spec entries in order', () => {
    expect(PIN_LEGEND.map((e) => e.label)).toEqual([
      'Sites available',
      'Walk-up only',
      'No availability',
      'CA State Park',
      'Federal · Recreation.gov',
    ]);
  });
  it('marks only the no-availability row as filter-conditional', () => {
    expect(PIN_LEGEND.filter((e) => e.onlyWhenFiltered).map((e) => e.label)).toEqual(['No availability']);
  });
  it('builds a swatch for every legend kind', () => {
    for (const entry of PIN_LEGEND) {
      expect(buildLegendSwatchHtml(entry.kind)).toContain('<');
    }
  });
  it('uses the real glyph paths in the type swatches', () => {
    expect(buildLegendSwatchHtml('glyph-state')).toContain(GLYPHS.state);
    expect(buildLegendSwatchHtml('glyph-federal')).toContain(GLYPHS.federal);
  });
});
