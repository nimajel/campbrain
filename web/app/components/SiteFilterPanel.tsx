'use client';

import { AVAILABLE_FILTERS } from '../../lib/site-filters';

interface Props {
  activeFilters: string[];
  onChange: (activeFilters: string[]) => void;
  /** Subset of filter IDs to show. Defaults to all. */
  include?: string[];
}

export default function SiteFilterPanel({ activeFilters, onChange, include }: Props) {
  const filters = include
    ? AVAILABLE_FILTERS.filter((f) => include.includes(f.id))
    : AVAILABLE_FILTERS;

  function toggle(id: string) {
    if (activeFilters.includes(id)) {
      onChange(activeFilters.filter((f) => f !== id));
    } else {
      onChange([...activeFilters, id]);
    }
  }

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          marginBottom: 8,
        }}
      >
        Filters
        {activeFilters.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            style={{
              marginLeft: 8,
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              fontSize: 11,
              cursor: 'pointer',
              padding: 0,
              textTransform: 'none',
              letterSpacing: 'normal',
            }}
          >
            Clear all
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {filters.map((f) => {
          const active = activeFilters.includes(f.id);
          return (
            <button
              key={f.id}
              type="button"
              title={f.description}
              onClick={() => toggle(f.id)}
              className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 12 }}
            >
              {active ? '✓ ' : ''}{f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
