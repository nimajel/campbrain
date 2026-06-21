import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { testDbUrl, dbReachable } from "./helpers";

describe("parks lat/lon columns", async () => {
  const hasDb = await dbReachable();
  let sql: ReturnType<typeof postgres> | null = null;
  beforeAll(() => { if (hasDb) sql = postgres(testDbUrl(), { max: 1, onnotice: () => {} }); });
  afterAll(async () => { if (sql) await sql.end(); });

  it.skipIf(!hasDb)("parks has latitude and longitude (double precision)", async () => {
    const cols = await sql!`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'parks' AND table_schema = 'public'
    `;
    const byName = new Map(cols.map((c) => [c.column_name, c.data_type]));
    expect(byName.has("latitude")).toBe(true);
    expect(byName.has("longitude")).toBe(true);
    expect(byName.get("latitude")).toBe("double precision");
    expect(byName.get("longitude")).toBe("double precision");
  });
});
