import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, dbReachable } from "./helpers";

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
});
