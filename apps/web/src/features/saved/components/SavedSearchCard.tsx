import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/trpc";
import type { SavedSearch } from "@campbrain/types";
import {
  scopeSummary,
  datePatternSummary,
  buildRunUrl,
} from "@/features/explore/lib/saved-search-display";

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

function FilterChips({ filters }: { filters: SavedSearch["filters"] }) {
  const chips: string[] = [];
  if (filters.access.length)
    chips.push(filters.access.join(", ").replace(/_/g, "-"));
  if (filters.kinds.length) chips.push(filters.kinds.join(", "));
  if (filters.hide.length)
    chips.push(`hide: ${filters.hide.join(", ").replace(/_/g, "-")}`);
  if (filters.minNights > 1) chips.push(`${filters.minNights}+ nights`);
  if (chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c}
          className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          {c}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SavedSearchCard
// ---------------------------------------------------------------------------

interface Props {
  search: SavedSearch;
  onEdit(s: SavedSearch): void;
}

export function SavedSearchCard({ search, onEdit }: Props) {
  const qc = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.savedSearches.delete.mutate({ id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["savedSearches"] });
    },
  });

  const toggleAlertMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.savedSearches.toggleAlert.mutate({ id, enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["savedSearches"] });
    },
  });

  function handleDelete() {
    if (!window.confirm(`Delete "${search.name}"?`)) return;
    deleteMutation.mutate(search.id);
  }

  function handleToggleAlert() {
    toggleAlertMutation.mutate({
      id: search.id,
      enabled: !search.alertEnabled,
    });
  }

  const runUrl = buildRunUrl(search);
  const actionError = deleteMutation.error ?? toggleAlertMutation.error;

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {/* Alert status dot */}
        <div className="mt-1 shrink-0">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              search.alertEnabled ? "bg-green-500" : "bg-muted-foreground/30"
            }`}
            title={search.alertEnabled ? "Alert on" : "Alert off"}
          />
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{search.name}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {scopeSummary(search.scope)}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            {datePatternSummary(search.datePattern)}
          </div>
          <FilterChips filters={search.filters} />
        </div>
      </div>

      {/* Action row */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={runUrl}
          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Run
        </a>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => onEdit(search)}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={handleToggleAlert}
          disabled={toggleAlertMutation.isPending}
          title={
            search.alertEnabled
              ? "Turn off email alert (alert scan wired in Phase 2b)"
              : "Turn on email alert (alert scan wired in Phase 2b)"
          }
        >
          {search.alertEnabled ? "Alert on" : "Alert off"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
        >
          {deleteMutation.isPending ? "Deleting…" : "Delete"}
        </Button>
      </div>

      {actionError instanceof Error && (
        <p className="mt-2 text-[12px] text-destructive">{actionError.message}</p>
      )}
    </div>
  );
}
