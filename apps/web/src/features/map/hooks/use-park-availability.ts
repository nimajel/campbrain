import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/trpc";
import type { ParkAvailabilityResponse } from "@campbrain/core";
import type { TaxonomyState } from "@/lib/site-taxonomy";

interface Args {
  parkPageId: string | null;
  provider?: string;
  from: string;
  to: string;
  taxonomy: TaxonomyState;
}

export function useParkAvailability(args: Args): {
  data: ParkAvailabilityResponse | null;
  loading: boolean;
  error: boolean;
} {
  const { parkPageId, provider, from, to, taxonomy } = args;
  const input = {
    parkPageId: parkPageId ?? "",
    provider,
    from: from || undefined,
    to: to || undefined,
    access: taxonomy.access,
    kinds: taxonomy.kinds,
    hide: taxonomy.hide,
  };
  const query = useQuery({
    queryKey: ["map", "availability", input],
    queryFn: () => api.map.availability.query(input),
    enabled: parkPageId !== null,
  });
  return { data: query.data ?? null, loading: query.isLoading, error: query.isError };
}
