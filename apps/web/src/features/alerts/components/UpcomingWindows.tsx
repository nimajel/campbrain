import type { UpcomingTarget, BookingWindow } from "@campbrain/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function friendlyDatetime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles",
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WindowRow({ window: w }: { window: BookingWindow }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">
          Arrival: {new Date(w.arrivalDate + "T12:00:00").toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
        <span className="text-[12px] text-muted-foreground">
          Window opens: {friendlyDatetime(w.bookingOpensAt)} PT
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>7 days before: {friendlyDatetime(w.reminders.sevenDaysBefore)}</span>
        <span>Night before: {friendlyDatetime(w.reminders.nightBefore)}</span>
        <span>10 min before: {friendlyDatetime(w.reminders.tenMinutesBefore)}</span>
      </div>
    </div>
  );
}

function TargetSection({ upcoming }: { upcoming: UpcomingTarget }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{upcoming.name}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {upcoming.scopeLabel}
        </span>
      </div>
      {upcoming.windows.map((w) => (
        <WindowRow key={w.arrivalDate} window={w} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UpcomingWindows
// ---------------------------------------------------------------------------

interface Props {
  upcoming: UpcomingTarget[];
}

export function UpcomingWindows({ upcoming }: Props) {
  if (upcoming.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/40 p-5 text-center text-sm text-muted-foreground">
        No upcoming booking windows &mdash; add a reminder below.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {upcoming.map((u) => (
        <TargetSection key={u.targetId} upcoming={u} />
      ))}
    </div>
  );
}
