import { sql } from "drizzle-orm";
import { classifySite, type AvailabilityWindowEntry } from "@campbrain/core";
import { rows, type TransactionalDb } from "./exec";

/** Upsert one park-window's full availability grid in a single transaction.
 *  Ported from src/cache/availability-cache.ts:56-185 (postgres.js → drizzle). */
export async function upsertEntry(
  db: TransactionalDb,
  entry: AvailabilityWindowEntry,
  providerId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Upsert park
    await tx.execute(sql`
      INSERT INTO parks (provider_id, park_page_id, park_name)
      VALUES (${providerId}, ${entry.parkPageId}, ${entry.parkName})
      ON CONFLICT (provider_id, park_page_id) DO UPDATE SET park_name = EXCLUDED.park_name`);

    // 2. Upsert scan_window
    await tx.execute(sql`
      INSERT INTO scan_windows (provider_id, park_page_id, window_start, window_end, scanned_at, source_url)
      VALUES (${providerId}, ${entry.parkPageId}, ${entry.windowStart}::date, ${entry.windowEnd}::date,
              ${entry.scannedAt}::timestamptz, ${entry.sourceUrl})
      ON CONFLICT (provider_id, park_page_id, window_start) DO UPDATE SET
        window_end = EXCLUDED.window_end, scanned_at = EXCLUDED.scanned_at, source_url = EXCLUDED.source_url`);

    // 3. Delete old availability for this park's sites in this window's date range
    await tx.execute(sql`
      DELETE FROM availability
      WHERE site_id IN (SELECT site_id FROM sites WHERE provider_id = ${providerId} AND park_page_id = ${entry.parkPageId})
        AND date BETWEEN ${entry.windowStart}::date AND ${entry.windowEnd}::date`);

    // 4. No campgrounds → fully booked window; done.
    if (entry.campgrounds.length === 0) return;

    // 5. Bulk upsert campgrounds (dedupe by name)
    const cgByName = new Map<string, { id: string; name: string; nightlyFee?: number; bookingUrl?: string }>();
    for (const cg of entry.campgrounds) cgByName.set(cg.name, cg);
    const cgRows = [...cgByName.values()];
    const cgValues = sql.join(
      cgRows.map((c) => sql`(${providerId}, ${entry.parkPageId}, ${c.name}, ${c.id}, ${c.nightlyFee ?? null}, ${c.bookingUrl ?? null})`),
      sql`, `,
    );
    await tx.execute(sql`
      INSERT INTO campgrounds (provider_id, park_page_id, campground_name, campground_id, nightly_fee, booking_url)
      VALUES ${cgValues}
      ON CONFLICT (provider_id, park_page_id, campground_name) DO UPDATE SET
        campground_id = EXCLUDED.campground_id, nightly_fee = EXCLUDED.nightly_fee, booking_url = EXCLUDED.booking_url`);

    // 6. Bulk upsert sites (classify each) → RETURNING site_id
    type SiteUpsert = {
      cgName: string; siteName: string; access: string; siteKind: string | null;
      isGroup: boolean; isEquestrian: boolean; isWalkUp: boolean; isDayUse: boolean;
    };
    const siteByKey = new Map<string, SiteUpsert>();
    for (const cg of entry.campgrounds) {
      for (const site of cg.sites) {
        const info = classifySite(site.name, cg.name, site.recGovCampsiteType, entry.parkPageId);
        siteByKey.set(`${cg.name}::${site.name}`, {
          cgName: cg.name, siteName: site.name,
          access: info.access, siteKind: info.siteKind,
          isGroup: info.isGroup, isEquestrian: info.isEquestrian, isWalkUp: info.isWalkUp, isDayUse: info.isDayUse,
        });
      }
    }
    const siteRows = [...siteByKey.values()];
    if (siteRows.length === 0) return;
    const siteValues = sql.join(
      siteRows.map((s) => sql`(${providerId}, ${entry.parkPageId}, ${s.cgName}, ${s.siteName}, ${s.access}, ${s.siteKind}, ${s.isGroup}, ${s.isEquestrian}, ${s.isWalkUp}, ${s.isDayUse})`),
      sql`, `,
    );
    const returned = await rows<{ site_id: number; campground_name: string; site_name: string }>(tx, sql`
      INSERT INTO sites (provider_id, park_page_id, campground_name, site_name, access, site_kind, is_group, is_equestrian, is_walk_up, is_day_use)
      VALUES ${siteValues}
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET
        access = EXCLUDED.access, site_kind = EXCLUDED.site_kind,
        is_group = EXCLUDED.is_group, is_equestrian = EXCLUDED.is_equestrian, is_walk_up = EXCLUDED.is_walk_up, is_day_use = EXCLUDED.is_day_use
      RETURNING site_id, campground_name, site_name`);

    // 7. site_id lookup
    const siteIdMap = new Map<string, number>();
    for (const r of returned) siteIdMap.set(`${r.campground_name}::${r.site_name}`, r.site_id);

    // 8. Bulk insert availability (dedupe by site_id::date)
    const availByKey = new Map<string, { siteId: number; date: string; status: string }>();
    for (const cg of entry.campgrounds) {
      for (const site of cg.sites) {
        const siteId = siteIdMap.get(`${cg.name}::${site.name}`);
        if (siteId === undefined) continue;
        for (const [date, status] of Object.entries(site.dates)) {
          availByKey.set(`${siteId}::${date}`, { siteId, date, status });
        }
      }
    }
    const availRows = [...availByKey.values()];
    if (availRows.length === 0) return;
    const availValues = sql.join(
      availRows.map((a) => sql`(${a.siteId}, ${a.date}::date, ${a.status})`),
      sql`, `,
    );
    await tx.execute(sql`
      INSERT INTO availability (site_id, date, status)
      VALUES ${availValues}
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status`);
  });
}
