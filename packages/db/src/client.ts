import { drizzle as neonDrizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { drizzle as pgDrizzle } from "drizzle-orm/postgres-js";
import { Pool } from "@neondatabase/serverless";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = NeonDatabase<typeof schema> | ReturnType<typeof pgDrizzle<typeof schema>>;

/** True when the URL targets a Neon-hosted database (requires WebSocket transport). */
function isNeonUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

/** Create a Drizzle DB handle.
 *  - Neon URLs → neon-serverless (WebSocket; required for Cloudflare Workers + Neon cloud).
 *  - All other URLs → postgres-js (TCP; works with local Postgres and standard PG hosts). */
export function createDb(databaseUrl: string): Db {
  if (isNeonUrl(databaseUrl)) {
    const pool = new Pool({ connectionString: databaseUrl });
    return neonDrizzle(pool, { schema });
  }
  const client = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  return pgDrizzle(client, { schema });
}

/** Close the DB connection pool. */
export async function closeDb(db: Db): Promise<void> {
  const neonPool = (db as { $client?: Pool }).$client;
  if (neonPool && typeof neonPool.end === "function") {
    await neonPool.end();
    return;
  }
  // postgres-js: the client is stored as $client on the drizzle handle
  const pgClient = (db as { $client?: { end: () => Promise<void> } }).$client;
  if (pgClient && typeof pgClient.end === "function") {
    await pgClient.end();
  }
}
