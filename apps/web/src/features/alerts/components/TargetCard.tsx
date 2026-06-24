import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/trpc";
import type { Target, TargetDatePattern } from "@campbrain/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function datePatternSummary(dp: TargetDatePattern): string {
  if (dp.kind === "exact") {
    return new Date(dp.date + "T12:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  if (dp.kind === "range") {
    const from = new Date(dp.from + "T12:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const to = new Date(dp.to + "T12:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return dp.weekendsOnly ? `${from} – ${to} (weekends)` : `${from} – ${to}`;
  }
  return `Next ${dp.weeks} weekend${dp.weeks === 1 ? "" : "s"}`;
}

function scopeLabel(scope: Target["scope"]): string {
  return (
    [scope.parkName, scope.campgroundName].filter(Boolean).join(" — ") || "Any park"
  );
}

// ---------------------------------------------------------------------------
// TargetCard
// ---------------------------------------------------------------------------

interface Props {
  target: Target;
  onEdit(t: Target): void;
}

export function TargetCard({ target, onEdit }: Props) {
  const qc = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.targets.delete.mutate({ id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["targets"] });
    },
  });

  const setEnabledMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.targets.setEnabled.mutate({ id, enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["targets"] });
    },
  });

  function handleDelete() {
    if (!window.confirm(`Delete "${target.name}"?`)) return;
    deleteMutation.mutate(target.id);
  }

  function handleToggleEnabled() {
    setEnabledMutation.mutate({ id: target.id, enabled: !target.enabled });
  }

  const actionError = deleteMutation.error ?? setEnabledMutation.error;

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {/* Enabled status dot */}
        <div className="mt-1 shrink-0">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              target.enabled ? "bg-green-500" : "bg-muted-foreground/30"
            }`}
            title={target.enabled ? "Enabled" : "Disabled"}
          />
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{target.name}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {scopeLabel(target.scope)}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            {datePatternSummary(target.datePattern)}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Opens {target.bookingRule.monthsBefore}mo before arrival at{" "}
            {target.bookingRule.releaseTime} {target.bookingRule.timezone}
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => onEdit(target)}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={handleToggleEnabled}
          disabled={setEnabledMutation.isPending}
        >
          {target.enabled ? "Disable" : "Enable"}
        </Button>
        {/* Calendar toggle — inert until Phase 2b-3 */}
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled
          title="Calendar sync coming soon"
          className="cursor-not-allowed opacity-50"
        >
          {target.calendarEnabled ? "Calendar on" : "Calendar off"}
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
