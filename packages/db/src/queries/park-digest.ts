import { sql } from "drizzle-orm";
import type { ParkAvailabilityResponse } from "@campbrain/core";
import { rows, type QueryDb } from "./exec";

export type SiteClassMap = Record<string, unknown>;

export interface ParkDigest {
  digest: ParkAvailabilityResponse;
  siteClass: SiteClassMap;
  asOf: string | null;
}

export interface ParkDigestInput {
  provider: string;
  parkPageId: string;
  asOf: string | null;
  digest: ParkAvailabilityResponse;
  siteClass: SiteClassMap;
}

type ParkDigestRow = {
  digest: ParkAvailabilityResponse;
  site_class: SiteClassMap;
  as_of: string | null;
};

export async function getParkDigest(
  db: QueryDb,
  provider: string,
  parkPageId: string,
): Promise<ParkDigest | undefined> {
  const result = await rows<ParkDigestRow>(
    db,
    sql`SELECT digest, site_class, as_of::text
          FROM park_digests
         WHERE provider = ${provider} AND park_page_id = ${parkPageId}`,
  );
  const row = result[0];
  if (!row) return undefined;
  return { digest: row.digest, siteClass: row.site_class, asOf: row.as_of };
}

export async function upsertParkDigest(db: QueryDb, input: ParkDigestInput): Promise<void> {
  await rows(
    db,
    sql`INSERT INTO park_digests (provider, park_page_id, as_of, digest, site_class)
        VALUES (${input.provider}, ${input.parkPageId}, ${input.asOf}::timestamptz,
                ${JSON.stringify(input.digest)}::jsonb, ${JSON.stringify(input.siteClass)}::jsonb)
        ON CONFLICT (provider, park_page_id) DO UPDATE SET
          as_of = EXCLUDED.as_of,
          digest = EXCLUDED.digest,
          site_class = EXCLUDED.site_class,
          built_at = now()`,
  );
}
