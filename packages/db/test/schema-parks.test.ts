import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { testDbUrl, dbReachable } from "./helpers";

describe("parks lat/lon columns", async () => {
  const hasDb = await dbReachable();
  let sql: ReturnType<typeof postgres> | null = null;
  beforeAll(() => { if (hasDb) sql = postgres(testDbUrl(), { max: 1, onnotice: () => {} }); });
  afterAll(async () => { if (sql) await sql.end(); });

  it.skipIf(!hasDb)("parks has latitude and longitude", async () => {
    const cols = await sql!`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'parks'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names).toEqual(expect.arrayContaining(["latitude", "longitude"]));
  });
});
