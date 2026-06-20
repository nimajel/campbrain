import { describe, it, expect } from "vitest";
import { runWithConcurrency } from "./concurrency";

describe("runWithConcurrency", () => {
  it("runs all tasks and preserves input order", async () => {
    const order: number[] = [];
    const tasks = [10, 1, 5].map((ms, i) => async () => {
      await new Promise((r) => setTimeout(r, ms));
      order.push(i);
      return i;
    });
    const results = await runWithConcurrency(tasks, 2);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([0, 1, 2]);
    expect(order.length).toBe(3);
  });

  it("returns empty array for empty input", async () => {
    const results = await runWithConcurrency([], 2);
    expect(results).toEqual([]);
  });

  it("captures rejections without throwing", async () => {
    const tasks = [
      async () => 1,
      async () => { throw new Error("boom"); },
      async () => 3,
    ];
    const results = await runWithConcurrency(tasks, 3);
    expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(results[1]?.status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: 3 });
  });
});
