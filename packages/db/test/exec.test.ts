import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { rows } from "../src/queries/exec";
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
