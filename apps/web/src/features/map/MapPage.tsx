import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/trpc";
import type { MapPark } from "@campbrain/core";
import { useMapFilters } from "./hooks/use-map-filters";
import { useMapSummary } from "./hooks/use-map-summary";
import { useFilteredParks } from "./hooks/use-filtered-parks";
import { useIsMobile } from "./hooks/use-is-mobile";
import { cycleDetent, type SheetDetent } from "./lib/sheet-detent";
import type { ParkListSort } from "./lib/park-list";
import FilterBar from "./components/FilterBar";
import ResultsDrawer from "./components/ResultsDrawer";
import ParkDetail from "./components/ParkDetail";

const MapView = lazy(() => import("./components/MapView"));

export default function MapPage() {
  const catalog = useQuery({ queryKey: ["map", "catalog"], queryFn: () => api.map.catalog.query() });
  const parks: MapPark[] = catalog.data?.parks ?? [];

  const f = useMapFilters();
  const [selectedPark, setSelectedPark] = useState<MapPark | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [listSortChoice, setListSortChoice] = useState<ParkListSort | null>(null);
  const [detent, setDetent] = useState<SheetDetent>("peek");
  const isMobile = useIsMobile();

  const { availByPark, loading } = useMapSummary({
    availFrom: f.availFrom, availTo: f.availTo, taxonomy: f.taxonomy, weekendsOnly: f.weekendsOnly, minNights: f.minNights,
  });
  const { displayedParks, matchCount, listRows } = useFilteredParks({
    parks, resolvedLocation: f.resolvedLocation, distanceMiles: f.distanceMiles, availByPark,
  });

  const sortedParks = useMemo(() => [...parks].sort((a, b) => a.parkName.localeCompare(b.parkName)), [parks]);
  const listSort: ParkListSort = listSortChoice ?? (f.resolvedLocation ? "distance" : "sites");

  const handleSelectRow = useCallback((id: string) => {
    const park = parks.find((p) => p.parkPageId === id);
    if (park) setSelectedPark(park);
  }, [parks]);

  return (
    <div className="relative h-[calc(100vh-var(--nav-h,56px))] w-full overflow-hidden">
      <FilterBar
        filters={f} parks={parks} sortedParks={sortedParks}
        matchCount={matchCount} total={parks.length} loading={loading}
        isMobile={isMobile} filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
        onSelectPark={setSelectedPark}
        onOpenNav={() => {}}
      />
      <div className="absolute inset-0">
        <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">Loading map…</div>}>
          <MapView
            parks={displayedParks}
            selectedPark={selectedPark}
            onSelectPark={setSelectedPark}
            focusLocation={f.resolvedLocation}
            distanceMiles={f.distanceMiles}
            availability={availByPark}
          />
        </Suspense>
        {!isMobile && (
          <button
            type="button"
            className="absolute left-4 top-[82px] z-[960] rounded-md border bg-white px-3 py-1 text-sm shadow"
            onClick={() => setListOpen((o) => !o)}
            aria-expanded={listOpen}
          >
            ☰ {listRows.length} park{listRows.length !== 1 ? "s" : ""}
          </button>
        )}
        <ResultsDrawer
          rows={listRows} sort={listSort} onSortChange={(s) => setListSortChoice(s)}
          hasLocation={f.resolvedLocation !== null}
          selectedParkId={selectedPark?.parkPageId ?? null}
          onSelectRow={handleSelectRow}
          open={isMobile ? true : listOpen}
          mobile={isMobile} detent={detent}
          onCycleDetent={() => setDetent((d) => cycleDetent(d))}
        />
      </div>
      {selectedPark && (
        <>
          {isMobile && <div className="fixed inset-0 z-[1100] bg-black/30" onClick={() => setSelectedPark(null)} />}
          <ParkDetail
            park={selectedPark}
            onClose={() => setSelectedPark(null)}
            taxonomy={f.taxonomy}
            minNights={f.minNights}
            weekendsOnly={f.weekendsOnly}
            availFrom={f.availFrom}
            availTo={f.availTo}
          />
        </>
      )}
    </div>
  );
}
