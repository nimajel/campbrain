import { sql } from "drizzle-orm";
import type { RecentOpening, DashboardStats } from "@campbrain/types";
import { rows, type QueryDb } from "./exec";
import { sqlTextArray } from "./filters";
import type { SavedSearch } from "@campbrain/types";
import type { SavedSearchOpening } from "./alert-match";

/** Upsert each opening; rows not seen at `runStart` are marked disappeared. Returns # brand-new hits. */
export async function reconcileHits(
  db: QueryDb,
  search: SavedSearch,
  openings: SavedSearchOpening[],
  runStart: string,
): Promise<{ newCount: number }> {
  let newCount = 0;
  for (const o of openings) {
    const res = await rows<{ inserted: boolean | string }>(db, sql`
      INSERT INTO hits (id, saved_search_id, user_id, provider, park_page_id, park_name, campground_name,
                        site_name, arrival_date, nights, booking_url, first_seen_at, last_seen_at)
      VALUES (${crypto.randomUUID()}, ${o.savedSearchId}, ${search.userId}, ${search.provider},
              ${o.parkPageId}, ${o.parkName}, ${o.campgroundName}, ${o.siteName}, ${o.arrivalDate}::date,
              ${o.nights}, ${o.bookingUrl}, ${runStart}::timestamptz, ${runStart}::timestamptz)
      ON CONFLICT (saved_search_id, site_name, arrival_date)
      DO UPDATE SET last_seen_at = ${runStart}::timestamptz, disappeared_at = NULL
      RETURNING (xmax = 0) AS inserted`);
    const val = res[0]?.inserted;
    if (val === true || val === "t" || val === "true") newCount++;
  }
  await rows(db, sql`
    UPDATE hits SET disappeared_at = ${runStart}::timestamptz
    WHERE saved_search_id = ${search.id}
      AND last_seen_at < ${runStart}::timestamptz
      AND disappeared_at IS NULL`);
  return { newCount };
}

export interface NotifyRow {
  id: string;
  userId: string;
  email: string;
  searchName: string;
  parkName: string;
  campgroundName: string;
  siteName: string;
  arrivalDate: string;
  departureDate: string;
  nights: number;
  bookingUrl: string | null;
}

export async function listHitsToNotify(db: QueryDb, today: string): Promise<NotifyRow[]> {
  return rows<NotifyRow>(db, sql`
    SELECT h.id, h.user_id AS "userId", u.email, s.name AS "searchName",
           h.park_name AS "parkName", h.campground_name AS "campgroundName", h.site_name AS "siteName",
           h.arrival_date::text AS "arrivalDate",
           (h.arrival_date + h.nights)::text AS "departureDate",
           h.nights, h.booking_url AS "bookingUrl"
    FROM hits h
    JOIN saved_searches s ON s.id = h.saved_search_id
    JOIN "user" u ON u.id = h.user_id
    WHERE h.notified_at IS NULL
      AND s.email_enabled = true
      AND h.disappeared_at IS NULL
      AND h.arrival_date >= ${today}::date
    ORDER BY h.user_id, h.first_seen_at`);
}

export async function markNotified(db: QueryDb, ids: string[], now: string): Promise<void> {
  if (ids.length === 0) return;
  await rows(db, sql`
    UPDATE hits SET notified_at = ${now}::timestamptz
    WHERE id = ANY(${sqlTextArray(ids)})`);
}

export async function getDashboardStats(db: QueryDb, userId: string): Promise<DashboardStats> {
  const r = await rows<{ active: string; current: string; total: string }>(db, sql`
    SELECT
      (SELECT count(*) FROM saved_searches WHERE user_id = ${userId} AND alert_enabled = true)::text AS active,
      (SELECT count(*) FROM hits WHERE user_id = ${userId} AND disappeared_at IS NULL AND arrival_date >= CURRENT_DATE)::text AS current,
      (SELECT count(*) FROM hits WHERE user_id = ${userId})::text AS total`);
  const row = r[0]!;
  return {
    activeAlerts: Number(row.active),
    currentMatches: Number(row.current),
    totalHits: Number(row.total),
  };
}

export async function getRecentOpenings(db: QueryDb, userId: string, today: string): Promise<RecentOpening[]> {
  return rows<RecentOpening>(db, sql`
    SELECT h.id, h.park_page_id AS "parkPageId", h.park_name AS "parkName",
           h.campground_name AS "campgroundName", h.site_name AS "siteName",
           h.arrival_date::text AS "arrivalDate", h.nights,
           h.booking_url AS "bookingUrl", h.first_seen_at::text AS "firstSeenAt"
    FROM hits h
    WHERE h.user_id = ${userId}
      AND h.disappeared_at IS NULL
      AND h.arrival_date >= ${today}::date
    ORDER BY h.first_seen_at DESC`);
}
