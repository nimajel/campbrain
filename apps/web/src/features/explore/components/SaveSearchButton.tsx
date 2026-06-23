import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { ExploreFilters } from "../hooks/use-explore-filters";
import { SaveSearchModal } from "../SaveSearchModal";
import { suggestSearchName } from "../lib/saved-search-display";
import type { SavedSearch } from "@campbrain/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SaveSearchButtonProps {
  filters: ExploreFilters;
  minNights: 1 | 2 | 3;
}

export function SaveSearchButton({ filters, minNights }: SaveSearchButtonProps) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const qc = useQueryClient();

  function handleSaved(saved: SavedSearch) {
    void qc.invalidateQueries({ queryKey: ["savedSearches"] });
    setConfirmation(`Saved: ${saved.name}`);
    setTimeout(() => setConfirmation(null), 3000);
  }

  const prefill = {
    name: suggestSearchName(filters.region, filters.checkIn, filters.checkOut),
    region: filters.region,
    from: filters.checkIn,
    to: filters.checkOut,
    access: filters.taxonomy.access,
    kinds: filters.taxonomy.kinds,
    hide: filters.taxonomy.hide,
    minNights,
  };

  return (
    <>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="outline" size="sm" type="button" onClick={() => setOpen(true)}>
          Save this search
        </Button>
        {confirmation && (
          <span className="text-[13px] text-green-700">{confirmation}</span>
        )}
      </div>

      <SaveSearchModal
        open={open}
        onClose={() => setOpen(false)}
        prefill={prefill}
        onSaved={handleSaved}
      />
    </>
  );
}
