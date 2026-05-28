'use client';

import { useState } from 'react';
import type { Target } from '../../../src/config/schemas';

type DateMode = Target['dateMode'];
type Provider = Target['provider'];
type CampingType = Target['campingType'];

interface FormState {
  name: string;
  provider: Provider;
  parkName: string;
  parkPageId: string;
  campgroundName: string;
  acceptableSites: string;
  people: number;
  campingType: CampingType;
  dateMode: DateMode;
  exactStartDate: string;
  exactEndDate: string;
  rangeStart: string;
  rangeEnd: string;
  nextWeeksCount: number;
  minNights: number;
  maxNights: number;
  weekendsOnly: boolean;
  bookingMonthsBefore: number;
  bookingReleaseTime: string;
  bookingTimezone: string;
}

const DEFAULT_FORM: FormState = {
  name: '',
  provider: 'california-parks',
  parkName: '',
  parkPageId: '',
  campgroundName: '',
  acceptableSites: '',
  people: 2,
  campingType: 'hike-in',
  dateMode: 'next_available_weekend',
  exactStartDate: '',
  exactEndDate: '',
  rangeStart: '',
  rangeEnd: '',
  nextWeeksCount: 12,
  minNights: 1,
  maxNights: 2,
  weekendsOnly: false,
  bookingMonthsBefore: 6,
  bookingReleaseTime: '08:00',
  bookingTimezone: 'America/Los_Angeles',
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function formToTarget(form: FormState, existingId?: string): object {
  const sites = form.acceptableSites
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const slugged = slugify(form.name);
  const id = existingId ?? (slugged !== '' ? slugged : `target-${Date.now()}`);

  const base = {
    id,
    name: form.name,
    provider: form.provider,
    parkName: form.parkName,
    parkPageId: form.parkPageId,
    campgroundName: form.campgroundName,
    acceptableSites: sites,
    preferredSites: sites,
    campingType: form.campingType,
    people: form.people,
    dateMode: form.dateMode,
    minNights: form.minNights,
    maxNights: form.maxNights,
    weekendsOnly: form.weekendsOnly,
    bookingRule: {
      type: 'rolling_months_before',
      monthsBefore: form.bookingMonthsBefore,
      releaseTime: form.bookingReleaseTime,
      timezone: form.bookingTimezone,
    },
  };

  if (form.dateMode === 'exact_dates') {
    return { ...base, exactStartDate: form.exactStartDate, exactEndDate: form.exactEndDate };
  }
  if (form.dateMode === 'date_range' || form.dateMode === 'weekend_range') {
    return { ...base, rangeStart: form.rangeStart, rangeEnd: form.rangeEnd };
  }
  if (form.dateMode === 'next_available_weekend') {
    return { ...base, nextWeeksCount: form.nextWeeksCount };
  }
  return base;
}

function targetToForm(t: Target): FormState {
  return {
    name: t.name,
    provider: t.provider,
    parkName: t.parkName,
    parkPageId: t.parkPageId,
    campgroundName: t.campgroundName,
    acceptableSites: t.acceptableSites.join('\n'),
    people: t.people,
    campingType: t.campingType,
    dateMode: t.dateMode,
    exactStartDate: t.exactStartDate ?? '',
    exactEndDate: t.exactEndDate ?? '',
    rangeStart: t.rangeStart ?? '',
    rangeEnd: t.rangeEnd ?? '',
    nextWeeksCount: t.nextWeeksCount ?? 12,
    minNights: t.minNights,
    maxNights: t.maxNights,
    weekendsOnly: t.weekendsOnly,
    bookingMonthsBefore: t.bookingRule.monthsBefore,
    bookingReleaseTime: t.bookingRule.releaseTime,
    bookingTimezone: t.bookingRule.timezone,
  };
}

function DateModeFields({ form, set }: { form: FormState; set: (f: Partial<FormState>) => void }) {
  if (form.dateMode === 'exact_dates') {
    return (
      <div style={{ display: 'flex', gap: 12 }}>
        <label style={{ flex: 1 }}>
          Start date
          <input type="date" value={form.exactStartDate} onChange={(e) => set({ exactStartDate: e.target.value })} />
        </label>
        <label style={{ flex: 1 }}>
          End date
          <input type="date" value={form.exactEndDate} onChange={(e) => set({ exactEndDate: e.target.value })} />
        </label>
      </div>
    );
  }

  if (form.dateMode === 'date_range' || form.dateMode === 'weekend_range') {
    return (
      <div style={{ display: 'flex', gap: 12 }}>
        <label style={{ flex: 1 }}>
          Range start
          <input type="date" value={form.rangeStart} onChange={(e) => set({ rangeStart: e.target.value })} />
        </label>
        <label style={{ flex: 1 }}>
          Range end
          <input type="date" value={form.rangeEnd} onChange={(e) => set({ rangeEnd: e.target.value })} />
        </label>
      </div>
    );
  }

  if (form.dateMode === 'next_available_weekend') {
    return (
      <label>
        Number of upcoming weekends to scan
        <input
          type="number"
          min={1}
          max={52}
          value={form.nextWeeksCount}
          onChange={(e) => set({ nextWeeksCount: Number(e.target.value) })}
        />
      </label>
    );
  }

  return null;
}

function TargetForm({
  initial,
  existingId,
  onSave,
  onCancel,
}: {
  initial: FormState;
  existingId?: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [form, setFormRaw] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(partial: Partial<FormState>) {
    setFormRaw((prev) => ({ ...prev, ...partial }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const body = formToTarget(form, existingId);
    const url = existingId ? `/api/targets/${existingId}` : '/api/targets';
    const method = existingId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <label style={{ flex: 2 }}>
          Name
          <input required value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Angel Island Ridge weekends" />
        </label>
        <label style={{ flex: 1 }}>
          Provider
          <select value={form.provider} onChange={(e) => set({ provider: e.target.value as Provider })}>
            <option value="california-parks">California Parks</option>
            <option value="recreation-gov">Recreation.gov</option>
            <option value="yosemite-lottery">Yosemite Lottery</option>
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <label style={{ flex: 2 }}>
          Park name
          <input required value={form.parkName} onChange={(e) => set({ parkName: e.target.value })} placeholder="Angel Island SP" />
        </label>
        <label style={{ flex: 1 }}>
          Park page ID
          <input required value={form.parkPageId} onChange={(e) => set({ parkPageId: e.target.value })} placeholder="468" />
        </label>
      </div>

      <label>
        Campground name <span style={{ color: 'var(--muted)', fontSize: 12 }}>(must match exactly)</span>
        <input required value={form.campgroundName} onChange={(e) => set({ campgroundName: e.target.value })} placeholder="Ridge (sites 4-6)" />
      </label>

      <label>
        Acceptable sites <span style={{ color: 'var(--muted)', fontSize: 12 }}>(one per line)</span>
        <textarea
          required
          rows={3}
          value={form.acceptableSites}
          onChange={(e) => set({ acceptableSites: e.target.value })}
          placeholder={'Hike in Campsite #4\nHike in Campsite #5\nHike in Campsite #6'}
        />
      </label>

      <div style={{ display: 'flex', gap: 12 }}>
        <label style={{ flex: 1 }}>
          People
          <input type="number" min={1} value={form.people} onChange={(e) => set({ people: Number(e.target.value) })} />
        </label>
        <label style={{ flex: 1 }}>
          Camping type
          <select value={form.campingType} onChange={(e) => set({ campingType: e.target.value as CampingType })}>
            <option value="hike-in">Hike-in</option>
            <option value="drive-to">Drive-to</option>
            <option value="walk-in">Walk-in</option>
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <label style={{ flex: 1 }}>
          Min nights
          <input type="number" min={1} value={form.minNights} onChange={(e) => set({ minNights: Number(e.target.value) })} />
        </label>
        <label style={{ flex: 1 }}>
          Max nights
          <input type="number" min={1} value={form.maxNights} onChange={(e) => set({ maxNights: Number(e.target.value) })} />
        </label>
        {(form.dateMode === 'date_range') && (
          <label style={{ flex: 1, alignSelf: 'flex-end', paddingBottom: 4 }}>
            <input type="checkbox" checked={form.weekendsOnly} onChange={(e) => set({ weekendsOnly: e.target.checked })} />
            {' '}Weekends only
          </label>
        )}
      </div>

      <label>
        Date mode
        <select value={form.dateMode} onChange={(e) => set({ dateMode: e.target.value as DateMode })}>
          <option value="next_available_weekend">Next available weekends</option>
          <option value="weekend_range">Weekend range</option>
          <option value="date_range">Date range</option>
          <option value="exact_dates">Exact dates</option>
        </select>
      </label>

      <DateModeFields form={form} set={set} />

      <fieldset style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px' }}>
        <legend style={{ fontSize: 12, color: 'var(--muted)', padding: '0 4px' }}>Booking rule</legend>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1 }}>
            Months before
            <input type="number" min={1} value={form.bookingMonthsBefore} onChange={(e) => set({ bookingMonthsBefore: Number(e.target.value) })} />
          </label>
          <label style={{ flex: 1 }}>
            Release time (HH:MM)
            <input value={form.bookingReleaseTime} onChange={(e) => set({ bookingReleaseTime: e.target.value })} placeholder="08:00" />
          </label>
          <label style={{ flex: 2 }}>
            Timezone
            <input value={form.bookingTimezone} onChange={(e) => set({ bookingTimezone: e.target.value })} placeholder="America/Los_Angeles" />
          </label>
        </div>
      </fieldset>

      {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : existingId ? 'Save changes' : 'Create target'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function TargetRow({
  target,
  onEdit,
  onDelete,
}: {
  target: Target;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Delete "${target.name}"?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/targets/${target.id}`, { method: 'DELETE' });
      onDelete();
    } finally {
      setDeleting(false);
    }
  }

  function dateRangeLabel() {
    if (target.dateMode === 'exact_dates') return `${target.exactStartDate ?? '?'} → ${target.exactEndDate ?? '?'}`;
    if (target.dateMode === 'date_range' || target.dateMode === 'weekend_range') return `${target.rangeStart ?? '?'} – ${target.rangeEnd ?? '?'}`;
    if (target.dateMode === 'next_available_weekend') return `next ${target.nextWeeksCount ?? 12} weekends`;
    return '';
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <strong>{target.name}</strong>
            <span className="badge badge-blue">{target.provider}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {target.parkName} · {target.campgroundName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {target.acceptableSites.join(', ')} · {target.minNights}–{target.maxNights}N · {dateRangeLabel()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <a href={`/scan?target=${target.id}`} className="btn" style={{ fontSize: 12 }}>
            🔍 Scan
          </a>
          <button className="btn" style={{ fontSize: 12 }} onClick={onEdit}>Edit</button>
          <button
            className="btn"
            style={{ fontSize: 12, color: 'var(--red)' }}
            disabled={deleting}
            onClick={() => { void handleDelete(); }}
          >
            {deleting ? '…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TargetsClient({ initialTargets }: { initialTargets: Target[] }) {
  const [targets, setTargets] = useState<Target[]>(initialTargets);
  const [mode, setMode] = useState<'list' | 'new' | string>('list'); // string = editId

  async function refresh() {
    const res = await fetch('/api/targets');
    const data = (await res.json()) as Target[];
    setTargets(data);
    setMode('list');
  }

  if (mode === 'new') {
    return (
      <div>
        <h2 style={{ marginBottom: 16 }}>New Target</h2>
        <div className="card">
          <TargetForm
            initial={DEFAULT_FORM}
            onSave={() => { void refresh(); }}
            onCancel={() => setMode('list')}
          />
        </div>
      </div>
    );
  }

  if (mode !== 'list') {
    const target = targets.find((t) => t.id === mode);
    if (target) {
      return (
        <div>
          <h2 style={{ marginBottom: 16 }}>Edit Target</h2>
          <div className="card">
            <TargetForm
              initial={targetToForm(target)}
              existingId={target.id}
              onSave={() => { void refresh(); }}
              onCancel={() => setMode('list')}
            />
          </div>
        </div>
      );
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Targets ({targets.length})</h2>
        <button className="btn btn-primary" onClick={() => setMode('new')}>+ New Target</button>
      </div>

      {targets.length === 0 && (
        <div className="empty">No targets configured. Click "New Target" to add one.</div>
      )}

      {targets.map((t) => (
        <TargetRow
          key={t.id}
          target={t}
          onEdit={() => setMode(t.id)}
          onDelete={() => { void refresh(); }}
        />
      ))}
    </div>
  );
}
