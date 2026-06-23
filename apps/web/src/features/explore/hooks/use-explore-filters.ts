import { useState } from "react";
import type { CampRegion } from "@campbrain/core";
import type { TaxonomyState, SiteAccess, SiteKind, HideTarget } from "@/lib/site-taxonomy";

export interface ExploreFilters {
  checkIn: string;
  checkOut: string;
  region: CampRegion | null;
  taxonomy: TaxonomyState;
}

interface Seed {
  from?: string;
  to?: string;
  region?: CampRegion | null;
  access?: SiteAccess[];
  kinds?: SiteKind[];
  hide?: HideTarget[];
}

function diffDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const msPerDay = 86400000;
  const diff = new Date(to + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime();
  return Math.max(0, Math.round(diff / msPerDay));
}

export function useExploreFilters(seed?: Partial<Seed>): {
  filters: ExploreFilters;
  setCheckIn(v: string): void;
  setCheckOut(v: string): void;
  setRegion(v: CampRegion | null): void;
  setTaxonomy(v: TaxonomyState): void;
  nights: number;
} {
  const [checkIn, setCheckInRaw] = useState(seed?.from ?? "");
  const [checkOut, setCheckOut] = useState(seed?.to ?? "");
  const [region, setRegion] = useState<CampRegion | null>(seed?.region ?? null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyState>({
    access: seed?.access ?? [],
    kinds: seed?.kinds ?? [],
    hide: seed?.hide ?? [],
  });

  function setCheckIn(v: string) {
    setCheckInRaw(v);
    // Clear check-out if it would be on or before new check-in
    if (checkOut && v >= checkOut) setCheckOut("");
  }

  const nights = diffDays(checkIn, checkOut);

  const filters: ExploreFilters = { checkIn, checkOut, region, taxonomy };

  return { filters, setCheckIn, setCheckOut, setRegion, setTaxonomy, nights };
}
