import { EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCESS_GROUP, KIND_GROUP, HIDE_GROUP } from "@/lib/site-taxonomy";
import type { TaxonomyState, SiteAccess, SiteKind, HideTarget } from "@/lib/site-taxonomy";

interface Props {
  state: TaxonomyState;
  onChange: (next: TaxonomyState) => void;
  groups?: Array<"access" | "kinds" | "hide">;
  dense?: boolean;
}
function toggle<T extends string>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
function Pill({ label, active, hide, onClick }: { label: string; active: boolean; hide: boolean; onClick: () => void }) {
  const variant = active ? (hide ? "secondary" : "default") : "ghost";
  return (
    <Button type="button" size="sm" variant={variant} onClick={onClick} className={active ? "font-bold" : ""}>
      {active && hide ? <EyeOff className="size-3" /> : null}{label}
    </Button>
  );
}
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export default function SiteFilterPanel({ state, onChange, groups = ["access", "kinds", "hide"] }: Props) {
  return (
    <div className="flex flex-wrap gap-3.5">
      {groups.includes("access") && (
        <Group label={ACCESS_GROUP.label}>
          {ACCESS_GROUP.options.map((o) => (
            <Pill key={o.id} label={o.label} active={state.access.includes(o.id)} hide={false}
              onClick={() => onChange({ ...state, access: toggle<SiteAccess>(state.access, o.id) })} />
          ))}
        </Group>
      )}
      {groups.includes("kinds") && (
        <Group label={KIND_GROUP.label}>
          {KIND_GROUP.options.map((o) => (
            <Pill key={o.id} label={o.label} active={state.kinds.includes(o.id)} hide={false}
              onClick={() => onChange({ ...state, kinds: toggle<SiteKind>(state.kinds, o.id) })} />
          ))}
        </Group>
      )}
      {groups.includes("hide") && (
        <Group label={HIDE_GROUP.label}>
          {HIDE_GROUP.options.map((o) => (
            <Pill key={o.id} label={o.label} active={state.hide.includes(o.id)} hide
              onClick={() => onChange({ ...state, hide: toggle<HideTarget>(state.hide, o.id) })} />
          ))}
        </Group>
      )}
    </div>
  );
}
