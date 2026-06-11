'use client';

import { useState, useEffect } from 'react';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import StatusDot from '../../components/ui/StatusDot';
import EmptyState from '../../components/ui/EmptyState';
import SaveSearchModal from '../../components/SaveSearchModal';
import { scopeSummary, datePatternSummary, buildRunUrl } from '../../lib/saved-search-display';
import type { SavedSearch } from '../../../src/saved-search/types.js';

// ---------------------------------------------------------------------------
// Filter chips for a saved search
// ---------------------------------------------------------------------------

function FilterChips({ filters }: { filters: SavedSearch['filters'] }) {
  const chips: string[] = [];
  if (filters.access.length) chips.push(filters.access.join(', ').replace(/_/g, '-'));
  if (filters.kinds.length) chips.push(filters.kinds.join(', '));
  if (filters.hide.length) chips.push(`hide: ${filters.hide.join(', ').replace(/_/g, '-')}`);
  if (filters.minNights > 1) chips.push(`${filters.minNights}+ nights`);
  if (chips.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
      {chips.map((c) => (
        <span key={c} className="chip" style={{ fontSize: 11 }}>
          {c}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single saved-search card
// ---------------------------------------------------------------------------

function SearchCard({
  search,
  onEdit,
  onDeleted,
  onAlertToggled,
}: {
  search: SavedSearch;
  onEdit: (s: SavedSearch) => void;
  onDeleted: (id: string) => void;
  onAlertToggled: (updated: SavedSearch) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [togglingAlert, setTogglingAlert] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${search.name}"?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/saved-searches/${encodeURIComponent(search.id)}`, { method: 'DELETE' });
      onDeleted(search.id);
    } catch {
      setDeleting(false);
    }
  }

  async function handleAlertToggle() {
    setTogglingAlert(true);
    try {
      const res = await fetch(`/api/saved-searches/${encodeURIComponent(search.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertEnabled: !search.alertEnabled }),
      });
      if (res.ok) {
        const json = (await res.json()) as { savedSearch: SavedSearch };
        onAlertToggled(json.savedSearch);
      }
    } finally {
      setTogglingAlert(false);
    }
  }

  const runUrl = buildRunUrl(search);

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {/* Alert indicator */}
        <div style={{ paddingTop: 3, flexShrink: 0 }}>
          <StatusDot tone={search.alertEnabled ? 'green' : 'gray'} />
        </div>

        {/* Body */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>{search.name}</span>
            <Badge tone="gray">{scopeSummary(search.scope)}</Badge>
          </div>

          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
            {datePatternSummary(search.datePattern)}
          </div>

          <FilterChips filters={search.filters} />
        </div>
      </div>

      {/* Actions */}
      <div className="card-actions">
        <a href={runUrl} className="btn btn-sm btn-primary" style={{ textDecoration: 'none' }}>
          Run
        </a>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => onEdit(search)}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => void handleAlertToggle()}
          disabled={togglingAlert}
          title={search.alertEnabled ? 'Turn off email alert' : 'Turn on email alert'}
        >
          {search.alertEnabled ? 'Alert on' : 'Alert off'}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          style={{ color: 'var(--red)', marginLeft: 'auto' }}
          onClick={() => void handleDelete()}
          disabled={deleting}
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------

export default function SavedSearchesClient() {
  const [searches, setSearches] = useState<SavedSearch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedSearch | null>(null);

  useEffect(() => {
    fetch('/api/saved-searches')
      .then((r) => r.json() as Promise<{ savedSearches: SavedSearch[] } | { error: string }>)
      .then((json) => {
        if ('error' in json) {
          setLoadError(json.error);
        } else {
          setSearches(json.savedSearches);
        }
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
      });
  }, []);

  function handleDeleted(id: string) {
    setSearches((prev) => prev?.filter((s) => s.id !== id) ?? null);
  }

  function handleAlertToggled(updated: SavedSearch) {
    setSearches((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)) ?? null);
  }

  function handleEdited(updated: SavedSearch) {
    setSearches((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)) ?? null);
    setEditing(null);
  }

  if (loadError) {
    return (
      <div className="card" style={{ color: 'var(--red)', marginBottom: 16 }}>
        {loadError}
      </div>
    );
  }

  if (searches === null) {
    return (
      <div className="empty">
        <p>Loading&hellip;</p>
      </div>
    );
  }

  if (searches.length === 0) {
    return (
      <EmptyState>
        <p>
          No saved searches yet &mdash; filter on{' '}
          <a href="/explore">Find Campsites</a> and hit{' '}
          <strong>Save this search</strong>.
        </p>
      </EmptyState>
    );
  }

  return (
    <>
      {searches.map((s) => (
        <SearchCard
          key={s.id}
          search={s}
          onEdit={setEditing}
          onDeleted={handleDeleted}
          onAlertToggled={handleAlertToggled}
        />
      ))}

      {editing && (
        <SaveSearchModal
          open={true}
          onClose={() => setEditing(null)}
          editing={editing}
          onSaved={handleEdited}
        />
      )}
    </>
  );
}
