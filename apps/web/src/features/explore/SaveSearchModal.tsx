import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/trpc";
import type { SavedSearch, SavedSearchInput } from "@campbrain/types";
import type { CampRegion } from "@campbrain/core";
import type { SiteAccess, SiteKind, HideTarget } from "@/lib/site-taxonomy";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SaveSearchModalProps {
  open: boolean;
  onClose(): void;
  /** When set → savedSearches.update instead of create */
  editing?: SavedSearch;
  prefill?: {
    name: string;
    region: CampRegion | null;
    from: string;
    to: string;
    access: SiteAccess[];
    kinds: SiteKind[];
    hide: HideTarget[];
    minNights: 1 | 2 | 3;
  };
  onSaved?(saved: SavedSearch): void;
}

const HORIZON_OPTIONS: { value: number; label: string }[] = [
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
];

export function SaveSearchModal({
  open,
  onClose,
  editing,
  prefill,
  onSaved,
}: SaveSearchModalProps) {
  const qc = useQueryClient();

  // Derive initial values: editing takes precedence, then prefill, then defaults.
  const initName = editing?.name ?? prefill?.name ?? "";
  const initKind: "fixed_range" | "any_weekend" =
    editing?.datePattern.kind ?? (prefill?.from ? "fixed_range" : "any_weekend");
  const initFrom =
    editing?.datePattern.kind === "fixed_range"
      ? editing.datePattern.from
      : (prefill?.from ?? "");
  const initTo =
    editing?.datePattern.kind === "fixed_range"
      ? editing.datePattern.to
      : (prefill?.to ?? "");
  const initHorizon =
    editing?.datePattern.kind === "any_weekend"
      ? editing.datePattern.horizonDays
      : 90;
  const initAlert = editing?.alertEnabled ?? false;

  const [name, setName] = useState(initName);
  const [dateKind, setDateKind] = useState<"fixed_range" | "any_weekend">(initKind);
  const [from, setFrom] = useState(initFrom);
  const [to, setTo] = useState(initTo);
  const [horizonDays, setHorizonDays] = useState(initHorizon);
  const [alertEnabled, setAlertEnabled] = useState(initAlert);
  const [validationError, setValidationError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: SavedSearchInput) => api.savedSearches.create.mutate(payload),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["savedSearches"] });
      onSaved?.(saved);
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<SavedSearchInput> }) =>
      api.savedSearches.update.mutate({ id, patch }),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["savedSearches"] });
      onSaved?.(saved);
      onClose();
    },
  });

  const saving = createMutation.isPending || updateMutation.isPending;
  const mutationError = createMutation.error ?? updateMutation.error;
  const errorMessage =
    validationError ??
    (mutationError instanceof Error ? mutationError.message : mutationError ? "Save failed" : null);

  function handleSave() {
    if (!name.trim()) {
      setValidationError("Name is required.");
      return;
    }
    if (dateKind === "fixed_range" && (!from || !to || from >= to)) {
      setValidationError("Enter a valid date range.");
      return;
    }

    setValidationError(null);

    const scope = editing?.scope ?? {
      region: prefill?.region ?? null,
      parkPageIds: [],
    };

    const filters = editing?.filters ?? {
      access: prefill?.access ?? [],
      kinds: prefill?.kinds ?? [],
      hide: prefill?.hide ?? [],
      minNights: prefill?.minNights ?? 1,
    };

    const datePattern =
      dateKind === "fixed_range"
        ? { kind: "fixed_range" as const, from, to }
        : { kind: "any_weekend" as const, horizonDays };

    const payload: SavedSearchInput = {
      userId: null,
      provider: editing?.provider ?? "california-parks",
      name: name.trim(),
      scope,
      datePattern,
      filters,
      alertEnabled,
      emailEnabled: editing?.emailEnabled ?? true,
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, patch: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  if (!open) return null;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-search-title"
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 id="save-search-title" className="mb-4 text-base font-semibold">
          {editing ? "Edit saved search" : "Save this search"}
        </h2>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bay Area · Jul 4 weekend"
              className="rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          {/* Date-pattern toggle */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Date pattern
            </div>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setDateKind("fixed_range")}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  dateKind === "fixed_range"
                    ? "bg-primary text-primary-foreground"
                    : "border bg-background hover:bg-muted"
                }`}
              >
                Fixed dates
              </button>
              <button
                type="button"
                onClick={() => setDateKind("any_weekend")}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  dateKind === "any_weekend"
                    ? "bg-primary text-primary-foreground"
                    : "border bg-background hover:bg-muted"
                }`}
              >
                Any weekend
              </button>
            </div>

            {dateKind === "fixed_range" && (
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Check-in</span>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      if (to && e.target.value >= to) setTo("");
                    }}
                    className="rounded-md border px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Check-out</span>
                  <input
                    type="date"
                    value={to}
                    min={from || undefined}
                    onChange={(e) => setTo(e.target.value)}
                    className="rounded-md border px-2 py-1 text-sm"
                  />
                </label>
              </div>
            )}

            {dateKind === "any_weekend" && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">Look ahead</span>
                <select
                  value={horizonDays}
                  onChange={(e) => setHorizonDays(Number(e.target.value))}
                  className="rounded-md border px-2 py-1.5 text-sm"
                >
                  {HORIZON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Alert toggle */}
          <div className="border-t pt-3">
            <label className="flex cursor-pointer items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={alertEnabled}
                onClick={() => setAlertEnabled((v) => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                  alertEnabled ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    alertEnabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <span className="text-sm">Alert me by email when availability opens</span>
            </label>
            {alertEnabled && (
              <p className="mt-1.5 ml-12 text-[12px] text-muted-foreground">
                You&apos;ll receive an email when matching sites become available.
              </p>
            )}
          </div>

          {/* Error */}
          {errorMessage && (
            <div className="text-[13px] text-destructive">{errorMessage}</div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Save search"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
