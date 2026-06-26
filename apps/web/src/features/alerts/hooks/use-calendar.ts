import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/trpc";
import { apiUrl } from "@/lib/env";
import type { CalendarConnectionStatus } from "@campbrain/types";

export interface UseCalendarResult {
  status: CalendarConnectionStatus | undefined;
  isLoading: boolean;
  connect(): void;
  disconnect(): void;
  disconnecting: boolean;
}

export function useCalendar(): UseCalendarResult {
  const qc = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["calendar", "status"],
    queryFn: () => api.calendar.status.query(),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.calendar.disconnect.mutate(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  function connect(): void {
    window.location.href = `${apiUrl}/api/calendar/connect`;
  }

  function disconnect(): void {
    disconnectMutation.mutate();
  }

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    connect,
    disconnect,
    disconnecting: disconnectMutation.isPending,
  };
}
