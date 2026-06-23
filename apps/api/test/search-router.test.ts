import { describe, it, expect } from "vitest";
import { SearchInputSchema } from "@campbrain/types";

describe("SearchInputSchema", () => {
  it("accepts a minimal valid input and defaults the arrays", () => {
    const parsed = SearchInputSchema.parse({ from: "2026-08-01", to: "2026-08-03" });
    expect(parsed).toMatchObject({ from: "2026-08-01", to: "2026-08-03", access: [], kinds: [], hide: [], region: null });
  });
  it("accepts a full input", () => {
    const parsed = SearchInputSchema.parse({ from: "2026-08-01", to: "2026-08-03", access: ["drive_in"], kinds: ["tent"], hide: ["walk_up"], region: "bay-area" });
    expect(parsed.region).toBe("bay-area");
  });
  it("rejects a non-ISO date", () => {
    expect(SearchInputSchema.safeParse({ from: "08/01/2026", to: "2026-08-03" }).success).toBe(false);
  });
  it("rejects an unknown region", () => {
    expect(SearchInputSchema.safeParse({ from: "2026-08-01", to: "2026-08-03", region: "mars" }).success).toBe(false);
  });
  it("has no minNights field (search infers stay length from the date range)", () => {
    const parsed = SearchInputSchema.parse({ from: "2026-08-01", to: "2026-08-03" }) as Record<string, unknown>;
    expect("minNights" in parsed).toBe(false);
  });
});

import { beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { appRouter } from "../src/trpc/router";
import dayjs from "dayjs";

const URL =
  process.env["DATABASE_URL"] ??
  "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";

async function dbReachable(): Promise<boolean> {
  try {
    const s = postgres(URL, { max: 1, onnotice: () => {}, connect_timeout: 2 });
    await s`SELECT 1`;
    await s.end();
    return true;
  } catch {
    return false;
  }
}

describe("search router (integration)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let caller: ReturnType<typeof appRouter.createCaller> | null = null;

  beforeAll(() => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    const db = drizzle(client, { schema });
    caller = appRouter.createCaller({ db: db as never, auth: {} as never, session: null });
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  const from = dayjs().add(7, "day").format("YYYY-MM-DD");
  const to = dayjs().add(9, "day").format("YYYY-MM-DD");

  // Caller path is caller.search.query(...) because search is mounted as searchRouter
  // with a procedure named "query", giving client path api.search.query(input).
  it.skipIf(!hasDb)("search is public (no session) and returns the park-grouped shape", async () => {
    const res = await caller!.search.query({ from, to });
    expect(res).toHaveProperty("parks");
    expect(res).toHaveProperty("fallback");
    expect(Array.isArray(res.parks)).toBe(true);
    if (res.parks.length > 0) {
      const p = res.parks[0]!;
      expect(p).toHaveProperty("parkPageId");
      expect(p).toHaveProperty("region");
      expect(typeof p.totalAvailable).toBe("number");
    }
  });

  it.skipIf(!hasDb)("region filter narrows the result to that region", async () => {
    const all = await caller!.search.query({ from, to });
    const bay = await caller!.search.query({ from, to, region: "bay-area" });
    expect(bay.parks.every((p) => p.region === "bay-area")).toBe(true);
    expect(bay.parks.length).toBeLessThanOrEqual(all.parks.length);
  });
});
