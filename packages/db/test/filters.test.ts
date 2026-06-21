import { describe, it, expect } from "vitest";
import { pgEnumArray, buildAvailabilityClauses } from "../src/queries/filters";

describe("pgEnumArray", () => {
  it("returns null for empty/undefined", () => {
    expect(pgEnumArray(undefined, ["a"])).toBeNull();
    expect(pgEnumArray([], ["a"])).toBeNull();
  });
  it("drops values not in the allowed set", () => {
    expect(pgEnumArray(["drive_in", "evil"], ["drive_in", "hike_in"])).toEqual(["drive_in"]);
  });
  it("returns null when nothing survives validation", () => {
    expect(pgEnumArray(["evil"], ["drive_in"])).toBeNull();
  });
});

describe("buildAvailabilityClauses", () => {
  it("includes the three base predicates by default", () => {
    const r = buildAvailabilityClauses({});
    expect(r.conds.length).toBe(3);
    expect(r.dowConds.length).toBe(0);
    expect(r.excludeWalkUp).toBe(false);
    expect(r.minNights).toBeUndefined();
  });
  it("adds from/to/access/kind predicates and the weekend DOW clause", () => {
    const r = buildAvailabilityClauses({
      from: "2026-07-01", to: "2026-07-31",
      access: ["hike_in"], kinds: ["tent"], weekendsOnly: true,
    });
    expect(r.conds.length).toBe(7);
    expect(r.dowConds.length).toBe(1);
  });
  it("sets excludeWalkUp for hide=walk_up and passes minNights through", () => {
    const r = buildAvailabilityClauses({ hide: ["walk_up"], minNights: 2 });
    expect(r.excludeWalkUp).toBe(true);
    expect(r.minNights).toBe(2);
    expect(r.conds.length).toBe(3);
  });
});
