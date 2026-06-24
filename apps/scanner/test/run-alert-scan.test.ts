import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { runAlertScan } from "../src/run-alert-scan";
import { latestAlertRun } from "@campbrain/db";
import dayjs from "dayjs";

const URL = process.env["DATABASE_URL"] ?? "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";
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
const SS = "alertscan-test";
const U = "alertscan-user";

describe("runAlertScan (integration)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let db: ReturnType<typeof drizzle> | null = null;
  const from = dayjs().add(7, "day").format("YYYY-MM-DD");
  const to = dayjs().add(8, "day").format("YYYY-MM-DD");

  beforeAll(async () => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });
    await client`DELETE FROM hits WHERE user_id = ${U}`;
    await client`DELETE FROM saved_searches WHERE id = ${SS}`;
    await client`DELETE FROM "user" WHERE id = ${U}`;
    await client`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${U}, 'T', 'a@b.c', true, now(), now())`;
    await client`INSERT INTO saved_searches (id, user_id, provider, name, definition, alert_enabled, email_enabled, created_at, updated_at)
      VALUES (${SS}, ${U}, 'california-parks', 'scan alert', ${JSON.stringify({
        scope: { region: null, parkPageIds: [] },
        datePattern: { kind: "fixed_range", from, to },
        filters: { access: [], kinds: [], hide: [], minNights: 1 },
      })}::jsonb, true, true, now(), now())`;
  });

  afterAll(async () => {
    if (client) {
      await client`DELETE FROM hits WHERE user_id = ${U}`;
      await client`DELETE FROM saved_searches WHERE id = ${SS}`;
      await client`DELETE FROM "user" WHERE id = ${U}`;
      await client.end();
    }
  });

  it.skipIf(!hasDb)("runs end-to-end, records a scan run, never throws", async () => {
    await runAlertScan({ db: db as never, dashboardUrl: "https://app/dashboard" });
    const latest = await latestAlertRun(db as never);
    expect(latest?.finishedAt).toBeTruthy();
  });
});
