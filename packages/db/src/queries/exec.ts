import type { SQL } from "drizzle-orm";

/** Minimal DB surface the read functions need. Satisfied by both the neon-serverless
 *  Drizzle handle (prod/Worker) and the postgres-js Drizzle handle (local tests). */
export interface QueryDb {
  execute(query: SQL): Promise<unknown>;
}

/** Execute a SQL query and return its rows, normalizing the two adapter return shapes:
 *  neon-serverless → { rows: [...] }; postgres-js → [...] (array). */
export async function rows<T = Record<string, unknown>>(db: QueryDb, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  if (Array.isArray(result)) return result as T[];
  const maybe = (result as { rows?: unknown }).rows;
  return (Array.isArray(maybe) ? maybe : []) as T[];
}
