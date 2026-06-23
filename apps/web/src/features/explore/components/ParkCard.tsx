import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { REGION_LABELS } from "@campbrain/core";
import { injectBookingDates } from "@/lib/booking-url";
import type { SearchResponse } from "../hooks/use-search";

interface Props {
  park: SearchResponse["parks"][number];
  checkIn: string;
  nights: number;
  showWalkUp: boolean;
}

export default function ParkCard({ park, checkIn, nights, showWalkUp }: Props) {
  const [open, setOpen] = useState(false);
  const hasBookable = park.totalAvailable > 0;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") setOpen((v) => !v);
  }

  return (
    <div className="mb-2 rounded-lg border bg-white shadow-sm">
      {/* Header row — always rendered (perf: collapsed by default) */}
      <div
        className={[
          "flex cursor-pointer select-none items-center gap-2.5 px-4",
          open ? "py-2 pb-1" : "py-2",
        ].join(" ")}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <span
          className="shrink-0 text-[11px] text-muted-foreground transition-transform duration-150"
          style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
        <h3
          className={[
            "m-0 flex-1 text-sm",
            hasBookable ? "font-semibold" : "font-normal",
          ].join(" ")}
        >
          {park.parkName}
        </h3>
        <Badge variant="secondary" className="text-[10px]">
          {REGION_LABELS[park.region]}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {park.provider}
        </Badge>
        {hasBookable ? (
          <Badge className="bg-green-600 text-[10px] text-white hover:bg-green-600">
            {park.totalAvailable} site{park.totalAvailable !== 1 ? "s" : ""}
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px] opacity-60">
            walk-up only
          </Badge>
        )}
      </div>

      {/* Expanded detail — per-campground breakdown */}
      {open && (
        <div className="px-4 pb-3">
          {park.campgrounds.map((cg) => {
            const hasAvail = cg.availableSites.length > 0;
            const hasWalkUp = showWalkUp && cg.walkUpSites.length > 0;
            if (!hasAvail && !hasWalkUp) return null;

            return (
              <div key={cg.name} className="border-t py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 text-[13px] font-medium">{cg.name}</span>
                  {cg.nightlyFee !== null && (
                    <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                      ${cg.nightlyFee}/night &middot;{" "}
                      <strong className="text-foreground">
                        ${cg.nightlyFee * nights} total
                      </strong>
                    </span>
                  )}
                  {cg.bookingUrl && hasAvail && (
                    <Button
                      asChild
                      size="sm"
                      className="h-6 bg-green-600 text-[11px] text-white hover:bg-green-700"
                    >
                      <a
                        href={injectBookingDates(cg.bookingUrl, checkIn, nights)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Book ↗
                      </a>
                    </Button>
                  )}
                </div>

                {hasAvail && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {cg.availableSites.map((site) => (
                      <span
                        key={site}
                        className="rounded-sm bg-green-100 px-1.5 py-0.5 text-[11px] text-green-800"
                      >
                        {site}
                      </span>
                    ))}
                  </div>
                )}

                {hasWalkUp && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[9px]">
                      walk-up
                    </Badge>
                    {cg.walkUpSites.map((site) => (
                      <span
                        key={site}
                        className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] opacity-60"
                      >
                        {site}
                      </span>
                    ))}
                    <span className="text-[10px] italic text-muted-foreground">
                      first-come, not reservable
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
