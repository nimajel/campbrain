import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { GLYPHS } from "../lib/map-pins";
import { sortParkRows, type ParkListRow, type ParkListSort } from "../lib/park-list";
import { formatDate } from "../lib/map-utils";
import type { SheetDetent } from "../lib/sheet-detent";

const SORTS: { key: ParkListSort; label: string }[] = [
  { key: "sites", label: "Most sites" },
  { key: "distance", label: "Nearest" },
  { key: "soonest", label: "Soonest" },
  { key: "name", label: "A–Z" },
];

function RowGlyph({ isFederal, walkUpOnly }: { isFederal: boolean; walkUpOnly: boolean }) {
  return (
    <span
      className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
        walkUpOnly ? "bg-amber-500" : "bg-emerald-600"
      }`}
    >
      <svg width="14" height="14" viewBox="3 3 19 17" aria-hidden="true">
        <path d={GLYPHS[isFederal ? "federal" : "state"]} fill="#fff" />
      </svg>
    </span>
  );
}

interface Props {
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
}

export default function ResultsDrawer(props: Props) {
  const {
    rows,
    sort,
    onSortChange,
    hasLocation,
    selectedParkId,
    onSelectRow,
    open,
    mobile = false,
    detent = "peek",
    onCycleDetent,
  } = props;

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !selectedParkId || !listRef.current) return;
    listRef.current
      .querySelector(`[data-park-id="${CSS.escape(selectedParkId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, selectedParkId]);

  const sorted = sortParkRows(rows, sort);

  // Determine container classes based on mobile vs desktop and open state.
  let containerClasses: string;
  if (mobile) {
    const detentTransform =
      detent === "peek"
        ? "translate-y-[calc(100%-140px)]"
        : detent === "half"
          ? "translate-y-[48%]"
          : "translate-y-[56px]";
    containerClasses = `fixed inset-x-0 top-0 h-full rounded-t-2xl bg-white shadow-lg transition-transform z-20 flex flex-col ${detentTransform}`;
  } else {
    const closedClasses = !open ? "-translate-x-[115%] opacity-0 pointer-events-none" : "";
    containerClasses = `absolute left-4 top-[124px] bottom-3 w-[290px] bg-white rounded-xl shadow-lg transition-all z-10 flex flex-col overflow-hidden ${closedClasses}`;
  }

  return (
    <div className={containerClasses} aria-hidden={!open}>
      {mobile && (
        <div
          className="flex justify-center pt-2 pb-1 cursor-pointer shrink-0"
          onClick={onCycleDetent}
          aria-label="Resize list"
        >
          <span className="block w-10 h-1 rounded-full bg-gray-300" />
        </div>
      )}

      {/* Sort header */}
      <div className="shrink-0 border-b border-gray-200 px-3 pt-2.5 pb-2">
        <div className="text-xs font-semibold mb-1.5">
          {rows.length} park{rows.length !== 1 ? "s" : ""} with stays
        </div>
        <div className="flex flex-wrap gap-1">
          {SORTS.map(({ key, label }) => {
            const disabled = key === "distance" && !hasLocation;
            return (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={sort === key ? "default" : "ghost"}
                disabled={disabled}
                title={disabled ? "Set a location to sort by distance" : undefined}
                onClick={() => onSortChange(key)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Row list */}
      <div className="flex-1 overflow-y-auto" ref={listRef}>
        {sorted.map((r) => {
          const walkUpOnly = r.siteCount === 0 && r.walkUpCount > 0;
          const isSelected = selectedParkId === r.parkPageId;
          return (
            <button
              key={r.parkPageId}
              type="button"
              data-park-id={r.parkPageId}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${
                isSelected ? "bg-blue-50 border-l-2 border-blue-500" : ""
              }`}
              onClick={() => onSelectRow(r.parkPageId)}
            >
              <RowGlyph isFederal={r.isFederal} walkUpOnly={walkUpOnly} />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
                  {r.parkName}
                </span>
                <span className="text-[11px] text-gray-500">
                  {walkUpOnly ? (
                    <span className="font-semibold text-amber-600">walk-up only</span>
                  ) : (
                    <span className="font-semibold text-emerald-700">
                      {r.siteCount} site{r.siteCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {sort === "soonest" && r.soonestDate && (
                    <> &middot; opens {formatDate(r.soonestDate)}</>
                  )}
                  {r.distanceMi !== null && <> &middot; {Math.round(r.distanceMi)} mi</>}
                </span>
              </span>
            </button>
          );
        })}
        {sorted.length === 0 && (
          <div className="px-4 py-4 text-xs text-gray-500">
            No parks match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}
