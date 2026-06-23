import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@campbrain/db/schema";
import {
  listSavedSearches, createSavedSearch, getSavedSearch,
  updateSavedSearch, deleteSavedSearch, setAlertEnabled,
} from "@campbrain/db";
import type { SavedSearchInput } from "@campbrain/types";

const URL =
  process.env["DATABASE_URL"] ??
  "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";

async function dbReachable(): Promise<boolean> {
  try {
    const s = postgres(URL, { max: 1, onnotice: () => {}, connect_timeout: 2 });
    await s`SELECT 1`; await s.end(); return true;
  } catch { return false; }
}

function input(name: string): SavedSearchInput {
  return {
    userId: null, // store overrides with the userId arg
    provider: "california-parks",
    name,
    scope: { region: null, parkPageIds: [] },
    datePattern: { kind: "fixed_range", from: "2026-08-01", to: "2026-08-03" },
    filters: { access: [], kinds: [], hide: [], minNights: 1 },
    alertEnabled: false,
    emailEnabled: true,
  };
}

describe("saved-search store (integration, user-scoped)", async () => {
  const hasDb = await dbReachable();
  let client: ReturnType<typeof postgres> | null = null;
  let db: ReturnType<typeof drizzle> | null = null;

  beforeAll(async () => {
    if (!hasDb) return;
    client = postgres(URL, { max: 1, onnotice: () => {} });
    db = drizzle(client, { schema });
    await client`DELETE FROM saved_searches WHERE user_id IN ('userA','userB')`;
  });
  afterAll(async () => {
    if (client) { await client`DELETE FROM saved_searches WHERE user_id IN ('userA','userB')`; await client.end(); }
  });

  it.skipIf(!hasDb)("create + list scopes to the owner", async () => {
    const a = await createSavedSearch(db as never, "userA", input("A search"));
    expect(a.id).toBeTruthy();
    await createSavedSearch(db as never, "userB", input("B search"));
    const listA = await listSavedSearches(db as never, "userA");
    expect(listA.map((s) => s.name)).toEqual(["A search"]);
  });

  it.skipIf(!hasDb)("get/update/delete enforce ownership (cross-user = not found)", async () => {
    const a = await createSavedSearch(db as never, "userA", input("Owned by A"));
    expect(await getSavedSearch(db as never, a.id, "userB")).toBeUndefined();
    await expect(updateSavedSearch(db as never, a.id, "userB", { name: "hijack" }))
      .rejects.toThrow();
    await deleteSavedSearch(db as never, a.id, "userB");
    expect((await getSavedSearch(db as never, a.id, "userA"))?.name).toBe("Owned by A");
    const upd = await updateSavedSearch(db as never, a.id, "userA", { name: "renamed" });
    expect(upd.name).toBe("renamed");
    await deleteSavedSearch(db as never, a.id, "userA");
    expect(await getSavedSearch(db as never, a.id, "userA")).toBeUndefined();
  });

  it.skipIf(!hasDb)("setAlertEnabled flips only the owner's row", async () => {
    const a = await createSavedSearch(db as never, "userA", input("toggle me"));
    await setAlertEnabled(db as never, a.id, "userB", true); // no-op (not owner)
    expect((await getSavedSearch(db as never, a.id, "userA"))?.alertEnabled).toBe(false);
    await setAlertEnabled(db as never, a.id, "userA", true);
    expect((await getSavedSearch(db as never, a.id, "userA"))?.alertEnabled).toBe(true);
    await deleteSavedSearch(db as never, a.id, "userA");
  });
});
