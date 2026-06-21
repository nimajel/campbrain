import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/schema";

const LOCAL_URL = "postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain";

export function testDbUrl(): string {
  return process.env.DATABASE_URL ?? LOCAL_URL;
}

/** Raw postgres client (for fixture inserts/cleanup) + drizzle handle (for the read fns). */
export function createTestDb() {
  const client = postgres(testDbUrl(), { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, client };
}

/** True if the local/CI Postgres is reachable; used to skip integration tests in DB-less CI. */
export async function dbReachable(): Promise<boolean> {
  try {
    const client = postgres(testDbUrl(), { max: 1, onnotice: () => {}, connect_timeout: 2 });
    await client`SELECT 1`;
    await client.end();
    return true;
  } catch {
    return false;
  }
}
