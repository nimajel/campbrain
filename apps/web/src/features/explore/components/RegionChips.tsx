import { Button } from "@/components/ui/button";
import { ALL_REGIONS, REGION_LABELS } from "@campbrain/core";
import type { CampRegion } from "@campbrain/core";

interface Props {
  value: CampRegion | null;
  onChange(v: CampRegion | null): void;
}

export default function RegionChips({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Region</span>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={value === null ? "default" : "ghost"}
          onClick={() => onChange(null)}
          className={value === null ? "font-bold" : ""}
        >
          All
        </Button>
        {ALL_REGIONS.map((region) => (
          <Button
            key={region}
            type="button"
            size="sm"
            variant={value === region ? "default" : "ghost"}
            onClick={() => onChange(value === region ? null : region)}
            className={value === region ? "font-bold" : ""}
          >
            {value === region ? `✓ ${REGION_LABELS[region]}` : REGION_LABELS[region]}
          </Button>
        ))}
      </div>
    </div>
  );
}
