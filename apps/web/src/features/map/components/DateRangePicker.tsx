import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";

function parseIso(iso: string): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}
function toIso(d: Date | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function label(from: string, to: string): string {
  const fmt = (iso: string) => parseIso(iso)!.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (!from) return "Pick dates…";
  return to ? `${fmt(from)} – ${fmt(to)}` : `${fmt(from)} →`;
}

export default function DateRangePicker({
  from, to, onChange, mobile = false,
}: { from: string; to: string; onChange: (from: string, to: string) => void; mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selected: DateRange | undefined = from ? { from: parseIso(from), to: parseIso(to) } : undefined;

  const calendar = (
    <Calendar
      mode="range"
      numberOfMonths={mobile ? 1 : 2}
      selected={selected}
      disabled={{ before: today }}
      onSelect={(range: DateRange | undefined, triggerDate: Date) => {
        if (from && to) {
          onChange(toIso(triggerDate), "");
          return;
        }
        onChange(toIso(range?.from), toIso(range?.to));
        if (range?.from && range?.to && range.from.getTime() !== range.to.getTime() && !mobile) {
          setOpen(false);
        }
      }}
    />
  );

  if (mobile) return <div className="rounded-md border bg-white p-2">{calendar}</div>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant={from ? "secondary" : "ghost"}>📅 {label(from, to)}</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">{calendar}</PopoverContent>
    </Popover>
  );
}
