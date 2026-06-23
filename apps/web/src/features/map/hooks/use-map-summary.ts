import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/trpc";
import { buildAvailByPark } from "../lib/filter-derivations";
import type { TaxonomyState } from "@/lib/site-taxonomy";
import type { MinNights, ParkAvailabilitySummary } from "../lib/types";

interface SummaryArgs {
  availFrom: string;
  availTo: string;
  taxonomy: TaxonomyState;
  weekendsOnly: boolean;
  minNights: MinNights;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function useMapSummary(args: SummaryArgs): {
  availByPark: Map<string, ParkAvailabilitySummary> | null;
  loading: boolean;
} {
  // Stable JSON snapshot so the debounce + queryKey only change on real edits.
  const snapshot = useMemo(
    () => JSON.stringify({
      from: args.availFrom || undefined,
      to: args.availTo || undefined,
      weekendsOnly: args.weekendsOnly,
      access: args.taxonomy.access,
      kinds: args.taxonomy.kinds,
      hide: args.taxonomy.hide,
      minNights: args.minNights ?? undefined,
    }),
    [args.availFrom, args.availTo, args.weekendsOnly, args.taxonomy, args.minNights],
  );
  const debouncedSnapshot = useDebounced(snapshot, 400);

  const query = useQuery({
    queryKey: ["map", "summary", debouncedSnapshot],
    queryFn: () => api.map.summary.query(JSON.parse(debouncedSnapshot)),
  });

  const availByPark = useMemo(
    () => buildAvailByPark(query.data?.parks ?? null),
    [query.data],
  );

  return { availByPark, loading: query.isFetching };
}
