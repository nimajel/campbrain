import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, dbReachable } from "./helpers";
import { getParkDigest, upsertParkDigest } from "../src/queries/park-digest";
import type { ParkAvailabilityResponse } from "@campbrain/core";

const PROVIDER = "park-digest-test-provider";
const PARK = "pd-test-park";

describe("park_digests table", async () => {
  const hasDb = await dbReachable();
  let env: ReturnType<typeof createTestDb> | null = null;

  beforeAll(async () => {
    if (!hasDb) return;
    env = createTestDb();
    await env.client`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER}, 'Park Digest Test') ON CONFLICT DO NOTHING`;
    await env.client`INSERT INTO parks (provider_id, park_page_id, park_name) VALUES (${PROVIDER}, ${PARK}, 'Digest Test Park') ON CONFLICT DO NOTHING`;
  });

  afterAll(async () => {
    if (!env) return;
    await env.client`DELETE FROM park_digests WHERE provider = ${PROVIDER}`;
    await env.client`DELETE FROM parks WHERE provider_id = ${PROVIDER}`;
    await env.client`DELETE FROM providers WHERE provider_id = ${PROVIDER}`;
    await env.client.end();
  });

  it.skipIf(!hasDb)("inserts a park_digests row and reads back digest + site_class JSONB", async () => {
    const digest = { campgrounds: [{ id: "c1", name: "Campground One", sites: [] }] };
    const siteClass = { "Site 1": { access: "drive_in", siteKind: "tent", isGroup: false, isEquestrian: false, isWalkUp: false } };

    await env!.db.execute(
      sql`INSERT INTO park_digests (provider, park_page_id, digest, site_class)
          VALUES (${PROVIDER}, ${PARK}, ${JSON.stringify(digest)}::jsonb, ${JSON.stringify(siteClass)}::jsonb)`
    );

    const res = await env!.db.execute(
      sql`SELECT digest, site_class, as_of, built_at FROM park_digests WHERE provider = ${PROVIDER} AND park_page_id = ${PARK}`
    );
    const rows = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    const row = rows[0] as { digest: unknown; site_class: unknown; as_of: string | null; built_at: string };

    expect(row.digest).toEqual(digest);
    expect(row.site_class).toEqual(siteClass);
    expect(row.as_of).toBeNull();
    expect(row.built_at).toBeTruthy();
  });

  it.skipIf(!hasDb)("cascades delete when the parent park is removed", async () => {
    const cascadePark = "pd-test-park-cascade";
    await env!.client`INSERT INTO parks (provider_id, park_page_id, park_name) VALUES (${PROVIDER}, ${cascadePark}, 'Cascade Park') ON CONFLICT DO NOTHING`;
    await env!.client`INSERT INTO park_digests (provider, park_page_id, digest, site_class)
        VALUES (${PROVIDER}, ${cascadePark}, '{}'::jsonb, '{}'::jsonb)`;

    await env!.client`DELETE FROM parks WHERE provider_id = ${PROVIDER} AND park_page_id = ${cascadePark}`;

    const res = await env!.client`SELECT * FROM park_digests WHERE provider = ${PROVIDER} AND park_page_id = ${cascadePark}`;
    expect(res).toHaveLength(0);
  });

  it.skipIf(!hasDb)("upsertParkDigest inserts, then getParkDigest reads it back", async () => {
    const digest = { campgrounds: [{ id: "c1", name: "Campground One", sites: [] }] } as unknown as ParkAvailabilityResponse;
    const siteClass = { "Site 1": { access: "drive_in", siteKind: "tent", isGroup: false, isEquestrian: false, isWalkUp: false } };
    const asOf = "2026-07-01T12:00:00.000Z";

    await upsertParkDigest(env!.db, { provider: PROVIDER, parkPageId: PARK, asOf, digest, siteClass });

    const result = await getParkDigest(env!.db, PROVIDER, PARK);
    expect(result).toBeDefined();
    expect(result!.digest).toEqual(digest);
    expect(result!.siteClass).toEqual(siteClass);
    expect(new Date(result!.asOf!).toISOString()).toBe(asOf);
  });

  it.skipIf(!hasDb)("a second upsertParkDigest conflict-updates instead of duplicating, and bumps built_at", async () => {
    const digestA = { campgrounds: [{ id: "c1", name: "A", sites: [] }] } as unknown as ParkAvailabilityResponse;
    const digestB = { campgrounds: [{ id: "c1", name: "B", sites: [] }] } as unknown as ParkAvailabilityResponse;
    const siteClass = {};

    await upsertParkDigest(env!.db, { provider: PROVIDER, parkPageId: PARK, asOf: null, digest: digestA, siteClass });
    const firstRow = await env!.client`SELECT built_at FROM park_digests WHERE provider = ${PROVIDER} AND park_page_id = ${PARK}`;
    const firstBuiltAt = firstRow[0]!.built_at as Date;

    await new Promise((resolve) => setTimeout(resolve, 10));

    await upsertParkDigest(env!.db, { provider: PROVIDER, parkPageId: PARK, asOf: null, digest: digestB, siteClass });

    const rowCount = await env!.client`SELECT * FROM park_digests WHERE provider = ${PROVIDER} AND park_page_id = ${PARK}`;
    expect(rowCount).toHaveLength(1);

    const result = await getParkDigest(env!.db, PROVIDER, PARK);
    expect(result!.digest).toEqual(digestB);

    const secondBuiltAt = rowCount[0]!.built_at as Date;
    expect(new Date(secondBuiltAt).getTime()).toBeGreaterThan(new Date(firstBuiltAt).getTime());
  });

  it.skipIf(!hasDb)("is provider-scoped: same parkPageId under a different provider returns undefined", async () => {
    const otherProvider = "park-digest-test-provider-other";
    await env!.client`INSERT INTO providers (provider_id, display_name) VALUES (${otherProvider}, 'Other Provider') ON CONFLICT DO NOTHING`;

    const result = await getParkDigest(env!.db, otherProvider, PARK);
    expect(result).toBeUndefined();

    await env!.client`DELETE FROM providers WHERE provider_id = ${otherProvider}`;
  });
});
