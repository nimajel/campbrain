function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * Default /map date range: the upcoming Fri→Mon weekend span.
 * Saturday keeps the in-progress weekend (today→Mon); Sunday rolls to next weekend.
 */
export function upcomingWeekendRange(today: Date): { from: string; to: string } {
  const dow = today.getDay(); // 0=Sun … 5=Fri, 6=Sat
  if (dow === 6) {
    return { from: toIsoLocal(today), to: toIsoLocal(addDays(today, 2)) };
  }
  const daysToFriday = (5 - dow + 7) % 7;
  const friday = addDays(today, daysToFriday);
  return { from: toIsoLocal(friday), to: toIsoLocal(addDays(friday, 3)) };
}
