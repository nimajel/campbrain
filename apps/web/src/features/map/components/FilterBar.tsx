import { Button } from "@/components/ui/button";
import type { MapPark } from "@campbrain/core";
import type { MapFilters } from "../hooks/use-map-filters";
import DateRangePicker from "./DateRangePicker";
import SiteFilterPanel from "./SiteFilterPanel";
import ParkFinder from "./ParkFinder";
import type { Preset, MinNights } from "../lib/types";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "this_weekend", label: "This weekend" },
  { id: "next_2_weeks", label: "Next 2 weeks" },
  { id: "next_month", label: "Next month" },
  { id: "anytime", label: "Anytime" },
];
const MIN_STAY_OPTIONS: { value: MinNights; label: string }[] = [
  { value: null, label: "Any" }, { value: 1, label: "1 night" }, { value: 2, label: "2 nights" }, { value: 3, label: "3 nights" },
];
const DISTANCES: Array<number | null> = [null, 25, 50, 100, 200];

function RowLabel({ children }: { children: string }) {
  return <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{children}</span>;
}

interface Props {
  filters: MapFilters;
  parks: MapPark[];
  sortedParks: MapPark[];
  matchCount: number;
  total: number;
  loading: boolean;
  isMobile: boolean;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onSelectPark: (p: MapPark) => void;
  onOpenNav: () => void;
}

export default function FilterBar(props: Props) {
  const { filters: f } = props;

  return (
    <div
      className={[
        "absolute left-4 right-4 top-4 z-[1000] flex flex-col gap-2 rounded-lg border bg-white/80 p-3 shadow-lg backdrop-blur md:right-[332px]",
        props.isMobile && props.filtersOpen ? "fixed inset-0 z-[2500] overflow-y-auto rounded-none" : "",
      ].join(" ")}
    >
      {/* Header row: hamburger (mobile, when collapsed) + Filters toggle + summary sentence + Reset + ParkFinder */}
      <div className="flex min-w-0 items-center gap-2.5">
        {props.isMobile && !props.filtersOpen && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Menu"
            onClick={props.onOpenNav}
            className="shrink-0 font-semibold"
          >
            ☰
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant={props.filtersOpen ? "secondary" : "ghost"}
          onClick={props.onToggleFilters}
          aria-expanded={props.filtersOpen}
          className="shrink-0 font-semibold"
        >
          {props.filtersOpen ? "▾" : "▸"} Filters{f.activeFilterCount > 0 ? ` · ${f.activeFilterCount}` : ""}
        </Button>
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
          {props.loading ? (
            "Loading…"
          ) : (
            <>
              <strong className="text-foreground">
                {props.matchCount} of {props.total} parks
              </strong>
              {" "}have a {f.summaryParts.join(" ")}{f.summaryDateClause}{f.summaryNearClause}
            </>
          )}
        </span>
        {!f.isDefaultState && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={f.reset}
            className="shrink-0"
          >
            ↺ Reset
          </Button>
        )}
        <ParkFinder parks={props.sortedParks} onSelect={props.onSelectPark} />
      </div>

      {props.filtersOpen && (
        <>
          {/* Row 1: When — presets, DateRangePicker, weekends-only pill */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <RowLabel>When</RowLabel>
              {/* Horizon presets */}
              <div className="flex gap-0.5">
                {PRESETS.map(({ id, label }) => (
                  <Button
                    key={id}
                    type="button"
                    size="sm"
                    variant={f.preset === id ? "default" : "ghost"}
                    onClick={() => f.applyPreset(id)}
                    className={f.preset === id ? "font-bold" : ""}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {/* Date range picker */}
              <DateRangePicker
                from={f.availFrom}
                to={f.availTo}
                mobile={props.isMobile}
                onChange={f.setDates}
              />
              {/* Weekends-only pill — locked when preset is this_weekend */}
              <Button
                type="button"
                size="sm"
                variant={f.weekendsOnly ? "default" : "ghost"}
                disabled={f.preset === "this_weekend"}
                onClick={() => f.setWeekendsOnly((v) => !v)}
                className={f.weekendsOnly ? "font-bold" : ""}
                title={f.preset === "this_weekend" ? "Locked on for This weekend preset" : undefined}
              >
                Weekends only
              </Button>
            </div>
          </div>

          {/* Row 2: Min stay + Near */}
          <div>
            <div className="flex flex-wrap items-start gap-6">
              {/* Min stay */}
              <div className="flex items-center gap-2">
                <RowLabel>Min stay</RowLabel>
                {MIN_STAY_OPTIONS.map(({ value, label }) => (
                  <Button
                    key={String(value)}
                    type="button"
                    size="sm"
                    variant={f.minNights === value ? "default" : "ghost"}
                    onClick={() => f.setMinNights(value)}
                    className={f.minNights === value ? "font-bold" : ""}
                  >
                    {label}
                  </Button>
                ))}
              </div>

              {/* Near */}
              <div className="flex flex-wrap items-center gap-2">
                <RowLabel>Near</RowLabel>
                <form
                  onSubmit={(e) => { e.preventDefault(); void f.handleGeocode(); }}
                  className="flex items-center gap-1"
                >
                  <input
                    className="w-36 rounded-md border px-2 py-1 text-xs"
                    placeholder="City or place…"
                    value={f.locationQuery}
                    onChange={(e) => {
                      f.setLocationQuery(e.target.value);
                      if (!e.target.value) {
                        f.setResolvedLocation(null);
                        f.setGeocodeError(null);
                      }
                    }}
                  />
                  <Button type="submit" size="sm" variant="ghost" disabled={f.geocoding}>
                    {f.geocoding ? "Searching…" : "Search"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={f.handleCurrentLocation}>
                    📍 Use my location
                  </Button>
                </form>

                {f.resolvedLocation && (
                  <span className="whitespace-nowrap text-[11px] text-green-600">
                    ✓ {f.resolvedLocation.name}
                  </span>
                )}
                {f.geocodeError && (
                  <span className="text-[11px] text-red-500">{f.geocodeError}</span>
                )}

                {/* Distance pills — disabled until location resolves */}
                <div className="flex gap-0.5">
                  {DISTANCES.map((d) => {
                    const active = f.distanceMiles === d && f.resolvedLocation !== null;
                    const distLabel = d === null ? "Any" : `${d} mi`;
                    const disabled = d !== null && !f.resolvedLocation;
                    return (
                      <Button
                        key={String(d)}
                        type="button"
                        size="sm"
                        variant={active ? "default" : "ghost"}
                        disabled={disabled ?? false}
                        onClick={() => {
                          if (d === null) {
                            f.setDistanceMiles(null);
                            f.setGeocodeError(null);
                            return;
                          }
                          if (!f.resolvedLocation) return;
                          f.setDistanceMiles(d);
                        }}
                        className={[
                          active ? "font-bold" : "",
                          disabled ? "opacity-50" : "",
                        ].join(" ")}
                      >
                        {distLabel}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Taxonomy filters */}
          <div>
            <SiteFilterPanel state={f.taxonomy} onChange={f.setTaxonomy} dense />
          </div>

          {/* Mobile: Show parks button */}
          {props.isMobile && (
            <Button
              type="button"
              variant="default"
              className="mt-2 w-full"
              onClick={props.onToggleFilters}
            >
              Show {props.matchCount} park{props.matchCount !== 1 ? "s" : ""}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
