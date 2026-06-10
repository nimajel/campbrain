'use client';

import { ACCESS_GROUP, KIND_GROUP, HIDE_GROUP } from '../../lib/site-taxonomy';
import type { TaxonomyState } from '../../lib/site-taxonomy';
import type { SiteAccess, SiteKind, HideTarget } from '../../lib/availability-cache';

interface Props {
  state: TaxonomyState;
  onChange: (next: TaxonomyState) => void;
  /** Which groups to render. Defaults to all three. */
  groups?: Array<'access' | 'kinds' | 'hide'>;
  /** Inline group labels + tighter spacing (used by the map filter bar). */
  dense?: boolean;
}

function toggle<T extends string>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export default function SiteFilterPanel({ state, onChange, groups = ['access', 'kinds', 'hide'], dense = false }: Props) {
  return (
    <div style={{ display: 'flex', gap: dense ? 14 : 16, flexWrap: 'wrap' }}>
      {groups.includes('access') && (
        <Group label={ACCESS_GROUP.label} dense={dense}>
          {ACCESS_GROUP.options.map((o) => (
            <Pill
              key={o.id}
              label={o.label}
              active={state.access.includes(o.id)}
              hide={false}
              onClick={() => onChange({ ...state, access: toggle<SiteAccess>(state.access, o.id) })}
            />
          ))}
        </Group>
      )}
      {groups.includes('kinds') && (
        <Group label={KIND_GROUP.label} dense={dense}>
          {KIND_GROUP.options.map((o) => (
            <Pill
              key={o.id}
              label={o.label}
              active={state.kinds.includes(o.id)}
              hide={false}
              onClick={() => onChange({ ...state, kinds: toggle<SiteKind>(state.kinds, o.id) })}
            />
          ))}
        </Group>
      )}
      {groups.includes('hide') && (
        <Group label={HIDE_GROUP.label} dense={dense}>
          {HIDE_GROUP.options.map((o) => (
            <Pill
              key={o.id}
              label={o.label}
              active={state.hide.includes(o.id)}
              hide
              onClick={() => onChange({ ...state, hide: toggle<HideTarget>(state.hide, o.id) })}
            />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ label, dense, children }: { label: string; dense: boolean; children: React.ReactNode }) {
  if (dense) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>
          {label}
        </span>
        {children}
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function Pill({ label, active, hide, onClick }: { label: string; active: boolean; hide: boolean; onClick: () => void }) {
  const cls = active ? (hide ? 'btn-slate' : 'btn-primary') : 'btn-ghost';
  return (
    <button type="button" className={`btn btn-sm ${cls}`} onClick={onClick} style={active ? { fontWeight: 700 } : {}}>
      {active && hide ? <EyeOffIcon /> : null}{label}
    </button>
  );
}
