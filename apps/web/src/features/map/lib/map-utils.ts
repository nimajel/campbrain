export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function relativeDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const prev = new Date(y!, m! - 1, d!);
  prev.setDate(prev.getDate() - 1);
  return prev.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function isoDow(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).getDay();
}

export function rangeHasWeekendDay(from: string, to: string): boolean {
  if (!from || !to) return true;
  let cursor = from;
  while (cursor <= to) {
    const dow = isoDow(cursor);
    if (dow === 5 || dow === 6) return true;
    cursor = addDaysIso(cursor, 1);
  }
  return false;
}
