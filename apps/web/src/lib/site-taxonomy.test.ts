import { describe, it, expect } from "vitest";
import {
  EMPTY_TAXONOMY, taxonomyToParams, isTaxonomyDefault,
  ACCESS_GROUP, KIND_GROUP, HIDE_GROUP,
} from "./site-taxonomy";

describe("taxonomyToParams", () => {
  it("emits no keys for the empty taxonomy", () => {
    expect([...taxonomyToParams(EMPTY_TAXONOMY).keys()]).toEqual([]);
  });
  it("joins each group as CSV", () => {
    const p = taxonomyToParams({ access: ["drive_in", "hike_in"], kinds: ["tent"], hide: ["walk_up"] });
    expect(p.get("access")).toBe("drive_in,hike_in");
    expect(p.get("kinds")).toBe("tent");
    expect(p.get("hide")).toBe("walk_up");
  });
  it("omits a group when its array is empty", () => {
    const p = taxonomyToParams({ access: ["boat_in"], kinds: [], hide: [] });
    expect(p.has("kinds")).toBe(false);
    expect(p.has("hide")).toBe(false);
  });
});

describe("isTaxonomyDefault", () => {
  it("true for EMPTY_TAXONOMY", () => {
    expect(isTaxonomyDefault(EMPTY_TAXONOMY)).toBe(true);
  });
  it("false when any group is non-empty", () => {
    expect(isTaxonomyDefault({ access: [], kinds: ["cabin"], hide: [] })).toBe(false);
  });
});

describe("taxonomy groups", () => {
  it("expose the expected option ids", () => {
    expect(ACCESS_GROUP.options.map((o) => o.id)).toEqual(["drive_in", "hike_in", "boat_in"]);
    expect(KIND_GROUP.options.map((o) => o.id)).toEqual(["tent", "hookup", "cabin"]);
    expect(HIDE_GROUP.options.map((o) => o.id)).toEqual(["group", "equestrian", "walk_up"]);
    expect(HIDE_GROUP.variant).toBe("hide");
  });
});
