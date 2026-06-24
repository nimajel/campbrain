import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/trpc";
import type { DashboardStats, RecentOpening } from "@campbrain/types";

interface UseDashboardResult {
  stats: DashboardStats | undefined;
  openings: RecentOpening[] | undefined;
  lastScan: { finishedAt: string } | null | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function useDashboard(): UseDashboardResult {
  const statsQuery = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: () => api.dashboard.stats.query(),
  });

  const openingsQuery = useQuery({
    queryKey: ["dashboard", "openings"],
    queryFn: () => api.dashboard.recentOpenings.query(),
  });

  const lastScanQuery = useQuery({
    queryKey: ["dashboard", "lastScan"],
    queryFn: () => api.dashboard.lastScan.query(),
  });

  return {
    stats: statsQuery.data,
    openings: openingsQuery.data,
    lastScan: lastScanQuery.data,
    isLoading:
      statsQuery.isLoading || openingsQuery.isLoading || lastScanQuery.isLoading,
    isError:
      statsQuery.isError || openingsQuery.isError || lastScanQuery.isError,
  };
}
