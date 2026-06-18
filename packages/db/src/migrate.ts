import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { MV_CREATE_SQL, MV_INDEX_SQL } from "./mv";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);

  await migrate(db, { migrationsFolder: "./migrations" });

  await db.execute(sql.raw(MV_CREATE_SQL));
  for (const stmt of MV_INDEX_SQL) await db.execute(sql.raw(stmt));

  await client.end();
  console.log("✅ migrations + MV applied");
}

main().catch((e) => { console.error(e); process.exit(1); });
