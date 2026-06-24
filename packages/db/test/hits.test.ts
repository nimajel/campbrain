import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import { reconcileHits, listHitsToNotify, markNotified, getDashboardStats, getRecentOpenings } from "@campbrain/db";
import type { SavedSearch } from "@campbrain/types";
import type { SavedSearchOpening } from "@campbrain/db";

const URL = process.env["DATABASE_URL"] ?? "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";
async function dbReachable(): Promise<boolean> {
  try { const s = postgres(URL, { max: 1, onnotice: () => {}, connect_timeout: 2 }); await s`SELECT 1`; await s.end(); return true; } catch { return false; }
}
const SS_ID = "hits-test-search", USER = "hits-test-user";
function opening(siteName: string, arrival: string): SavedSearchOpening {
  return { savedSearchId: SS_ID, parkPageId: "606", parkName: "Park", campgroundName: "CG",
    siteName, arrivalDate: arrival, departureDate: arrival, nights: 1, bookingUrl: "https://b" };
}
const search = { id: SS_ID, userId: USER, provider: "california-parks" } as unknown as SavedSearch;

describe("hits reconcile + notify + dashboard (integration)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let db: ReturnType<typeof drizzle> | null = null;
  beforeAll(async () => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} }); db = drizzle(client, { schema });
    await client`DELETE FROM hits WHERE user_id = ${USER}`;
    await client`DELETE FROM saved_searches WHERE id = ${SS_ID}`;
    await client`DELETE FROM "user" WHERE id = ${USER}`;
    await client`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (${USER}, 'T', 'owner@example.com', true, now(), now())`;
    await client`INSERT INTO saved_searches (id, user_id, provider, name, definition, alert_enabled, email_enabled, created_at, updated_at)
      VALUES (${SS_ID}, ${USER}, 'california-parks', 'My alert', ${JSON.stringify({ scope: { region: null, parkPageIds: [] }, datePattern: { kind: "fixed_range", from: "2099-08-01", to: "2099-08-02" }, filters: { access: [], kinds: [], hide: [], minNights: 1 } })}::jsonb, true, true, now(), now())`;
  });
  afterAll(async () => { if (client) { await client`DELETE FROM hits WHERE user_id = ${USER}`; await client`DELETE FROM saved_searches WHERE id = ${SS_ID}`; await client`DELETE FROM "user" WHERE id = ${USER}`; await client.end(); } });

  const ARR = "2099-08-01";

  it.skipIf(!hasDb)("new → notify-once → reappear-no-renotify → disappear", async () => {
    const t1 = new Date().toISOString();
    const r1 = await reconcileHits(db as never, search, [opening("Site 1", ARR)], t1);
    expect(r1.newCount).toBe(1);

    const notify1 = await listHitsToNotify(db as never, "2099-01-01");
    const mine = notify1.filter((n) => n.userId === USER);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.email).toBe("owner@example.com");
    expect(mine[0]!.searchName).toBe("My alert");
    await markNotified(db as never, mine.map((n) => n.id), new Date().toISOString());

    const t2 = new Date(Date.now() + 1000).toISOString();
    const r2 = await reconcileHits(db as never, search, [opening("Site 1", ARR)], t2);
    expect(r2.newCount).toBe(0);
    expect((await listHitsToNotify(db as never, "2099-01-01")).filter((n) => n.userId === USER)).toHaveLength(0);

    const t3 = new Date(Date.now() + 2000).toISOString();
    await reconcileHits(db as never, search, [], t3);
    const stats = await getDashboardStats(db as never, USER);
    expect(stats.currentMatches).toBe(0);
    expect(stats.totalHits).toBe(1);
    expect(stats.activeAlerts).toBe(1);
    expect(await getRecentOpenings(db as never, USER, "2099-01-01")).toHaveLength(0);

    // t4: the same site reappears after disappearing → NOT a new hit, NOT re-notified
    //     (ON CONFLICT clears disappeared_at but preserves the earlier notified_at)
    const t4 = new Date(Date.now() + 3000).toISOString();
    const r4 = await reconcileHits(db as never, search, [opening("Site 1", ARR)], t4);
    expect(r4.newCount).toBe(0);
    expect((await listHitsToNotify(db as never, "2099-01-01")).filter((n) => n.userId === USER)).toHaveLength(0);
    // and it's a current match again now that it reappeared
    const stats4 = await getDashboardStats(db as never, USER);
    expect(stats4.currentMatches).toBe(1);
    expect(stats4.totalHits).toBe(1); // still the same single hit row, not a duplicate
  });
});
