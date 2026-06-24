import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/trpc";
import type { Target, TargetInput, TargetDatePattern } from "@campbrain/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TargetModalProps {
  open: boolean;
  onClose(): void;
  editing?: Target;
  onSaved?(): void;
}

// ---------------------------------------------------------------------------
// Date-pattern kind
// ---------------------------------------------------------------------------

type DpKind = TargetDatePattern["kind"];

// ---------------------------------------------------------------------------
// TargetModal
// ---------------------------------------------------------------------------

export function TargetModal({ open, onClose, editing, onSaved }: TargetModalProps) {
  const qc = useQueryClient();

  // -- name
  const [name, setName] = useState(editing?.name ?? "");

  // -- scope
  const [parkName, setParkName] = useState(editing?.scope.parkName ?? "");
  const [campgroundName, setCampgroundName] = useState(
    editing?.scope.campgroundName ?? ""
  );

  // -- date pattern
  const initKind: DpKind = editing?.datePattern.kind ?? "exact";
  const [dpKind, setDpKind] = useState<DpKind>(initKind);

  const [exactDate, setExactDate] = useState(
    editing?.datePattern.kind === "exact" ? editing.datePattern.date : ""
  );
  const [rangeFrom, setRangeFrom] = useState(
    editing?.datePattern.kind === "range" ? editing.datePattern.from : ""
  );
  const [rangeTo, setRangeTo] = useState(
    editing?.datePattern.kind === "range" ? editing.datePattern.to : ""
  );
  const [weekendsOnly, setWeekendsOnly] = useState(
    editing?.datePattern.kind === "range" ? editing.datePattern.weekendsOnly : false
  );
  const [rollingWeeks, setRollingWeeks] = useState(
    editing?.datePattern.kind === "rolling_weekends" ? editing.datePattern.weeks : 4
  );

  // -- booking rule
  const [bookingRuleOpen, setBookingRuleOpen] = useState(false);
  const [monthsBefore, setMonthsBefore] = useState(
    editing?.bookingRule.monthsBefore ?? 6
  );
  const [releaseTime, setReleaseTime] = useState(
    editing?.bookingRule.releaseTime ?? "08:00"
  );
  const [timezone, setTimezone] = useState(
    editing?.bookingRule.timezone ?? "America/Los_Angeles"
  );

  const [validationError, setValidationError] = useState<string | null>(null);

  // -- mutations
  const createMutation = useMutation({
    mutationFn: (payload: TargetInput) => api.targets.create.mutate(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["targets"] });
      onSaved?.();
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<TargetInput> }) =>
      api.targets.update.mutate({ id, patch }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["targets"] });
      onSaved?.();
      onClose();
    },
  });

  const saving = createMutation.isPending || updateMutation.isPending;
  const mutationError = createMutation.error ?? updateMutation.error;
  const errorMessage =
    validationError ??
    (mutationError instanceof Error
      ? mutationError.message
      : mutationError
        ? "Save failed"
        : null);

  function buildDatePattern(): TargetDatePattern | null {
    if (dpKind === "exact") {
      if (!exactDate) return null;
      return { kind: "exact", date: exactDate };
    }
    if (dpKind === "range") {
      if (!rangeFrom || !rangeTo || rangeFrom >= rangeTo) return null;
      return { kind: "range", from: rangeFrom, to: rangeTo, weekendsOnly };
    }
    return { kind: "rolling_weekends", weeks: rollingWeeks };
  }

  function handleSave() {
    if (!name.trim()) {
      setValidationError("Name is required.");
      return;
    }

    const datePattern = buildDatePattern();
    if (!datePattern) {
      setValidationError(
        dpKind === "exact"
          ? "Select an arrival date."
          : "Enter a valid date range."
      );
      return;
    }

    setValidationError(null);

    const payload: TargetInput = {
      userId: null,
      provider: editing?.provider ?? "california-parks",
      name: name.trim(),
      scope: {
        parkPageId: editing?.scope.parkPageId ?? null,
        parkName: parkName.trim() || null,
        campgroundName: campgroundName.trim() || null,
      },
      datePattern,
      bookingRule: {
        monthsBefore,
        releaseTime,
        timezone,
      },
      enabled: editing?.enabled ?? true,
      calendarEnabled: editing?.calendarEnabled ?? false,
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, patch: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="target-modal-title"
        className="w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
        style={{ maxHeight: "90dvh" }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 id="target-modal-title" className="mb-4 text-base font-semibold">
          {editing ? "Edit reminder" : "New booking reminder"}
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
              placeholder="e.g. Mt. Tamalpais · Labor Day weekend"
              className="rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          {/* Scope */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Park / campground (optional)
            </div>
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={parkName}
                onChange={(e) => setParkName(e.target.value)}
                placeholder="Park name (e.g. Mount Tamalpais SP)"
                className="rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                type="text"
                value={campgroundName}
                onChange={(e) => setCampgroundName(e.target.value)}
                placeholder="Campground name (optional)"
                className="rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Date pattern */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Date pattern
            </div>
            <div className="mb-3 flex gap-2">
              {(["exact", "range", "rolling_weekends"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDpKind(k)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    dpKind === k
                      ? "bg-primary text-primary-foreground"
                      : "border bg-background hover:bg-muted"
                  }`}
                >
                  {k === "exact"
                    ? "Exact date"
                    : k === "range"
                      ? "Date range"
                      : "Rolling weekends"}
                </button>
              ))}
            </div>

            {dpKind === "exact" && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">Arrival date</span>
                <input
                  type="date"
                  value={exactDate}
                  onChange={(e) => setExactDate(e.target.value)}
                  className="rounded-md border px-2 py-1 text-sm"
                />
              </label>
            )}

            {dpKind === "range" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground">From</span>
                    <input
                      type="date"
                      value={rangeFrom}
                      onChange={(e) => {
                        setRangeFrom(e.target.value);
                        if (rangeTo && e.target.value >= rangeTo) setRangeTo("");
                      }}
                      className="rounded-md border px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground">To</span>
                    <input
                      type="date"
                      value={rangeTo}
                      min={rangeFrom || undefined}
                      onChange={(e) => setRangeTo(e.target.value)}
                      className="rounded-md border px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={weekendsOnly}
                    onChange={(e) => setWeekendsOnly(e.target.checked)}
                    className="rounded border"
                  />
                  <span className="text-sm">Weekends only</span>
                </label>
              </div>
            )}

            {dpKind === "rolling_weekends" && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  Number of weekends to look ahead
                </span>
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={rollingWeeks}
                  onChange={(e) =>
                    setRollingWeeks(Math.max(1, Math.min(52, Number(e.target.value))))
                  }
                  className="w-24 rounded-md border px-2 py-1 text-sm"
                />
              </label>
            )}
          </div>

          {/* Booking rule (collapsible) */}
          <div className="border-t pt-3">
            <button
              type="button"
              onClick={() => setBookingRuleOpen((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              <span>{bookingRuleOpen ? "▾" : "▸"}</span>
              <span>Booking rule</span>
              {!bookingRuleOpen && (
                <span className="ml-1 font-normal normal-case">
                  — CA default: {monthsBefore}mo before at {releaseTime}
                </span>
              )}
            </button>

            {bookingRuleOpen && (
              <div className="mt-3 flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">
                    Months before arrival
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={monthsBefore}
                    onChange={(e) =>
                      setMonthsBefore(Math.max(1, Math.min(12, Number(e.target.value))))
                    }
                    className="w-24 rounded-md border px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">
                    Release time (HH:MM)
                  </span>
                  <input
                    type="time"
                    value={releaseTime}
                    onChange={(e) => setReleaseTime(e.target.value)}
                    className="w-32 rounded-md border px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">Timezone</span>
                  <input
                    type="text"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    placeholder="America/Los_Angeles"
                    className="rounded-md border px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
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
              {saving ? "Saving…" : editing ? "Save changes" : "Add reminder"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
