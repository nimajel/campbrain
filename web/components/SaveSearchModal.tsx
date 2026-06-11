'use client';

import { useState } from 'react';
import Modal from './ui/Modal';
import Toggle from './ui/Toggle';
import type { SavedSearch, SavedSearchInput } from '../../src/saved-search/types.js';
import type { CampRegion } from '../../src/catalog/regions.js';
import type { SiteAccess, SiteKind, HideTarget } from '../../src/cache/availability-cache.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SaveSearchModalProps {
  open: boolean;
  onClose: () => void;
  /** When provided we PATCH instead of POST. */
  editing?: SavedSearch;
  /** Pre-filled values for a new save from /explore */
  prefill?: {
    name: string;
    region: CampRegion | null;
    from: string;
    to: string;
    access: SiteAccess[];
    kinds: SiteKind[];
    hide: HideTarget[];
    minNights: 1 | 2 | 3;
  };
  onSaved?: (saved: SavedSearch) => void;
}

const HORIZON_OPTIONS: { value: number; label: string }[] = [
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '180 days' },
];

export default function SaveSearchModal({
  open,
  onClose,
  editing,
  prefill,
  onSaved,
}: SaveSearchModalProps) {
  // Derive initial values: editing takes precedence, then prefill, then defaults.
  const initName = editing?.name ?? prefill?.name ?? '';
  const initKind: 'fixed_range' | 'any_weekend' =
    editing?.datePattern.kind ?? (prefill?.from ? 'fixed_range' : 'any_weekend');
  const initFrom =
    editing?.datePattern.kind === 'fixed_range'
      ? editing.datePattern.from
      : (prefill?.from ?? '');
  const initTo =
    editing?.datePattern.kind === 'fixed_range'
      ? editing.datePattern.to
      : (prefill?.to ?? '');
  const initHorizon =
    editing?.datePattern.kind === 'any_weekend'
      ? editing.datePattern.horizonDays
      : 90;
  const initAlert = editing?.alertEnabled ?? false;

  const [name, setName] = useState(initName);
  const [dateKind, setDateKind] = useState<'fixed_range' | 'any_weekend'>(initKind);
  const [from, setFrom] = useState(initFrom);
  const [to, setTo] = useState(initTo);
  const [horizonDays, setHorizonDays] = useState(initHorizon);
  const [alertEnabled, setAlertEnabled] = useState(initAlert);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (dateKind === 'fixed_range' && (!from || !to || from >= to)) {
      setError('Enter a valid date range.');
      return;
    }

    setError(null);
    setSaving(true);

    const scope = editing?.scope ?? {
      region: prefill?.region ?? null,
      parkPageIds: [],
    };

    const filters = editing?.filters ?? {
      access: prefill?.access ?? [],
      kinds: prefill?.kinds ?? [],
      hide: prefill?.hide ?? [],
      minNights: prefill?.minNights ?? 1,
    };

    const datePattern =
      dateKind === 'fixed_range'
        ? { kind: 'fixed_range' as const, from, to }
        : { kind: 'any_weekend' as const, horizonDays };

    const payload: SavedSearchInput = {
      userId: null,
      provider: editing?.provider ?? 'california-parks',
      name: name.trim(),
      scope,
      datePattern,
      filters,
      alertEnabled,
      emailEnabled: editing?.emailEnabled ?? true,
    };

    try {
      const res = editing
        ? await fetch(`/api/saved-searches/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/saved-searches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }

      const json = (await res.json()) as { savedSearch: SavedSearch };
      onSaved?.(json.savedSearch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit saved search' : 'Save this search'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Name */}
        <label>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              color: 'var(--muted)',
              display: 'block',
              marginBottom: 4,
            }}
          >
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Bay Area · Jul 4 weekend"
            style={{ width: '100%' }}
          />
        </label>

        {/* Date-pattern toggle */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              color: 'var(--muted)',
              marginBottom: 8,
            }}
          >
            Date pattern
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button
              type="button"
              className={`btn btn-sm ${dateKind === 'fixed_range' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setDateKind('fixed_range')}
            >
              Fixed dates
            </button>
            <button
              type="button"
              className={`btn btn-sm ${dateKind === 'any_weekend' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setDateKind('any_weekend')}
            >
              Any weekend
            </button>
          </div>

          {dateKind === 'fixed_range' && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ flex: '0 0 150px' }}>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    display: 'block',
                    marginBottom: 2,
                  }}
                >
                  Check-in
                </span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    if (to && e.target.value >= to) setTo('');
                  }}
                />
              </label>
              <label style={{ flex: '0 0 150px' }}>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    display: 'block',
                    marginBottom: 2,
                  }}
                >
                  Check-out
                </span>
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
          )}

          {dateKind === 'any_weekend' && (
            <label>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                Look ahead
              </span>
              <select
                value={horizonDays}
                onChange={(e) => setHorizonDays(Number(e.target.value))}
              >
                {HORIZON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* Alert toggle */}
        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 12,
          }}
        >
          <Toggle
            checked={alertEnabled}
            onChange={setAlertEnabled}
            label="Alert me by email when availability opens"
          />
          {alertEnabled && (
            <p
              style={{
                fontSize: 12,
                color: 'var(--muted)',
                margin: '6px 0 0 34px',
              }}
            >
              You&apos;ll receive an email when matching sites become available.
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save search'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
