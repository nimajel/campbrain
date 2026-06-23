import { createFileRoute } from "@tanstack/react-router";
import { ExplorePage } from "@/features/explore/ExplorePage";
import { ALL_REGIONS } from "@campbrain/core";
import type { CampRegion } from "@campbrain/core";
import type { SiteAccess, SiteKind, HideTarget } from "@/lib/site-taxonomy";

// ---------------------------------------------------------------------------
// Search-param validation
// ---------------------------------------------------------------------------
// Parses URL search params into typed seed values that ExplorePage accepts.
// Access/kinds/hide come from buildRunUrl as comma-separated strings.

const VALID_REGIONS: ReadonlySet<string> = new Set<string>(ALL_REGIONS);

function parseCsvEnum<T extends string>(
  raw: unknown,
  valid: ReadonlySet<string>,
): T[] {
  if (typeof raw !== "string" || raw === "") return [];
  return raw
    .split(",")
    .filter((v) => valid.has(v)) as T[];
}

const VALID_ACCESS: ReadonlySet<string> = new Set<SiteAccess>([
  "drive_in",
  "hike_in",
  "boat_in",
]);
const VALID_KINDS: ReadonlySet<string> = new Set<SiteKind>([
  "tent",
  "hookup",
  "cabin",
]);
const VALID_HIDE: ReadonlySet<string> = new Set<HideTarget>([
  "group",
  "equestrian",
  "walk_up",
]);

interface ExploreSearch {
  from?: string;
  to?: string;
  region?: CampRegion | null;
  access?: SiteAccess[];
  kinds?: SiteKind[];
  hide?: HideTarget[];
  minNights?: 1 | 2 | 3;
  savedSearch?: string;
}

function parseMinNights(raw: unknown): 1 | 2 | 3 | undefined {
  const n = Number(raw);
  if (n === 1 || n === 2 || n === 3) return n;
  return undefined;
}

function validateSearch(raw: Record<string, unknown>): ExploreSearch {
  const region =
    typeof raw.region === "string" && VALID_REGIONS.has(raw.region)
      ? (raw.region as CampRegion)
      : null;

  return {
    from: typeof raw.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.from)
      ? raw.from
      : undefined,
    to: typeof raw.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.to)
      ? raw.to
      : undefined,
    region: region ?? undefined,
    access: parseCsvEnum<SiteAccess>(raw.access, VALID_ACCESS),
    kinds: parseCsvEnum<SiteKind>(raw.kinds, VALID_KINDS),
    hide: parseCsvEnum<HideTarget>(raw.hide, VALID_HIDE),
    minNights: parseMinNights(raw.minNights),
    savedSearch:
      typeof raw.savedSearch === "string" ? raw.savedSearch : undefined,
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/explore")({
  validateSearch,
  component: ExplorePageRoute,
});

function ExplorePageRoute() {
  const search = Route.useSearch();
  return <ExplorePage seed={search} />;
}
