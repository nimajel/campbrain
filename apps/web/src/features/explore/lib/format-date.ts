/**
 * Format an ISO date string (YYYY-MM-DD) into a short human-readable label
 * such as "Aug 1". Constructs a local-midnight Date (new Date(y, m-1, d)) to
 * avoid DST shift bugs that occur when parsing an ISO string as UTC midnight
 * in negative-offset time zones.
 */
export function formatIsoShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
