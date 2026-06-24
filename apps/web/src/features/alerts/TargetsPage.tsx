import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTargets } from "./hooks/use-targets";
import { TargetCard } from "./components/TargetCard";
import { UpcomingWindows } from "./components/UpcomingWindows";
import { TargetModal } from "./TargetModal";
import type { Target } from "@campbrain/types";

export function TargetsPage() {
  const { targets, upcoming, isLoading, isError } = useTargets();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Target | null>(null);

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

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Booking Reminders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track when reservation windows open &mdash; 6 months before arrival at 8 AM PT
          for CA parks.
        </p>
      </div>

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
              <TargetCard key={t.id} target={t} onEdit={setEditing} />
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
