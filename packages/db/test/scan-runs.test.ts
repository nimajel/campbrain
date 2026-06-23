import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, dbReachable } from "./helpers";

describe("scan_runs table", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;

  beforeAll(() => {
    if (!hasDb) return;
    env = createTestDb();
  });

  afterAll(async () => {
    if (!env) return;
    await env.client`DELETE FROM scan_runs WHERE kind = 'test'`;
    await env.client.end();
  });

  it.skipIf(!hasDb)("accepts and reads back a scan_runs row", async () => {
    const id = crypto.randomUUID();
    await env!.db.execute(
      sql`INSERT INTO scan_runs (id, kind, started_at, status) VALUES (${id}, 'test', now(), 'running')`
    );
    const res = await env!.db.execute(
      sql`SELECT kind, status FROM scan_runs WHERE id = ${id}`
    );
    const rows = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    expect((rows[0] as { kind: string }).kind).toBe("test");
    expect((rows[0] as { status: string }).status).toBe("running");
  });
});
