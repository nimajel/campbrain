import { describe, it, expect } from "vitest";
import { generateWindowStarts, windowEnd, ttlMinutes, isEntryStale } from "./windows";

describe("window helpers", () => {
  it("generateWindowStarts steps by 8 days from today+2", () => {
    const starts = generateWindowStarts(16, "2026-01-01");
    expect(starts[0]).toBe("2026-01-03"); // today + 2
    expect(starts[1]).toBe("2026-01-11"); // + 8 days
    expect(starts.length).toBe(2);
  });
  it("windowEnd is 7 days after the start (8-day inclusive window)", () => {
    expect(windowEnd("2026-01-03")).toBe("2026-01-10");
  });
  it("ttlMinutes shrinks as the window approaches", () => {
    const now = new Date("2026-01-01T00:00:00Z").getTime();
    const soon = ttlMinutes("2026-01-03", now);
    const far = ttlMinutes("2026-06-01", now);
    expect(soon).toBeLessThan(far);
  });
  it("isEntryStale is true once the entry is older than its TTL", () => {
    const now = new Date("2026-01-01T00:00:00Z").getTime();
    const fresh = { windowStart: "2026-06-01", scannedAt: new Date(now - 60_000).toISOString() } as any;
    const stale = { windowStart: "2026-06-01", scannedAt: new Date(now - 1000 * 60 * 60 * 24).toISOString() } as any;
    expect(isEntryStale(fresh, now)).toBe(false);
    expect(isEntryStale(stale, now)).toBe(true);
  });
});
