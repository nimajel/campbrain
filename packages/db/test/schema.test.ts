import { describe, it, expect, beforeAll } from "vitest";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";

describe("schema migration", () => {
  let sql: ReturnType<typeof postgres>;
  beforeAll(() => { sql = postgres(url, { max: 1, onnotice: () => {} }); });

  it("creates the sites table with classification columns", async () => {
    const rows = await sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'sites'
    `;
    const cols = rows.map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(["is_walk_up", "is_day_use", "access", "site_kind"]));
  });

  it("creates the mv_available_stays materialized view", async () => {
    const rows = await sql`SELECT matviewname FROM pg_matviews WHERE matviewname = 'mv_available_stays'`;
    expect(rows.length).toBe(1);
  });

  it("creates the access_allowlist table", async () => {
    const rows = await sql`SELECT to_regclass('public.access_allowlist') AS t`;
    expect(rows[0]?.t).toBe("access_allowlist");
  });
});
