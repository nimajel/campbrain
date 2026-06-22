import { sql } from "drizzle-orm";
import dayjs from "dayjs";
import { rows, type QueryDb } from "./exec";

/** Delete scan_windows + availability older than today. Returns # scan_windows removed.
 *  Ported from src/cache/availability-cache.ts:652-658. */
export async function evictExpired(db: QueryDb, nowMs: number = Date.now()): Promise<number> {
  const today = dayjs(nowMs).format("YYYY-MM-DD");
  const deleted = await rows<{ park_page_id: string }>(
    db,
    sql`DELETE FROM scan_windows WHERE window_end < ${today}::date RETURNING park_page_id`,
  );
  await db.execute(sql`DELETE FROM availability WHERE date < ${today}::date`);
  return deleted.length;
}
