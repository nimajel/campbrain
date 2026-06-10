'use client';

import { useState } from 'react';
import { PIN_LEGEND, buildLegendSwatchHtml } from '../../lib/map-pins';

export default function MapLegend({ dateFilterActive }: { dateFilterActive: boolean }) {
  const [open, setOpen] = useState(false);
  const entries = PIN_LEGEND.filter((e) => !e.onlyWhenFiltered || dateFilterActive);

  return (
    <div
      style={{ position: 'absolute', bottom: 24, left: 16, zIndex: 1000 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {open ? (
        <div
          style={{
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '8px 11px',
            WebkitBackdropFilter: 'blur(6px)',
            backdropFilter: 'blur(6px)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {entries.map((entry) => (
            <div
              key={entry.kind}
              style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}
            >
              <span
                style={{ display: 'inline-flex', flexShrink: 0 }}
                dangerouslySetInnerHTML={{ __html: buildLegendSwatchHtml(entry.kind) }}
              />
              <span style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap' }}>{entry.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: '4px 12px',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text)',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
            fontFamily: 'var(--font)',
          }}
        >
          ☰ Key
        </button>
      )}
    </div>
  );
}
