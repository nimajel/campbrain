import { drizzle as neonDrizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/** A Drizzle handle over either adapter (neon-serverless on Workers, postgres-js in Node). */
export type Db = NeonDatabase<typeof schema> | PostgresJsDatabase<typeof schema>;

/** Worker-safe: neon-serverless (WebSocket) over Neon. Used by apps/api (Cloudflare Workers). */
export function createDb(databaseUrl: string): Db {
  const pool = new Pool({ connectionString: databaseUrl });
  return neonDrizzle(pool, { schema });
}

/** Close the underlying pool/client (works for both adapters — both expose $client.end()). */
export async function closeDb(db: Db): Promise<void> {
  const client = (db as { $client?: { end: () => Promise<void> } }).$client;
  if (client && typeof client.end === "function") await client.end();
}
