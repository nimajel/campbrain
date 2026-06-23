import { useState } from "react";
import { PIN_LEGEND, buildLegendSwatchHtml } from "../lib/map-pins";

export default function MapLegend({ dateFilterActive }: { dateFilterActive: boolean }) {
  const [open, setOpen] = useState(false);
  const entries = PIN_LEGEND.filter((e) => !e.onlyWhenFiltered || dateFilterActive);

  return (
    <div
      className="absolute bottom-6 left-4 z-[1000]"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {open ? (
        <div className="rounded-xl border bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
          {entries.map((entry) => (
            <div key={entry.kind} className="mb-1 flex items-center gap-2 last:mb-0">
              <span className="inline-flex shrink-0" dangerouslySetInnerHTML={{ __html: buildLegendSwatchHtml(entry.kind) }} />
              <span className="whitespace-nowrap text-[11px] text-neutral-800">{entry.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-2xl border bg-white/95 px-3 py-1 text-[11px] font-semibold text-neutral-800 shadow-sm"
        >
          ☰ Key
        </button>
      )}
    </div>
  );
}
