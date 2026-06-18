import { eq } from "drizzle-orm";
import { accessAllowlist, type Db } from "@campbrain/db";

export async function isAllowlisted(db: Db, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const rows = await db.select().from(accessAllowlist).where(eq(accessAllowlist.email, normalized));
  return rows.length > 0;
}
