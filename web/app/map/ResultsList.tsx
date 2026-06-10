'use client';

import { useEffect, useRef } from 'react';
import { GLYPHS } from '../../lib/map-pins';
import { sortParkRows } from '../../lib/park-list';
import type { ParkListRow, ParkListSort } from '../../lib/park-list';
import type { SheetDetent } from '../../lib/sheet-detent';

const SORTS: { key: ParkListSort; label: string }[] = [
  { key: 'sites', label: 'Most sites' },
  { key: 'distance', label: 'Nearest' },
  { key: 'soonest', label: 'Soonest' },
  { key: 'name', label: 'A–Z' },
];

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function RowGlyph({ isFederal, walkUpOnly }: { isFederal: boolean; walkUpOnly: boolean }) {
  return (
    <span className={`map-results-glyph${walkUpOnly ? ' walkup' : ''}`}>
      <svg width="14" height="14" viewBox="3 3 19 17" aria-hidden="true">
        <path d={GLYPHS[isFederal ? 'federal' : 'state']} fill="#fff" />
      </svg>
    </span>
  );
}

export default function ResultsList({
  rows,
  sort,
  onSortChange,
  hasLocation,
  selectedParkId,
  onSelectRow,
  open,
  mobile = false,
  detent = 'peek',
  onCycleDetent,
}: {
  rows: ParkListRow[];
  sort: ParkListSort;
  onSortChange: (s: ParkListSort) => void;
  hasLocation: boolean;
  selectedParkId: string | null;
  onSelectRow: (parkPageId: string) => void;
  open: boolean;
  mobile?: boolean;
  detent?: SheetDetent;
  onCycleDetent?: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll the externally-selected row (pin click) into view.
  useEffect(() => {
    if (!open || !selectedParkId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-park-id="${CSS.escape(selectedParkId)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, selectedParkId]);

  const sorted = sortParkRows(rows, sort);

  const mobileClass = mobile ? ` detent-${detent}` : '';

  return (
    <div className={`map-results-drawer${open ? '' : ' closed'}${mobileClass}`} aria-hidden={!open}>
      {mobile && (
        <div className="map-results-grip" onClick={onCycleDetent} aria-label="Resize list"><span /></div>
      )}
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 7 }}>
          {rows.length} park{rows.length !== 1 ? 's' : ''} with stays
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {SORTS.map(({ key, label }) => {
            const disabled = key === 'distance' && !hasLocation;
            return (
              <button
                key={key}
                type="button"
                className={`btn btn-sm ${sort === key ? 'btn-primary' : 'btn-ghost'}`}
                disabled={disabled}
                title={disabled ? 'Set a location to sort by distance' : undefined}
                onClick={() => onSortChange(key)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="map-results-list" ref={listRef}>
        {sorted.map((r) => {
          const walkUpOnly = r.siteCount === 0 && r.walkUpCount > 0;
          return (
            <button
              key={r.parkPageId}
              type="button"
              data-park-id={r.parkPageId}
              className={`map-results-row${selectedParkId === r.parkPageId ? ' selected' : ''}`}
              onClick={() => onSelectRow(r.parkPageId)}
            >
              <RowGlyph isFederal={r.isFederal} walkUpOnly={walkUpOnly} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.parkName}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {walkUpOnly ? (
                    <span style={{ color: 'var(--walkup)', fontWeight: 600 }}>walk-up only</span>
                  ) : (
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                      {r.siteCount} site{r.siteCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {sort === 'soonest' && r.soonestDate && <> · opens {formatShortDate(r.soonestDate)}</>}
                  {r.distanceMi !== null && <> · {Math.round(r.distanceMi)} mi</>}
                </span>
              </span>
            </button>
          );
        })}
        {sorted.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>
            No parks match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}
