import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { Db } from "./client";

/** Node-only: postgres-js (TCP). Works against local Postgres AND Neon (Neon accepts TCP).
 *  Used by the scanner (GitHub Actions) + scripts/tests — NOT importable from the Worker bundle. */
export function createNodeDb(databaseUrl: string): Db {
  const client = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  return drizzle(client, { schema }) as Db;
}
