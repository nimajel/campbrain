'use client';

import { useState, useCallback } from 'react';
import type { Alert } from '../../lib/alerts';
import type { ParkCatalogEntry, CampgroundCatalogEntry, CatalogBookingRule } from '../../lib/catalog';
import {
  emptyForm,
  alertToForm,
  formToPayload,
  validateForm,
  bookingRuleDescription,
  applyParkToForm,
  applyCampgroundToForm,
} from '../../lib/alert-form';
import type { FormState } from '../../lib/alert-form';

// ---------------------------------------------------------------------------
// Alert card
// ---------------------------------------------------------------------------

function AlertCard({
  alert,
  onEdit,
  onToggle,
  onDelete,
}: {
  alert: Alert;
  onEdit: (a: Alert) => void;
  onToggle: (a: Alert) => void;
  onDelete: (a: Alert) => void;
}) {
  const dateLabel = (() => {
    switch (alert.dateMode) {
      case 'exact_dates': return `${alert.exactStartDate ?? '?'} → ${alert.exactEndDate ?? '?'}`;
      case 'date_range':
      case 'weekend_range': return `${alert.rangeStart ?? '?'} – ${alert.rangeEnd ?? '?'}`;
      case 'next_available_weekend': return `Next ${alert.nextWeeksCount ?? 12} weekends`;
    }
  })();

  return (
    <div className="card" style={{ opacity: alert.enabled ? 1 : 0.6 }}>
      <div className="alert-header">
        <h3 style={{ margin: 0, flex: 1 }}>{alert.name}</h3>
        <span className={`chip ${alert.enabled ? 'chip-green' : 'chip-gray'}`}>
          <span className={`dot ${alert.enabled ? 'dot-green' : 'dot-gray'}`} style={{ marginRight: 0 }} />
          {alert.enabled ? 'In calendar sync' : 'Not synced'}
        </span>
        <span className="badge badge-blue">{alert.provider}</span>
        {alert.emailEnabled && <span className="badge badge-gray">email</span>}
        {alert.calendarEnabled && <span className="badge badge-gray">cal</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
        <div className="kv-row"><span className="kv-key">Park</span><span className="kv-val">{alert.parkName}</span></div>
        <div className="kv-row"><span className="kv-key">Campground</span><span className="kv-val">{alert.campgroundName}</span></div>
        <div className="kv-row"><span className="kv-key">Sites</span><span className="kv-val">{alert.acceptableSites.join(', ')}</span></div>
        <div className="kv-row"><span className="kv-key">Dates</span><span className="kv-val">{dateLabel}</span></div>
        <div className="kv-row"><span className="kv-key">Nights</span><span className="kv-val">{alert.minNights}–{alert.maxNights}</span></div>
        <div className="kv-row"><span className="kv-key">People</span><span className="kv-val">{alert.people}</span></div>
      </div>

      <div className="card-actions">
        <button className="btn btn-sm btn-ghost" onClick={() => onEdit(alert)}>Edit</button>
        <button
          className={`btn btn-sm ${alert.enabled ? 'btn-danger' : 'btn-success'}`}
          onClick={() => onToggle(alert)}
        >
          {alert.enabled ? 'Disable' : 'Enable'}
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => onDelete(alert)}>Delete</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site multiselect
// ---------------------------------------------------------------------------

function SiteMultiselect({
  label,
  sites,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  sites: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  function toggle(site: string) {
    if (selected.includes(site)) {
      onChange(selected.filter((s) => s !== site));
    } else {
      onChange([...selected, site]);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{
        border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px',
        background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 6,
        minHeight: 44,
      }}>
        {sites.map((site) => (
          <label key={site} className="label-inline" style={{ fontSize: 13, color: 'var(--text)', gap: 8 }}>
            <input
              type="checkbox"
              checked={selected.includes(site)}
              onChange={() => toggle(site)}
            />
            {site}
          </label>
        ))}
        {sites.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '2px 0' }}>
            {placeholder ?? 'No options available'}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48);
}

// ---------------------------------------------------------------------------
// Alert form modal
// ---------------------------------------------------------------------------

function AlertFormModal({
  initial,
  parks,
  onClose,
  onSave,
}: {
  initial: Alert | null;
  parks: ParkCatalogEntry[];
  onClose: () => void;
  onSave: (payload: Record<string, unknown>, isNew: boolean) => Promise<string | null>;
}) {
  const [form, setForm] = useState<FormState>(
    initial ? alertToForm(initial, parks) : emptyForm()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [idCustomized, setIdCustomized] = useState(!(!initial));
  const isNew = !initial;

  const selectedPark: ParkCatalogEntry | null =
    parks.find((p) => p.parkPageId === form.selectedParkPageId) ?? null;

  const selectedCampground: CampgroundCatalogEntry | null =
    selectedPark?.campgrounds.find((c) => c.id === form.selectedCampgroundId) ?? null;

  const catalogSites = selectedCampground?.sites.map((s) => s.name) ?? [];
  const availableSites = catalogSites.length > 0 ? catalogSites : form.acceptableSites;

  const inferredRule: CatalogBookingRule | null =
    selectedCampground?.bookingRule ?? selectedPark?.defaultBookingRule ?? null;
  const ruleText = inferredRule
    ? bookingRuleDescription(inferredRule)
    : form.bookingRuleSource || null;

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function onNameChange(name: string) {
    setForm((f) => ({
      ...f,
      name,
      ...(isNew && !idCustomized ? { id: slugify(name) } : {}),
    }));
  }

  const onParkChange = useCallback((parkPageId: string) => {
    const park = parks.find((p) => p.parkPageId === parkPageId) ?? null;
    setForm((f) => ({ ...f, ...applyParkToForm(f, park) }));
  }, [parks]);

  const onCampgroundChange = useCallback((campgroundId: string) => {
    setForm((f) => {
      const park = parks.find((p) => p.parkPageId === f.selectedParkPageId) ?? null;
      return { ...f, ...applyCampgroundToForm(f, park, campgroundId) };
    });
  }, [parks]);

  function onAcceptableSitesChange(v: string[]) {
    setForm((f) => ({
      ...f,
      acceptableSites: v,
      preferredSites: f.preferredSites.filter((s) => v.includes(s)),
    }));
  }

  async function submit() {
    const errs = validateForm(form);
    if (errs.length > 0) {
      setError(errs[0]!.message);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(formToPayload(form), isNew);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const parkInCatalog = !!selectedPark;
  const parkHasCampgrounds = (selectedPark?.campgrounds.length ?? 0) > 0;
  const campgroundInCatalog = !!selectedCampground;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>{isNew ? 'New Booking Window' : 'Edit Booking Window'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>

          {/* --- Alert name --- */}
          <div className="form-row" style={{ marginBottom: 20 }}>
            <label>
              Name
              <input
                type="text" value={form.name}
                onChange={(e) => onNameChange(e.target.value)}
                required placeholder="Angel Island Ridge weekends"
                autoFocus
              />
            </label>
          </div>

          {/* --- Section 1: Trip intent --- */}
          <div className="section-title">Trip</div>
          <div className="form-grid">
            <div className="form-row">
              <label>
                When
                <select
                  value={form.dateMode}
                  onChange={(e) => set('dateMode', e.target.value as FormState['dateMode'])}
                >
                  <option value="next_available_weekend">Next available weekends</option>
                  <option value="date_range">Date range</option>
                  <option value="weekend_range">Weekend range</option>
                  <option value="exact_dates">Exact dates</option>
                </select>
              </label>
            </div>

            {form.dateMode === 'next_available_weekend' && (
              <div className="form-row">
                <label>
                  Weeks to look ahead
                  <input type="number" min={1} max={52} value={form.nextWeeksCount}
                    onChange={(e) => set('nextWeeksCount', Number(e.target.value))} />
                </label>
              </div>
            )}
            {(form.dateMode === 'date_range' || form.dateMode === 'weekend_range') && (
              <>
                <div className="form-row">
                  <label>Range start<input type="date" value={form.rangeStart} onChange={(e) => set('rangeStart', e.target.value)} /></label>
                </div>
                <div className="form-row">
                  <label>Range end<input type="date" value={form.rangeEnd} onChange={(e) => set('rangeEnd', e.target.value)} /></label>
                </div>
              </>
            )}
            {form.dateMode === 'exact_dates' && (
              <>
                <div className="form-row">
                  <label>Arrival<input type="date" value={form.exactStartDate} onChange={(e) => set('exactStartDate', e.target.value)} /></label>
                </div>
                <div className="form-row">
                  <label>Departure<input type="date" value={form.exactEndDate} onChange={(e) => set('exactEndDate', e.target.value)} /></label>
                </div>
              </>
            )}

            <div className="form-row">
              <label>Min nights<input type="number" min={1} value={form.minNights} onChange={(e) => set('minNights', Number(e.target.value))} /></label>
            </div>
            <div className="form-row">
              <label>Max nights<input type="number" min={1} value={form.maxNights} onChange={(e) => set('maxNights', Number(e.target.value))} /></label>
            </div>
            <div className="form-row">
              <label>People<input type="number" min={1} value={form.people} onChange={(e) => set('people', Number(e.target.value))} /></label>
            </div>
            <div className="form-row">
              <label>
                Camping type
                <select value={form.campingType} onChange={(e) => set('campingType', e.target.value as FormState['campingType'])}>
                  <option value="hike-in">Hike-in</option>
                  <option value="drive-to">Drive-to</option>
                  <option value="walk-in">Walk-in</option>
                </select>
              </label>
            </div>
            {(form.dateMode === 'next_available_weekend' || form.dateMode === 'weekend_range') && (
              <div className="form-row" style={{ justifyContent: 'flex-end' }}>
                <label className="label-inline" style={{ marginTop: 20 }}>
                  <input type="checkbox" checked={form.weekendsOnly} onChange={(e) => set('weekendsOnly', e.target.checked)} />
                  Weekends only
                </label>
              </div>
            )}
          </div>

          {/* --- Section 2: Location --- */}
          <div className="section-title">Location</div>
          <div className="form-grid">
            <div className="form-row">
              <label>
                Park
                <select
                  value={form.selectedParkPageId}
                  onChange={(e) => onParkChange(e.target.value)}
                >
                  <option value="">— Choose a park —</option>
                  {parks.map((p) => (
                    <option key={p.parkPageId} value={p.parkPageId}>{p.parkName}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="form-row">
              <label>
                Campground
                {parkInCatalog && parkHasCampgrounds ? (
                  <select
                    value={form.selectedCampgroundId}
                    onChange={(e) => onCampgroundChange(e.target.value)}
                    disabled={!form.selectedParkPageId}
                  >
                    <option value="">— Choose a campground —</option>
                    {selectedPark.campgrounds.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                ) : parkInCatalog && !parkHasCampgrounds ? (
                  <div style={{
                    fontSize: 12, color: 'var(--muted)',
                    padding: '8px 12px', background: 'rgba(245,200,66,.08)',
                    borderRadius: 6, borderLeft: '3px solid var(--yellow)', marginTop: 4,
                  }}>
                    Campground data is not loaded yet for this park.{' '}
                    Run catalog refresh from the backend to update campground data.
                  </div>
                ) : (
                  <input
                    type="text" value={form.campgroundName}
                    onChange={(e) => set('campgroundName', e.target.value)}
                    placeholder="Select a park above"
                    disabled={!form.selectedParkPageId}
                  />
                )}
              </label>
            </div>
          </div>

          {/* Booking rule — read-only info banner */}
          {ruleText && (
            <div style={{
              fontSize: 12, color: 'var(--muted)', marginBottom: 16,
              padding: '8px 12px', background: 'rgba(79,142,247,.06)',
              borderRadius: 6, borderLeft: '3px solid var(--accent)',
            }}>
              <strong style={{ color: 'var(--text)' }}>Booking window:</strong>{' '}
              {ruleText}
            </div>
          )}

          {/* Sites */}
          {form.selectedParkPageId && form.selectedCampgroundId && (
            <>
              <div className="form-grid">
                <SiteMultiselect
                  label="Sites to watch"
                  sites={availableSites}
                  selected={form.acceptableSites}
                  onChange={onAcceptableSitesChange}
                  placeholder={campgroundInCatalog ? 'No sites in catalog for this campground' : 'No sites available'}
                />
                <SiteMultiselect
                  label="Preferred sites (optional)"
                  sites={form.acceptableSites}
                  selected={form.preferredSites}
                  onChange={(v) => set('preferredSites', v)}
                  placeholder="Select sites above first"
                />
              </div>
            </>
          )}
          {form.selectedParkPageId && !form.selectedCampgroundId && parkHasCampgrounds && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              Choose a campground to select sites.
            </div>
          )}

          {/* --- Notifications --- */}
          <div className="section-title">Sync</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
            <label className="label-inline">
              <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
              Include in calendar sync
            </label>
            <label className="label-inline">
              <input type="checkbox" checked={form.emailEnabled} onChange={(e) => set('emailEnabled', e.target.checked)} />
              Email notifications
            </label>
            <label className="label-inline">
              <input type="checkbox" checked={form.calendarEnabled} onChange={(e) => set('calendarEnabled', e.target.checked)} />
              Calendar sync
            </label>
          </div>

          {/* --- Advanced / Developer section --- */}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => set('showAdvanced', !form.showAdvanced)}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', padding: '4px 0' }}
            >
              {form.showAdvanced ? '▼' : '▶'} Developer options
            </button>
          </div>

          {form.showAdvanced && (
            <div style={{ marginTop: 12, padding: 16, border: '1px solid var(--border)', borderRadius: 6 }}>
              <div className="section-title" style={{ marginTop: 0 }}>Developer Options</div>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>
                These values are inferred from the catalog. Override only if needed.
              </p>
              <div className="form-grid">
                <div className="form-row">
                  <label>
                    ID (slug)
                    <input
                      type="text" value={form.id}
                      onChange={(e) => { setIdCustomized(true); set('id', e.target.value); }}
                      disabled={!isNew}
                      placeholder="auto-generated from name"
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Provider
                    <select value={form.provider} onChange={(e) => set('provider', e.target.value as FormState['provider'])}>
                      <option value="california-parks">California Parks</option>
                      <option value="recreation-gov">Recreation.gov</option>
                      <option value="yosemite-lottery">Yosemite Lottery</option>
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Park Page ID
                    <input type="text" value={form.parkPageId}
                      onChange={(e) => set('parkPageId', e.target.value)} placeholder="inferred from park selection" />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Campground name override
                    <input type="text" value={form.campgroundName}
                      onChange={(e) => set('campgroundName', e.target.value)} placeholder="inferred from campground selection" />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Months before arrival
                    <input type="number" min={1} value={form.bookingRule_monthsBefore}
                      onChange={(e) => set('bookingRule_monthsBefore', Number(e.target.value))} />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Release time (HH:MM)
                    <input type="text" value={form.bookingRule_releaseTime}
                      onChange={(e) => set('bookingRule_releaseTime', e.target.value)}
                      placeholder="08:00" pattern="\d{2}:\d{2}" />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Timezone
                    <input type="text" value={form.bookingRule_timezone}
                      onChange={(e) => set('bookingRule_timezone', e.target.value)}
                      placeholder="America/Los_Angeles" />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Custom scan interval (minutes)
                    <input
                      type="number" min={15} value={form.scanIntervalMinutes}
                      onChange={(e) => set('scanIntervalMinutes', e.target.value)}
                      placeholder="Leave blank to use default"
                    />
                  </label>
                </div>
                <div className="form-row form-full">
                  <label>
                    Sites override (one per line)
                    <textarea
                      rows={4}
                      value={form.acceptableSites.join('\n')}
                      onChange={(e) => {
                        const sites = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
                        setForm((f) => ({
                          ...f,
                          acceptableSites: sites,
                          preferredSites: f.preferredSites.filter(s => sites.includes(s)),
                        }));
                      }}
                      placeholder={'Hike in Campsite #4\nHike in Campsite #5'}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12, padding: '8px 12px', background: 'rgba(255,107,107,.08)', borderRadius: 6 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Create' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export default function AlertsClient({ initial, parks }: { initial: Alert[]; parks: ParkCatalogEntry[] }) {
  const [alerts, setAlerts] = useState<Alert[]>(initial);
  const [modalAlert, setModalAlert] = useState<Alert | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pageError, setPageError] = useState('');

  function openNew() {
    setModalAlert(null);
    setModalOpen(true);
  }

  function openEdit(a: Alert) {
    setModalAlert(a);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setModalAlert(null);
  }

  async function refresh(): Promise<Alert[]> {
    const res = await fetch('/api/alerts');
    const data = (await res.json()) as Alert[];
    setAlerts(data);
    return data;
  }

  async function handleSave(
    payload: Record<string, unknown>,
    isNew: boolean,
  ): Promise<string | null> {
    let savedId: string;

    if (isNew) {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Create failed');
      }
      const created = (await res.json()) as Alert;
      savedId = created.id;
    } else {
      savedId = payload.id as string;
      const res = await fetch(`/api/alerts/${savedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Update failed');
      }
    }

    await refresh();
    return savedId;
  }

  async function handleToggle(a: Alert) {
    setPageError('');
    const endpoint = a.enabled ? 'disable' : 'enable';
    const res = await fetch(`/api/alerts/${a.id}/${endpoint}`, { method: 'POST' });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      setPageError(err.error ?? 'Toggle failed');
      return;
    }
    await refresh();
  }

  async function handleDelete(a: Alert) {
    if (!confirm(`Delete booking window "${a.name}"?`)) return;
    setPageError('');
    const res = await fetch(`/api/alerts/${a.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      setPageError(err.error ?? 'Delete failed');
      return;
    }
    await refresh();
  }

  const synced = alerts.filter((a) => a.enabled).length;

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ flex: 1 }}>Alerts</h1>
          <button className="btn btn-primary" onClick={openNew}>+ New booking window</button>
        </div>
        <p className="page-subtitle">
          {alerts.length} booking window{alerts.length !== 1 ? 's' : ''} · {synced} in calendar sync
        </p>
      </div>

      <div style={{
        padding: '10px 14px',
        marginBottom: 20,
        borderRadius: 6,
        background: 'rgba(79,142,247,.06)',
        borderLeft: '3px solid var(--accent)',
        fontSize: 13,
        color: 'var(--text)',
      }}>
        Availability alerts have moved to{' '}
        <a href="/saved" style={{ color: 'var(--accent)', fontWeight: 600 }}>Saved Searches</a>.
        This page manages booking-window reminders and calendar sync targets.
      </div>

      {pageError && (
        <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)', marginBottom: 16 }}>
          {pageError}
        </div>
      )}

      {alerts.length === 0 && (
        <div className="empty">
          No booking windows configured.{' '}
          <button className="btn btn-ghost btn-sm" onClick={openNew}>
            Create your first booking window
          </button>
        </div>
      )}

      {alerts.map((a) => (
        <AlertCard
          key={a.id}
          alert={a}
          onEdit={openEdit}
          onToggle={handleToggle}
          onDelete={handleDelete}
        />
      ))}

      {modalOpen && (
        <AlertFormModal
          initial={modalAlert}
          parks={parks}
          onClose={closeModal}
          onSave={handleSave}
        />
      )}
    </>
  );
}
