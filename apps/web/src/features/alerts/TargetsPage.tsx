import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useTargets } from "./hooks/use-targets";
import { useCalendar } from "./hooks/use-calendar";
import { TargetCard } from "./components/TargetCard";
import { UpcomingWindows } from "./components/UpcomingWindows";
import { TargetModal } from "./TargetModal";
import type { Target } from "@campbrain/types";

function readCalendarParam(): "connected" | "error" | null {
  const params = new URLSearchParams(window.location.search);
  const v = params.get("calendar");
  if (v === "connected" || v === "error") return v;
  return null;
}

export function TargetsPage() {
  const { targets, upcoming, isLoading, isError } = useTargets();
  const { status: calendarStatus, isLoading: calendarLoading, connect, disconnect, disconnecting } =
    useCalendar();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Target | null>(null);
  const [calendarParam] = useState<"connected" | "error" | null>(readCalendarParam);
  const [paramDismissed, setParamDismissed] = useState(false);

  // Clear the ?calendar= param from the URL after mounting so a refresh
  // doesn't re-show the confirmation banner.
  useEffect(() => {
    if (calendarParam !== null) {
      const url = new URL(window.location.href);
      url.searchParams.delete("calendar");
      window.history.replaceState({}, "", url.toString());
    }
  }, [calendarParam]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center text-sm text-muted-foreground">
        Loading&hellip;
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load booking reminders. Please refresh or sign in again.
        </div>
      </div>
    );
  }

  const targetList = targets ?? [];
  const upcomingList = upcoming ?? [];
  const calendarConnected = !!calendarStatus?.connected;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Booking Reminders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track when reservation windows open &mdash; 6 months before arrival at 8 AM PT
          for CA parks.
        </p>
      </div>

      {/* Google Calendar connection panel */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Google Calendar</h2>

        {/* ?calendar= return banner */}
        {calendarParam !== null && !paramDismissed && (
          <div
            className={`mb-3 flex items-center justify-between rounded-lg border px-4 py-2 text-sm ${
              calendarParam === "connected"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-destructive/30 bg-destructive/5 text-destructive"
            }`}
          >
            <span>
              {calendarParam === "connected"
                ? "Calendar connected."
                : "Couldn't connect — try again."}
            </span>
            <button
              type="button"
              className="ml-4 text-xs opacity-60 hover:opacity-100"
              onClick={() => setParamDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          {calendarLoading ? (
            <p className="text-sm text-muted-foreground">Checking calendar status&hellip;</p>
          ) : calendarConnected ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-foreground">
                Google Calendar connected{" "}
                <span className="text-green-600">&#10003;</span>
                {calendarStatus?.connectedAt && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    since{" "}
                    {new Date(calendarStatus.connectedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={disconnect}
                disabled={disconnecting}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Connect your Google Calendar to get reminders when reservation windows open.
              </p>
              <Button type="button" size="sm" onClick={connect}>
                Connect Google Calendar
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Upcoming booking windows panel */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Upcoming booking windows
        </h2>
        <UpcomingWindows upcoming={upcomingList} />
      </section>

      {/* Reminders list */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Your reminders</h2>
          <Button
            type="button"
            size="sm"
            onClick={() => setCreating(true)}
          >
            + New reminder
          </Button>
        </div>

        {targetList.length === 0 ? (
          <div className="rounded-xl border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            No reminders yet &mdash; click <strong>+ New reminder</strong> to add one.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {targetList.map((t) => (
              <TargetCard
                key={t.id}
                target={t}
                onEdit={setEditing}
                calendarConnected={calendarConnected}
              />
            ))}
          </div>
        )}
      </section>

      {/* Create modal */}
      {creating && (
        <TargetModal
          open
          onClose={() => setCreating(false)}
        />
      )}

      {/* Edit modal */}
      {editing !== null && (
        <TargetModal
          open={true}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}
