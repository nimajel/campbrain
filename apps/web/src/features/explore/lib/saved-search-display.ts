import type { SavedSearch, SavedSearchScope, SavedSearchDatePattern } from "@campbrain/types";
import { REGION_LABELS } from "@campbrain/core";
import { formatIsoShort } from "./format-date";

// ---------------------------------------------------------------------------
// Scope summary
// ---------------------------------------------------------------------------

export function scopeSummary(scope: SavedSearchScope): string {
  if (scope.region !== null) {
    return REGION_LABELS[scope.region];
  }
  if (scope.parkPageIds.length > 0) {
    return `${scope.parkPageIds.length} park${scope.parkPageIds.length !== 1 ? "s" : ""}`;
  }
  return "All parks";
}

export function datePatternSummary(pattern: SavedSearchDatePattern): string {
  if (pattern.kind === "fixed_range") {
    return `${formatIsoShort(pattern.from)} – ${formatIsoShort(pattern.to)}`;
  }
  return `Any weekend, next ${pattern.horizonDays} days`;
}

// ---------------------------------------------------------------------------
// Prefilled name suggestion when creating a search from /explore
// ---------------------------------------------------------------------------

export function suggestSearchName(
  region: string | null,
  from: string,
  to: string,
): string {
  const regionLabel = region ? (REGION_LABELS[region as keyof typeof REGION_LABELS] ?? region) : null;
  if (!from) return regionLabel ?? "My search";
  const fromLabel = formatIsoShort(from);
  const toLabel = to ? ` – ${formatIsoShort(to)}` : "";
  return regionLabel ? `${regionLabel} · ${fromLabel}${toLabel}` : `${fromLabel}${toLabel}`;
}

// ---------------------------------------------------------------------------
// Run URL — serialise a SavedSearch into a navigable URL
// ---------------------------------------------------------------------------

export function buildRunUrl(search: SavedSearch): string {
  const { scope, datePattern, filters } = search;

  const params = new URLSearchParams();
  params.set("savedSearch", search.id);

  // Scope
  if (scope.region !== null) params.set("region", scope.region);

  // Taxonomy filters
  if (filters.access.length) params.set("access", filters.access.join(","));
  if (filters.kinds.length) params.set("kinds", filters.kinds.join(","));
  if (filters.hide.length) params.set("hide", filters.hide.join(","));
  if (filters.minNights !== 1) params.set("minNights", String(filters.minNights));

  if (datePattern.kind === "fixed_range") {
    params.set("from", datePattern.from);
    params.set("to", datePattern.to);
    return `/explore?${params.toString()}`;
  }

  // any_weekend → /map with weekendsOnly=true
  params.set("weekendsOnly", "true");
  return `/map?${params.toString()}`;
}
