'use client';

import type { ParkCatalogEntry, DiscoveryStatus } from '../../lib/catalog';

interface CatalogClientProps {
  initialParks: ParkCatalogEntry[];
}

function siteCount(park: ParkCatalogEntry): number {
  return park.campgrounds.reduce((sum, cg) => sum + cg.sites.length, 0);
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function StatusBadge({ status }: { status: DiscoveryStatus | undefined }) {
  const map: Record<DiscoveryStatus, { label: string; cls: string }> = {
    success: { label: 'Loaded', cls: 'chip-green' },
    failed: { label: 'Failed', cls: 'chip-red' },
    pending: { label: 'Pending', cls: 'chip-yellow' },
    not_started: { label: 'Not loaded', cls: 'chip-gray' },
  };
  const s = map[status ?? 'not_started'];
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

function ParkRow({ park }: { park: ParkCatalogEntry }) {
  return (
    <div className="catalog-park-row">
      <div className="catalog-park-header">
        <div className="catalog-park-info">
          <span className="catalog-park-name">{park.parkName}</span>
          <StatusBadge status={park.discoveryStatus} />
          <span className="catalog-park-stats">
            {park.campgrounds.length} campground{park.campgrounds.length !== 1 ? 's' : ''}
            {' · '}
            {siteCount(park)} sites
          </span>
          <span className="catalog-park-updated">Updated: {formatDate(park.lastUpdatedAt)}</span>
        </div>
      </div>

      {park.discoveryError && (
        <p className="form-error" style={{ marginTop: 4 }}>
          {park.discoveryError}
        </p>
      )}

      {park.campgrounds.length === 0 ? (
        <p className="empty-state" style={{ marginTop: 4 }}>
          Campground data is not loaded yet. Run{' '}
          <code>npm run catalog:refresh</code> from the backend to populate it.
        </p>
      ) : (
        <div className="catalog-campgrounds">
          {park.campgrounds.map((cg) => (
            <div key={cg.id} className="catalog-campground">
              <span className="catalog-campground-name">{cg.name}</span>
              <span className="catalog-campground-sites">{cg.sites.length} sites</span>
              {cg.sites.length > 0 && (
                <span className="catalog-site-names">{cg.sites.map((s) => s.name).join(', ')}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CatalogClient({ initialParks }: CatalogClientProps) {
  return (
    <div className="page-content">
      <h1>Catalog Admin</h1>
      <p className="section-desc">
        Read-only view of the park/campground/site catalog. This data populates the alert
        creation form. To fetch or update campground data, run{' '}
        <code>npm run catalog:refresh</code> from the backend — no page IDs required.
      </p>

      <section className="card">
        <h2>Parks ({initialParks.length})</h2>
        {initialParks.length === 0 ? (
          <p className="empty-state">No parks in catalog yet.</p>
        ) : (
          <div className="catalog-parks-list">
            {initialParks.map((park) => (
              <ParkRow key={park.parkPageId} park={park} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
