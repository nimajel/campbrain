import { REGION_LABELS } from "@campbrain/core";
import type { CampRegion } from "@campbrain/core";
import type { SearchResponse } from "../hooks/use-search";
import { formatIsoShort } from "../lib/format-date";

interface Props {
  alternateDates: NonNullable<SearchResponse["fallback"]>["alternateDates"];
  region: CampRegion | null;
}

export default function FallbackDates({ alternateDates, region }: Props) {
  if (alternateDates.length === 0) {
    return (
      <p className="text-[13px]">
        No bookable availability found in the next 60 days for this region.
        Try expanding your region or date range.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-2 text-[13px] text-muted-foreground">
        Next bookable openings in{" "}
        {region ? REGION_LABELS[region] : "all regions"}:
      </p>
      {alternateDates.map((p) => (
        <div key={p.parkPageId} className="mb-1 text-[13px]">
          <strong>{p.parkName}</strong>{" "}
          <span className="text-muted-foreground">
            &mdash; openings from {formatIsoShort(p.earliestDate)}
          </span>
        </div>
      ))}
    </div>
  );
}
