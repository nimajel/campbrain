export type SiteAccess = "drive_in" | "hike_in" | "boat_in";
export type SiteKind = "tent" | "hookup" | "cabin";
export type HideTarget = "group" | "equestrian" | "walk_up";

export interface TaxonomyOption<T extends string> { id: T; label: string }
export interface TaxonomyGroup<T extends string> {
  param: "access" | "kinds" | "hide";
  label: string;
  variant: "select" | "hide";
  options: TaxonomyOption<T>[];
}

export const ACCESS_GROUP: TaxonomyGroup<SiteAccess> = {
  param: "access",
  label: "Access",
  variant: "select",
  options: [
    { id: "drive_in", label: "Drive-in" },
    { id: "hike_in", label: "Hike-in" },
    { id: "boat_in", label: "Boat-in" },
  ],
};

export const KIND_GROUP: TaxonomyGroup<SiteKind> = {
  param: "kinds",
  label: "Site kind",
  variant: "select",
  options: [
    { id: "tent", label: "Tent" },
    { id: "hookup", label: "Hookups (RV)" },
    { id: "cabin", label: "Cabin / yurt" },
  ],
};

export const HIDE_GROUP: TaxonomyGroup<HideTarget> = {
  param: "hide",
  label: "Hide",
  variant: "hide",
  options: [
    { id: "group", label: "Group" },
    { id: "equestrian", label: "Equestrian" },
    { id: "walk_up", label: "Walk-up (first-come)" },
  ],
};

export interface TaxonomyState {
  access: SiteAccess[];
  kinds: SiteKind[];
  hide: HideTarget[];
}

export const EMPTY_TAXONOMY: TaxonomyState = { access: [], kinds: [], hide: [] };

export function taxonomyToParams(state: TaxonomyState): URLSearchParams {
  const qp = new URLSearchParams();
  if (state.access.length) qp.set("access", state.access.join(","));
  if (state.kinds.length) qp.set("kinds", state.kinds.join(","));
  if (state.hide.length) qp.set("hide", state.hide.join(","));
  return qp;
}

export function isTaxonomyDefault(state: TaxonomyState): boolean {
  return state.access.length === 0 && state.kinds.length === 0 && state.hide.length === 0;
}
