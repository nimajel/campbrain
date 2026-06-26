import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { Db } from "./client";

/** True when the URL targets a Neon-hosted database (needs TLS). */
export function isNeonHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

/** Node-only: postgres-js (TCP). Works against local Postgres AND Neon (Neon accepts TCP).
 *  Used by the scanner (GitHub Actions) + scripts — NOT importable from the Worker bundle.
 *  Forces SSL for Neon hosts (postgres-js would otherwise connect plaintext unless the URL
 *  carries sslmode=require, and Neon rejects plaintext). Local/standard hosts stay plaintext. */
export function createNodeDb(databaseUrl: string): Db {
  const ssl = isNeonHost(databaseUrl) ? ("require" as const) : undefined;
  const client = postgres(databaseUrl, { max: 10, onnotice: () => {}, ssl });
  return drizzle(client, { schema }) as Db;
}
