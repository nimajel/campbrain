import { useMemo, useState } from "react";
import type { MapPark } from "@campbrain/core";

export default function ParkFinder({ parks, onSelect }: { parks: MapPark[]; onSelect: (park: MapPark) => void }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return parks.filter((p) => p.parkName.toLowerCase().includes(q)).slice(0, 8);
  }, [query, parks]);

  return (
    <div className="relative w-56 shrink-0">
      <input
        className="w-full rounded-md border bg-white px-2.5 py-1.5 text-xs"
        placeholder="Find a park…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-[1200] mt-1 overflow-hidden rounded-md border bg-white shadow-lg">
          {matches.map((p) => (
            <li key={p.parkPageId} className="border-t first:border-t-0">
              <button
                type="button"
                onClick={() => { onSelect(p); setQuery(""); }}
                className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-neutral-100"
              >
                {p.parkName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
