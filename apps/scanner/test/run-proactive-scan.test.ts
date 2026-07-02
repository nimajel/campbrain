import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AvailabilityWindowEntry, ParkCatalogEntry } from "@campbrain/core";

const { upsertEntry, evictExpired, refreshMaterializedView } = vi.hoisted(() => ({
  upsertEntry: vi.fn(async () => {}),
  evictExpired: vi.fn(async () => 0),
  refreshMaterializedView: vi.fn(async () => {}),
}));

vi.mock("@campbrain/db", () => ({ upsertEntry, evictExpired, refreshMaterializedView }));

import { runProactiveScan, type ScanProvider } from "../src/run-proactive-scan";

function park(id: string): ParkCatalogEntry {
  return {
    provider: "california-parks",
    parkName: `Park ${id}`,
    parkPageId: id,
    campgrounds: [{ id: "cg", name: "CG", sites: [{ id: "s1", name: "S1" }] }],
    defaultBookingRule: {
      type: "rolling_months_before",
      monthsBefore: 6,
      releaseTime: "08:00",
      timezone: "America/Los_Angeles",
      source: "known",
      confidence: "high",
    },
  };
}

function entry(id: string): AvailabilityWindowEntry {
  return {
    parkPageId: id,
    parkName: `Park ${id}`,
    windowStart: "2026-08-14",
    windowEnd: "2026-08-21",
    scannedAt: "2026-06-22T00:00:00Z",
    sourceUrl: "http://x",
    campgrounds: [],
  };
}

describe("runProactiveScan (orchestration)", () => {
  beforeEach(() => {
    upsertEntry.mockClear();
    evictExpired.mockClear();
    refreshMaterializedView.mockClear();
  });

  it("upserts non-null entries, skips nulls, evicts + refreshes once", async () => {
    const fakeDb = {} as never;
    // Fake provider: 1 window per park; park "1" returns an entry, park "2" returns null.
    const provider: ScanProvider = {
      generateCacheWindows: () => [{ windowStart: "2026-08-14", windowEnd: "2026-08-21" }],
      proactiveScanWindow: vi.fn(async (parkPageId: string) =>
        parkPageId === "1" ? entry("1") : null,
      ),
    };
    const sleep = vi.fn(async () => {});
    const summary = await runProactiveScan({
      db: fakeDb,
      parks: [park("1"), park("2")],
      provider,
      sleep,
      todayOverride: "2026-06-22",
      concurrency: 5,
    });
    expect(summary.windows).toBe(2);
    expect(summary.fetched).toBe(2);
    expect(summary.fetchErrors).toBe(1);
    expect(summary.cacheWrites).toBe(1);
    expect(upsertEntry).toHaveBeenCalledTimes(1);
    expect(upsertEntry).toHaveBeenCalledWith(fakeDb, entry("1"), "california-parks");
    expect(evictExpired).toHaveBeenCalledTimes(1);
    expect(refreshMaterializedView).toHaveBeenCalledTimes(1);
  });

  it("defaults providerId to california-parks when omitted", async () => {
    const provider: ScanProvider = {
      generateCacheWindows: () => [{ windowStart: "2026-08-14", windowEnd: "2026-08-21" }],
      proactiveScanWindow: vi.fn(async () => entry("1")),
    };
    await runProactiveScan({
      db: {} as never,
      parks: [park("1")],
      provider,
      todayOverride: "2026-06-22",
    });
    expect(upsertEntry).toHaveBeenCalledWith(expect.anything(), entry("1"), "california-parks");
  });

  it("threads a custom providerId into upsertEntry", async () => {
    const provider: ScanProvider = {
      generateCacheWindows: () => [{ windowStart: "2026-08-14", windowEnd: "2026-08-21" }],
      proactiveScanWindow: vi.fn(async () => entry("1")),
    };
    await runProactiveScan({
      db: {} as never,
      parks: [park("1")],
      provider,
      providerId: "recreation-gov",
      todayOverride: "2026-06-22",
    });
    expect(upsertEntry).toHaveBeenCalledWith(expect.anything(), entry("1"), "recreation-gov");
  });

  it("refreshMv: false skips the MV refresh (evict still runs)", async () => {
    const provider: ScanProvider = {
      generateCacheWindows: () => [{ windowStart: "2026-08-14", windowEnd: "2026-08-21" }],
      proactiveScanWindow: vi.fn(async () => entry("1")),
    };
    await runProactiveScan({
      db: {} as never,
      parks: [park("1")],
      provider,
      refreshMv: false,
      todayOverride: "2026-06-22",
    });
    expect(refreshMaterializedView).not.toHaveBeenCalled();
    expect(evictExpired).toHaveBeenCalledTimes(1);
  });

  it("refreshMv: true (default) runs the MV refresh", async () => {
    const provider: ScanProvider = {
      generateCacheWindows: () => [{ windowStart: "2026-08-14", windowEnd: "2026-08-21" }],
      proactiveScanWindow: vi.fn(async () => entry("1")),
    };
    await runProactiveScan({
      db: {} as never,
      parks: [park("1")],
      provider,
      refreshMv: true,
      todayOverride: "2026-06-22",
    });
    expect(refreshMaterializedView).toHaveBeenCalledTimes(1);
  });

  it("sleeps between batches but not after the last", async () => {
    const provider: ScanProvider = {
      generateCacheWindows: () => [{ windowStart: "2026-08-14", windowEnd: "2026-08-21" }],
      proactiveScanWindow: vi.fn(async () => entry("x")),
    };
    const sleep = vi.fn(async () => {});
    // 3 parks, concurrency 2 → batches of [2,1] → exactly 1 inter-batch sleep.
    await runProactiveScan({
      db: {} as never,
      parks: [park("1"), park("2"), park("3")],
      provider,
      sleep,
      concurrency: 2,
      todayOverride: "2026-06-22",
    });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("MV refresh failure is non-fatal", async () => {
    refreshMaterializedView.mockRejectedValueOnce(new Error("pg dead"));
    const provider: ScanProvider = {
      generateCacheWindows: () => [{ windowStart: "2026-08-14", windowEnd: "2026-08-21" }],
      proactiveScanWindow: vi.fn(async () => entry("1")),
    };
    const summary = await runProactiveScan({
      db: {} as never,
      parks: [park("1")],
      provider,
      todayOverride: "2026-06-22",
    });
    expect(summary.cacheWrites).toBe(1);
    expect(summary.fetchErrors).toBe(0);
  });

  it("'unsupported' is treated as a skip (fetchErrors++, no upsert)", async () => {
    const provider: ScanProvider = {
      generateCacheWindows: () => [{ windowStart: "2026-08-14", windowEnd: "2026-08-21" }],
      proactiveScanWindow: vi.fn(async () => "unsupported" as const),
    };
    const summary = await runProactiveScan({
      db: {} as never,
      parks: [park("1")],
      provider,
      todayOverride: "2026-06-22",
    });
    expect(summary.cacheWrites).toBe(0);
    expect(summary.fetchErrors).toBe(1);
    expect(upsertEntry).not.toHaveBeenCalled();
  });

  it("honors the fake provider's proactiveConcurrency/batchDelayMs when deps don't override them", async () => {
    const provider: ScanProvider = {
      generateCacheWindows: () => [{ windowStart: "2026-08-14", windowEnd: "2026-08-21" }],
      proactiveScanWindow: vi.fn(async () => entry("x")),
      proactiveConcurrency: 1,
      batchDelayMs: 1_500,
    };
    const sleep = vi.fn(async () => {});
    // 3 parks, provider concurrency 1 (no override) → batches of [1,1,1] → 2 inter-batch sleeps of 1500ms.
    await runProactiveScan({
      db: {} as never,
      parks: [park("1"), park("2"), park("3")],
      provider,
      sleep,
      todayOverride: "2026-06-22",
    });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_500);
  });
});
