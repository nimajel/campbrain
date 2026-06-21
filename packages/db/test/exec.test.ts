import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { rows, type QueryDb } from "../src/queries/exec";
import { createTestDb, dbReachable } from "./helpers";

describe("rows() normalizer", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;
  beforeAll(() => { if (hasDb) env = createTestDb(); });
  afterAll(async () => { if (env) await env.client.end(); });

  it.skipIf(!hasDb)("returns a rows array from a SELECT", async () => {
    const r = await rows<{ n: number }>(env!.db, sql`SELECT 1 AS n`);
    expect(r).toEqual([{ n: 1 }]);
  });
});

describe("rows() shape normalization (pure)", () => {
  const q = sql`SELECT 1`;
  it("unwraps the neon-serverless { rows } shape", async () => {
    const db: QueryDb = { execute: async () => ({ rows: [{ n: 1 }, { n: 2 }] }) };
    expect(await rows<{ n: number }>(db, q)).toEqual([{ n: 1 }, { n: 2 }]);
  });
  it("returns the array shape (postgres-js) as-is", async () => {
    const db: QueryDb = { execute: async () => [{ n: 3 }] };
    expect(await rows<{ n: number }>(db, q)).toEqual([{ n: 3 }]);
  });
  it("returns [] for an unexpected/null shape instead of throwing", async () => {
    const db: QueryDb = { execute: async () => null };
    expect(await rows(db, q)).toEqual([]);
  });
});
