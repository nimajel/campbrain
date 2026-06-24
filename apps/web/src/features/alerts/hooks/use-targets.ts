import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/trpc";
import type { Target, UpcomingTarget } from "@campbrain/types";

export interface UseTargetsResult {
  targets: Target[] | undefined;
  upcoming: UpcomingTarget[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function useTargets(): UseTargetsResult {
  const listQuery = useQuery({
    queryKey: ["targets", "list"],
    queryFn: () => api.targets.list.query(),
  });

  const upcomingQuery = useQuery({
    queryKey: ["targets", "upcoming"],
    queryFn: () => api.targets.upcoming.query(),
  });

  return {
    targets: listQuery.data,
    upcoming: upcomingQuery.data,
    isLoading: listQuery.isLoading || upcomingQuery.isLoading,
    isError: listQuery.isError || upcomingQuery.isError,
  };
}
