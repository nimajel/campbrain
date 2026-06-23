import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/trpc";
import type { SavedSearch } from "@campbrain/types";
import { SavedSearchCard } from "./components/SavedSearchCard";
import { SaveSearchModal } from "@/features/explore/SaveSearchModal";

export function SavedPage() {
  const [editing, setEditing] = useState<SavedSearch | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["savedSearches"],
    queryFn: () => api.savedSearches.list.query(),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center text-sm text-muted-foreground">
        Loading&hellip;
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load saved searches."}
        </div>
      </div>
    );
  }

  const searches = data ?? [];

  if (searches.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No saved searches yet &mdash; filter on{" "}
          <a href="/explore" className="underline hover:text-foreground">
            Find Campsites
          </a>{" "}
          and hit <strong>Save this search</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Saved Searches</h1>
      <div className="flex flex-col gap-3">
        {searches.map((s) => (
          <SavedSearchCard key={s.id} search={s} onEdit={setEditing} />
        ))}
      </div>

      {editing !== null && (
        <SaveSearchModal
          open={true}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
