import { describe, it, expect } from "vitest";
import { expandStayWindows } from "./saved-search-match";
import type { SavedSearch } from "@campbrain/types";

function search(over: Partial<SavedSearch>): SavedSearch {
  return {
    id: "s1", userId: "u1", provider: "california-parks", name: "n",
    scope: { region: null, parkPageIds: [] },
    datePattern: { kind: "fixed_range", from: "2026-08-01", to: "2026-08-04" },
    filters: { access: [], kinds: [], hide: [], minNights: 2 },
    alertEnabled: true, emailEnabled: true,
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    ...over,
  } as SavedSearch;
}

describe("expandStayWindows", () => {
  it("fixed_range slides minNights windows across [from, to]", () => {
    const w = expandStayWindows(search({}), "2026-06-23");
    expect(w).toEqual([
      { from: "2026-08-01", to: "2026-08-03", nights: 2 },
      { from: "2026-08-02", to: "2026-08-04", nights: 2 },
    ]);
  });
  it("fixed_range with range shorter than minNights yields no windows", () => {
    expect(expandStayWindows(search({ datePattern: { kind: "fixed_range", from: "2026-08-01", to: "2026-08-02" }, filters: { access: [], kinds: [], hide: [], minNights: 2 } }), "2026-06-23")).toEqual([]);
  });
  it("any_weekend produces weekend arrivals within the horizon", () => {
    const w = expandStayWindows(search({ datePattern: { kind: "any_weekend", horizonDays: 14 }, filters: { access: [], kinds: [], hide: [], minNights: 2 } }), "2026-06-23");
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => x.nights >= 1)).toBe(true);
  });
});
