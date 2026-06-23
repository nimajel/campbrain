import type { CampRegion } from "@campbrain/core";
import { EMPTY_TAXONOMY } from "@/lib/site-taxonomy";
import type { SiteAccess, SiteKind, HideTarget } from "@/lib/site-taxonomy";
import SiteFilterPanel from "@/components/SiteFilterPanel";
import { useExploreFilters } from "./hooks/use-explore-filters";
import { useSearch } from "./hooks/use-search";
import RegionChips from "./components/RegionChips";
import ResultsList from "./components/ResultsList";
import FallbackDates from "./components/FallbackDates";
import { AuthGate } from "@/features/auth/AuthGate";
import { SaveSearchButton } from "./components/SaveSearchButton";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function minCheckOut(checkIn: string): string {
  if (!checkIn) return todayIso();
  const d = new Date(checkIn + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Seed type — mirrors the route validateSearch output
// ---------------------------------------------------------------------------

export interface ExploreSeed {
  from?: string;
  to?: string;
  region?: CampRegion | null;
  access?: SiteAccess[];
  kinds?: SiteKind[];
  hide?: HideTarget[];
  minNights?: 1 | 2 | 3;
  savedSearch?: string;
}

// ---------------------------------------------------------------------------
// ExplorePage
// ---------------------------------------------------------------------------

interface Props {
  seed?: ExploreSeed;
}

export function ExplorePage({ seed }: Props) {
  const {
    filters,
    setCheckIn,
    setCheckOut,
    setRegion,
    setTaxonomy,
    nights,
  } = useExploreFilters(seed);

  const { checkIn, checkOut, region, taxonomy } = filters;

  const { data, isFetching, error } = useSearch(filters);

  const showWalkUp = !taxonomy.hide.includes("walk_up");
  const hasActiveFilters =
    taxonomy.access.length > 0 || taxonomy.kinds.length > 0 || taxonomy.hide.length > 0;

  const walkUpOnlyParks = data ? data.parks.filter((p) => p.totalAvailable === 0) : [];

  return (
    <div className="mx-auto max-w-2xl">
      {/* Search form card */}
      <div className="mb-5 rounded-lg border bg-white p-4 shadow-sm">
        {/* Dates row */}
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Check-in
            </span>
            <input
              type="date"
              value={checkIn}
              min={todayIso()}
              onChange={(e) => setCheckIn(e.target.value)}
              className="rounded-md border px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Check-out
            </span>
            <input
              type="date"
              value={checkOut}
              min={minCheckOut(checkIn)}
              onChange={(e) => setCheckOut(e.target.value)}
              className="rounded-md border px-2 py-1 text-sm"
            />
          </label>
          {nights > 0 && (
            <span className="pb-1 text-[13px] text-muted-foreground">
              {nights} night{nights !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Region chips */}
        <div className="mb-4">
          <RegionChips value={region} onChange={setRegion} />
        </div>

        {/* Site filters */}
        <SiteFilterPanel state={taxonomy} onChange={setTaxonomy} />

        <AuthGate>
          <SaveSearchButton filters={filters} nights={nights} minNights={seed?.minNights ?? 1} />
        </AuthGate>
      </div>

      {/* Empty / loading states */}
      {!isFetching && !checkIn && !checkOut && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Pick a check-in and check-out date to see available campsites.
        </div>
      )}

      {!isFetching && checkIn !== "" && checkOut === "" && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Now pick a check-out date.
        </div>
      )}

      {isFetching && (
        <div className="py-8 text-center text-sm text-muted-foreground">Searching&hellip;</div>
      )}

      {Boolean(error) && !isFetching && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error instanceof Error ? error.message : "Search failed. Please try again."}
        </div>
      )}

      {/* Results — guarded by !isFetching, mirrors legacy !loading && data check */}
      {!isFetching && data && (
        <>
          {/* ResultsList handles both bookable parks and walk-up-only parks */}
          <ResultsList
            data={data}
            checkIn={checkIn}
            nights={nights}
            showWalkUp={showWalkUp}
          />

          {/* Fallback panel — server emits fallback when every park has totalAvailable=0 */}
          {data.fallback && (
            <div className="mt-4 rounded-lg border bg-muted/40 p-4 text-left">
              <p className="mb-2 font-semibold">
                {showWalkUp && walkUpOnlyParks.length > 0
                  ? "No reservable campsites — walk-up sites shown above."
                  : "No availability for those dates."}
              </p>

              {hasActiveFilters && (
                <p className="mb-3 text-[13px]">
                  Try removing some site filters — they may be hiding available sites.{" "}
                  <button
                    type="button"
                    className="text-[13px] underline underline-offset-2"
                    onClick={() => setTaxonomy(EMPTY_TAXONOMY)}
                  >
                    Clear filters
                  </button>
                </p>
              )}

              <FallbackDates
                alternateDates={data.fallback.alternateDates}
                region={region}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
