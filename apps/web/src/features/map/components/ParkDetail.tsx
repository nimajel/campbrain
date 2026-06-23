import { useState, useMemo } from "react";
import type {
  MapPark,
  AvailableDateEntry,
  AvailableDateCampground,
  WeekendEntry,
  WeekendCampground,
} from "@campbrain/core";
import { useParkAvailability } from "../hooks/use-park-availability";
import { selectWeekendTiers, intersectConsecutiveDates } from "../lib/stay-tiers";
import { injectBookingDates } from "../lib/booking-url";
import { formatSiteName } from "../lib/site-display";
import { formatDate, relativeDate, relativeTime, rangeHasWeekendDay } from "../lib/map-utils";
import { isTaxonomyDefault, type TaxonomyState } from "../lib/site-taxonomy";
import type { MinNights } from "../lib/types";

// ---------------------------------------------------------------------------
// Inner presentational components
// ---------------------------------------------------------------------------

function SiteChips({
  sites,
  max = 6,
  muted = false,
}: {
  sites: string[];
  max?: number;
  muted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (sites.length === 0) return null;
  const shown = expanded ? sites : sites.slice(0, max);
  const hidden = sites.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1 items-center flex-1 min-w-0">
      {shown.map((s) => {
        const name = formatSiteName(s);
        return (
          <span
            key={s}
            title={name}
            className={[
              "inline-block px-1.5 py-0.5 rounded text-[11px] leading-tight",
              "bg-gray-100 text-gray-700 border border-gray-200",
              muted ? "opacity-75" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {name}
          </span>
        );
      })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-block px-1.5 py-0.5 rounded text-[11px] leading-tight bg-gray-100 text-blue-600 border border-gray-200 cursor-pointer hover:bg-gray-200"
        >
          +{hidden} more
        </button>
      )}
      {expanded && sites.length > max && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="inline-block px-1.5 py-0.5 rounded text-[11px] leading-tight bg-gray-100 text-blue-600 border border-gray-200 cursor-pointer hover:bg-gray-200"
        >
          less
        </button>
      )}
    </div>
  );
}

function BookLink({
  url,
  arrival,
  nights,
}: {
  url?: string;
  arrival: string;
  nights: number;
}) {
  if (!url) return null;
  return (
    <a
      href={injectBookingDates(url, arrival, nights)}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-auto shrink-0 text-[11px] px-2.5 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 no-underline font-medium"
    >
      Book
    </a>
  );
}

function TierLine({
  label,
  sites,
  url,
  arrival,
  nights,
  highlight = false,
}: {
  label: string;
  sites: string[];
  url?: string;
  arrival: string;
  nights: number;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 pl-2 mt-1">
      <span
        className={[
          "text-[11px] font-semibold whitespace-nowrap pt-0.5",
          highlight ? "text-emerald-600" : "text-gray-400",
        ].join(" ")}
      >
        {label}
      </span>
      <SiteChips sites={sites} />
      <BookLink url={url} arrival={arrival} nights={nights} />
    </div>
  );
}

function WalkUpLine({ sites }: { sites: string[] }) {
  if (sites.length === 0) return null;
  return (
    <div className="flex items-start gap-1.5 pl-2 mt-1">
      <span className="shrink-0 mt-0.5 text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded bg-gray-200 text-gray-500">
        walk-up
      </span>
      <SiteChips sites={sites} max={4} muted />
      <span className="text-[10.5px] italic text-gray-400 whitespace-nowrap pt-0.5">
        first-come, not reservable
      </span>
    </div>
  );
}

function DateRow({ entry, nights }: { entry: AvailableDateEntry; nights: number }) {
  const totalSites = entry.campgrounds.reduce((s, cg) => s + cg.availableSiteCount, 0);
  return (
    <div className="py-2 border-b border-gray-200 flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span
          className={[
            "font-semibold text-[13px]",
            entry.isWeekend ? "text-emerald-600" : "text-gray-800",
          ].join(" ")}
        >
          {entry.dayLabel}
          {entry.isWeekend && (
            <span className="text-[11px] font-normal text-emerald-600 ml-1.5">weekend</span>
          )}
        </span>
        <span className="text-[12px] text-gray-400">
          {totalSites} site{totalSites !== 1 ? "s" : ""} open
        </span>
      </div>
      {entry.campgrounds.map((cg: AvailableDateCampground) => (
        <div key={cg.name} className="text-[12px] text-gray-400 pl-2">
          <span className="text-gray-800">
            {cg.name}
            {cg.nightlyFee != null && (
              <span className="text-gray-400"> · ${cg.nightlyFee}/night</span>
            )}
          </span>
          {cg.sites.length > 0 && (
            <div className="flex items-start gap-2 mt-0.5">
              <SiteChips sites={cg.sites} />
              <BookLink url={cg.bookingUrl} arrival={entry.date} nights={nights} />
            </div>
          )}
          <WalkUpLine sites={cg.walkUpSites} />
        </div>
      ))}
    </div>
  );
}

function WeekendRow({
  entry,
  minNights,
}: {
  entry: WeekendEntry;
  minNights: MinNights;
}) {
  const show3Night = minNights !== 1;
  const show2Night = minNights !== 1 && minNights !== 3;

  const hasFull3Night = show3Night && entry.campgrounds.some((cg) => cg.sites3Night.length > 0);
  const has2NightFri = show2Night && entry.campgrounds.some((cg) => cg.sites2NightFri.length > 0);
  const has2NightSat = show2Night && entry.campgrounds.some((cg) => cg.sites2NightSat.length > 0);

  const hasAnyVisible = entry.campgrounds.some((cg) => {
    const flags = selectWeekendTiers(cg, minNights);
    return (
      flags.line3 ||
      flags.line2Fri ||
      flags.line2Sat ||
      flags.line1Fri ||
      flags.line1Sat ||
      cg.walkUpSites.length > 0
    );
  });
  if (!hasAnyVisible) return null;

  const label = `Weekend of ${formatDate(entry.fridayDate)}`;

  return (
    <div className="bg-emerald-50/50 border border-emerald-200/60 rounded-md px-3 py-2.5 mb-2">
      <div className="flex justify-between items-center mb-1.5">
        <span className="font-semibold text-[13px] text-emerald-600">{label}</span>
        <div className="flex gap-1.5">
          {hasFull3Night && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
              Fri–Mon
            </span>
          )}
          {has2NightFri && !hasFull3Night && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
              Fri–Sun
            </span>
          )}
          {has2NightSat && !hasFull3Night && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
              Sat–Mon
            </span>
          )}
        </div>
      </div>

      {entry.campgrounds.map((cg: WeekendCampground) => {
        const fri = entry.fridayDate;
        const sat = entry.saturdayDate;
        const flags = selectWeekendTiers(cg, minNights);
        const { line3, line2Fri, line2Sat, line1Fri, line1Sat } = flags;

        const hasBookable = line3 || line2Fri || line2Sat || line1Fri || line1Sat;
        if (!hasBookable && cg.walkUpSites.length === 0) return null;

        return (
          <div key={cg.name} className="mb-2">
            <div className="text-[12px] font-semibold text-gray-800">
              {cg.name}
              {cg.nightlyFee != null && (
                <span className="font-normal text-gray-400"> · ${cg.nightlyFee}/night</span>
              )}
            </div>
            {line3 && (
              <TierLine
                label="Fri–Mon · 3 nights"
                sites={cg.sites3Night}
                url={cg.bookingUrl}
                arrival={fri}
                nights={3}
                highlight
              />
            )}
            {line2Fri && (
              <TierLine
                label="Fri–Sun · 2 nights"
                sites={cg.sites2NightFri}
                url={cg.bookingUrl}
                arrival={fri}
                nights={2}
              />
            )}
            {line2Sat && (
              <TierLine
                label="Sat–Mon · 2 nights"
                sites={cg.sites2NightSat}
                url={cg.bookingUrl}
                arrival={sat}
                nights={2}
              />
            )}
            {line1Fri && (
              <TierLine
                label="Fri · 1 night"
                sites={cg.sites1NightFri}
                url={cg.bookingUrl}
                arrival={fri}
                nights={1}
              />
            )}
            {line1Sat && (
              <TierLine
                label="Sat · 1 night"
                sites={cg.sites1NightSat}
                url={cg.bookingUrl}
                arrival={sat}
                nights={1}
              />
            )}
            <WalkUpLine sites={cg.walkUpSites} />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state helper
// ---------------------------------------------------------------------------

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center text-[13px] text-gray-400">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ParkDetail panel
// ---------------------------------------------------------------------------

interface Props {
  park: MapPark;
  onClose: () => void;
  taxonomy: TaxonomyState;
  minNights: MinNights;
  weekendsOnly: boolean;
  availFrom: string;
  availTo: string;
}

export default function ParkDetail({
  park,
  onClose,
  taxonomy,
  minNights,
  weekendsOnly,
  availFrom,
  availTo,
}: Props) {
  const { data, loading, error } = useParkAvailability({
    parkPageId: park.parkPageId,
    provider: park.provider,
    from: availFrom,
    to: availTo,
    taxonomy,
  });

  const processedDates = useMemo(
    () => (data ? intersectConsecutiveDates(data.nextAvailableDates, minNights) : []),
    [data, minNights],
  );

  const processedWeekends: WeekendEntry[] = data?.nextAvailableWeekends ?? [];
  const bookNights = Math.max(minNights ?? 1, 1);
  const noWeekendDays =
    weekendsOnly && !!availFrom && !!availTo && !rangeHasWeekendDay(availFrom, availTo);
  const taxonomyChanged = !isTaxonomyDefault(taxonomy);

  return (
    <>
      {/* Desktop panel */}
      <div className="hidden md:flex absolute right-4 top-4 bottom-4 z-[1000] w-[300px] flex-col overflow-y-auto rounded-lg border border-gray-200 bg-white p-[18px] shadow-lg">
        <ParkDetailContent
          park={park}
          onClose={onClose}
          data={data}
          loading={loading}
          error={error}
          processedDates={processedDates}
          processedWeekends={processedWeekends}
          bookNights={bookNights}
          weekendsOnly={weekendsOnly}
          noWeekendDays={noWeekendDays}
          taxonomyChanged={taxonomyChanged}
          minNights={minNights}
        />
      </div>

      {/* Mobile bottom sheet */}
      <div className="flex md:hidden fixed inset-x-0 bottom-0 z-[1000] max-h-[88%] flex-col rounded-t-2xl border-t border-gray-200 bg-white p-[18px] shadow-lg overflow-y-auto">
        <ParkDetailContent
          park={park}
          onClose={onClose}
          data={data}
          loading={loading}
          error={error}
          processedDates={processedDates}
          processedWeekends={processedWeekends}
          bookNights={bookNights}
          weekendsOnly={weekendsOnly}
          noWeekendDays={noWeekendDays}
          taxonomyChanged={taxonomyChanged}
          minNights={minNights}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared content (used in both desktop + mobile layouts)
// ---------------------------------------------------------------------------

import type { ParkAvailabilityResponse } from "@campbrain/core";

interface ContentProps {
  park: MapPark;
  onClose: () => void;
  data: ParkAvailabilityResponse | null;
  loading: boolean;
  error: boolean;
  processedDates: AvailableDateEntry[];
  processedWeekends: WeekendEntry[];
  bookNights: number;
  weekendsOnly: boolean;
  noWeekendDays: boolean;
  taxonomyChanged: boolean;
  minNights: MinNights;
}

function ParkDetailContent({
  park,
  onClose,
  data,
  loading,
  error,
  processedDates,
  processedWeekends,
  bookNights,
  weekendsOnly,
  noWeekendDays,
  taxonomyChanged,
  minNights,
}: ContentProps) {
  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2 shrink-0">
        <div>
          <h2 className="text-[15px] font-bold text-gray-900 m-0 leading-snug">{park.parkName}</h2>
          <div className="flex gap-2 mt-1 items-center">
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
              CA State Park
            </span>
            <span className="text-[12px] text-gray-400">
              {park.campgroundCount} campground{park.campgroundCount !== 1 ? "s" : ""} ·{" "}
              {park.siteCount} sites
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-gray-400 hover:text-gray-600 text-[16px] leading-none px-2 py-1 rounded hover:bg-gray-100"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      {/* Cache timestamp */}
      {data && (
        <div className="text-[12px] text-gray-400 mb-3 shrink-0">
          Cache as of {relativeTime(data.asOf)}
        </div>
      )}

      {/* No campground data */}
      {park.campgroundCount === 0 ? (
        <EmptyState>
          <p className="m-0">No campground data loaded yet.</p>
          <p className="text-[12px] mt-1 m-0">
            Run <code className="font-mono bg-gray-100 px-1 rounded">npm run catalog:refresh</code> to
            discover campgrounds.
          </p>
        </EmptyState>
      ) : (
        <>
          {/* Loading */}
          {loading && <EmptyState>Loading availability…</EmptyState>}

          {/* Error */}
          {error && (
            <div className="text-[13px] text-red-500">Failed to load availability.</div>
          )}

          {/* Done — weekends branch */}
          {data && weekendsOnly && (
            <>
              {noWeekendDays ? (
                <EmptyState>No weekend days in this date range.</EmptyState>
              ) : processedWeekends.length === 0 ? (
                <EmptyState>
                  {taxonomyChanged ? (
                    <>No weekends match your current filters.</>
                  ) : data.earliestAvailableDate ? (
                    <>
                      Fully booked through {relativeDate(data.earliestAvailableDate)}.
                      <br />
                      {minNights !== null && minNights >= 2 ? (
                        <span className="text-[12px]">
                          No {minNights}-night stay in this range.
                        </span>
                      ) : (
                        <span className="text-[12px] text-emerald-600">
                          Next opening: {formatDate(data.earliestAvailableDate)}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      No weekend availability in the cached windows.
                      <br />
                      <span className="text-[12px]">Worker scans every 2 hours.</span>
                    </>
                  )}
                </EmptyState>
              ) : (
                processedWeekends.map((w) => (
                  <WeekendRow key={w.fridayDate} entry={w} minNights={minNights} />
                ))
              )}
            </>
          )}

          {/* Done — dates branch */}
          {data && !weekendsOnly && (
            <>
              {processedDates.length === 0 ? (
                <EmptyState>
                  {taxonomyChanged ? (
                    <>No dates match your current filters.</>
                  ) : data.earliestAvailableDate ? (
                    <>
                      Fully booked through {relativeDate(data.earliestAvailableDate)}.
                      <br />
                      {minNights !== null && minNights >= 2 ? (
                        <span className="text-[12px]">
                          No {minNights}-night stay in this range.
                        </span>
                      ) : (
                        <span className="text-[12px] text-emerald-600">
                          Next opening: {formatDate(data.earliestAvailableDate)}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      No availability in the cached windows.
                      <br />
                      <span className="text-[12px]">Worker scans every 2 hours.</span>
                    </>
                  )}
                </EmptyState>
              ) : (
                <div>
                  {processedDates.map((d) => (
                    <DateRow key={d.date} entry={d} nights={bookNights} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
