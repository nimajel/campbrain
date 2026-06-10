'use client';

import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import type { DateRange } from 'react-day-picker';

function parseIso(iso: string): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function toIso(d: Date | undefined): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function label(from: string, to: string): string {
  const fmt = (iso: string) =>
    parseIso(iso)!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!from) return 'Pick dates…';
  return to ? `${fmt(from)} – ${fmt(to)}` : `${fmt(from)} →`;
}

export default function DateRangePicker({
  from,
  to,
  onChange,
  mobile = false,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  mobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const selected: DateRange | undefined = from
    ? { from: parseIso(from), to: parseIso(to) }
    : undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const picker = (
    <DayPicker
      mode="range"
      numberOfMonths={mobile ? 1 : 2}
      selected={selected}
      disabled={{ before: today }}
      onSelect={(range, triggerDate) => {
        // A click while a complete range is selected starts a fresh range —
        // otherwise react-day-picker extends the old one and the popover
        // closes before a second endpoint can be chosen.
        if (from && to) {
          onChange(toIso(triggerDate), '');
          return;
        }
        onChange(toIso(range?.from), toIso(range?.to));
        if (range?.from && range?.to && range.from.getTime() !== range.to.getTime() && !mobile) {
          setOpen(false);
        }
      }}
    />
  );

  if (mobile) {
    return <div className="date-range-picker date-range-picker--inline">{picker}</div>;
  }

  return (
    <div ref={wrapRef} className="date-range-picker" style={{ position: 'relative' }}>
      <button
        type="button"
        className={`btn btn-sm ${from ? 'btn-slate' : 'btn-ghost'}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        📅 {label(from, to)}
      </button>
      {open && <div className="date-range-popover">{picker}</div>}
    </div>
  );
}
