import { sql, type SQL } from "drizzle-orm";
import type { SiteAccess, SiteKind } from "@campbrain/core";

export type { SiteAccess, SiteKind };
export type HideTarget = "group" | "equestrian" | "walk_up";

/** Parameterized Postgres text[] literal of (already-validated) values, e.g. ARRAY['a','b']::text[]. */
export function sqlTextArray(values: string[]): SQL {
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

export interface AvailabilityClauseOptions {
  from?: string | null;
  to?: string | null;
  access?: SiteAccess[];
  kinds?: SiteKind[];
  hide?: HideTarget[];
  minNights?: 1 | 2 | 3;
  weekendsOnly?: boolean;
}

export interface AvailabilityClauseResult {
  /** Base predicates (status/date/day-use/range/access/kind/group/equestrian). */
  conds: SQL[];
  /** Day-of-week predicate(s); kept separate so the min-stay path can omit them. */
  dowConds: SQL[];
  /** True when walk-up sites should be excluded from counts. */
  excludeWalkUp: boolean;
  minNights?: 1 | 2 | 3;
}

const ACCESS_VALUES = ["drive_in", "hike_in", "boat_in"] as const;
const KIND_VALUES = ["tent", "hookup", "cabin"] as const;

/** Validate an enum list against the allowed set; returns the validated subset or null. */
export function pgEnumArray(values: string[] | undefined, allowed: readonly string[]): string[] | null {
  if (!values || values.length === 0) return null;
  const safe = values.filter((v) => allowed.includes(v));
  return safe.length === 0 ? null : safe;
}

/** Build parameterized availability predicates for `availability a JOIN sites s`. */
export function buildAvailabilityClauses(opts: AvailabilityClauseOptions): AvailabilityClauseResult {
  const { from, to, access, kinds, hide = [], minNights, weekendsOnly = false } = opts;

  const conds: SQL[] = [
    sql`a.status = 'available'`,
    sql`a.date >= CURRENT_DATE`,
    sql`s.is_day_use = false`,
  ];
  if (from) conds.push(sql`a.date >= ${from}::date`);
  if (to) conds.push(sql`a.date <= ${to}::date`);

  const accessArr = pgEnumArray(access, ACCESS_VALUES);
  if (accessArr) conds.push(sql`s.access = ANY(${sqlTextArray(accessArr)})`);

  const kindArr = pgEnumArray(kinds, KIND_VALUES);
  if (kindArr) conds.push(sql`s.site_kind = ANY(${sqlTextArray(kindArr)})`);

  let excludeWalkUp = false;
  for (const h of hide) {
    if (h === "group") conds.push(sql`NOT s.is_group`);
    else if (h === "equestrian") conds.push(sql`NOT s.is_equestrian`);
    else if (h === "walk_up") excludeWalkUp = true;
  }

  const dowConds: SQL[] = [];
  if (weekendsOnly) dowConds.push(sql`EXTRACT(DOW FROM a.date)::int IN (5, 6)`);

  const result: AvailabilityClauseResult = { conds, dowConds, excludeWalkUp };
  if (minNights) result.minNights = minNights;
  return result;
}
