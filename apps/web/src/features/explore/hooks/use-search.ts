import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/trpc";
import type { AppRouter } from "@campbrain/api-client";
import type { inferRouterOutputs } from "@trpc/server";
import type { ExploreFilters } from "./use-explore-filters";

export type SearchResponse = inferRouterOutputs<AppRouter>["search"]["query"];

export function useSearch(
  filters: ExploreFilters,
): { data: SearchResponse | undefined; isFetching: boolean; error: unknown } {
  const { checkIn, checkOut, region, taxonomy } = filters;

  const enabled = Boolean(checkIn && checkOut && checkIn < checkOut);

  // Stable JSON snapshot so the queryKey only changes on real edits.
  const snapshot = useMemo(
    () =>
      JSON.stringify({
        from: checkIn,
        to: checkOut,
        region: region ?? null,
        access: taxonomy.access,
        kinds: taxonomy.kinds,
        hide: taxonomy.hide,
      }),
    [checkIn, checkOut, region, taxonomy],
  );

  const { data, isFetching, error } = useQuery({
    queryKey: ["search", snapshot],
    queryFn: () => api.search.query.query(JSON.parse(snapshot) as Parameters<typeof api.search.query.query>[0]),
    enabled,
    staleTime: 1000 * 60 * 5,
  });

  return { data, isFetching, error };
}
