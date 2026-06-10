import dayjs from 'dayjs';
import { getSql, rebuildMaterializedView } from './db.js';
export { rebuildMaterializedView };
import type { AvailabilityWindowEntry, AvailableStay, CampgroundWindow } from './types.js';
import { WINDOW_DAYS } from './types.js';


// ---------------------------------------------------------------------------
// TTL — keyed on windowStart (most time-sensitive date in the window)
// ---------------------------------------------------------------------------

const TTL_MINUTES = {
  veryFar: 480,  // > 90 days — barely changes, 8h
  far: 240,      // 30–90 days — 4h
  near: 120,     // 7–30 days — 2h
  imminent: 30,  // < 7 days — 30min
} as const;

export function ttlMinutes(windowStart: string, nowMs = Date.now()): number {
  const daysUntil = dayjs(windowStart).diff(dayjs(nowMs), 'day');
  if (daysUntil < 7) return TTL_MINUTES.imminent;
  if (daysUntil < 30) return TTL_MINUTES.near;
  if (daysUntil < 90) return TTL_MINUTES.far;
  return TTL_MINUTES.veryFar;
}

export function isEntryStale(entry: AvailabilityWindowEntry, nowMs = Date.now()): boolean {
  const ttl = ttlMinutes(entry.windowStart, nowMs) * 60 * 1000;
  return nowMs - new Date(entry.scannedAt).getTime() > ttl;
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

export function generateWindowStarts(daysAhead: number, today?: string): string[] {
  const base = today ? dayjs(today) : dayjs();
  const windows: string[] = [];
  let offset = 2;
  while (offset <= daysAhead) {
    windows.push(base.add(offset, 'day').format('YYYY-MM-DD'));
    offset += WINDOW_DAYS;
  }
  return windows;
}

export function windowEnd(windowStart: string): string {
  return dayjs(windowStart).add(WINDOW_DAYS - 1, 'day').format('YYYY-MM-DD');
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

export async function upsertEntry(entry: AvailabilityWindowEntry, providerId: string): Promise<void> {
  const sql = getSql();
  await sql.begin(async (tx) => {
    // 1. Upsert park
    await tx`
      INSERT INTO parks (provider_id, park_page_id, park_name)
      VALUES (${providerId}, ${entry.parkPageId}, ${entry.parkName})
      ON CONFLICT (provider_id, park_page_id) DO UPDATE SET park_name = EXCLUDED.park_name
    `;

    // 2. Upsert scan_window
    await tx`
      INSERT INTO scan_windows (provider_id, park_page_id, window_start, window_end, scanned_at, source_url)
      VALUES (
        ${providerId}, ${entry.parkPageId},
        ${entry.windowStart}::date, ${entry.windowEnd}::date,
        ${entry.scannedAt}::timestamptz, ${entry.sourceUrl}
      )
      ON CONFLICT (provider_id, park_page_id, window_start)
      DO UPDATE SET
        window_end = EXCLUDED.window_end,
        scanned_at = EXCLUDED.scanned_at,
        source_url = EXCLUDED.source_url
    `;

    // 3. Delete old availability for this park's sites in this window's date range
    await tx`
      DELETE FROM availability
      WHERE site_id IN (
        SELECT site_id FROM sites
        WHERE provider_id = ${providerId} AND park_page_id = ${entry.parkPageId}
      )
      AND date BETWEEN ${entry.windowStart}::date AND ${entry.windowEnd}::date
    `;

    // 4. If no campgrounds, window is fully booked — done
    if (entry.campgrounds.length === 0) return;

    // 5. Bulk upsert campgrounds — deduplicate by campground_name within this park
    const cgRowMap = new Map<string, { provider_id: string; park_page_id: string; campground_name: string; campground_id: string; nightly_fee: number | null; booking_url: string | null }>();
    for (const cg of entry.campgrounds) {
      cgRowMap.set(cg.name, {
        provider_id: providerId,
        park_page_id: entry.parkPageId,
        campground_name: cg.name,
        campground_id: cg.id,
        nightly_fee: cg.nightlyFee ?? null,
        booking_url: cg.bookingUrl ?? null,
      });
    }
    const cgRows = Array.from(cgRowMap.values());

    await tx`
      INSERT INTO campgrounds ${tx(cgRows, 'provider_id', 'park_page_id', 'campground_name', 'campground_id', 'nightly_fee', 'booking_url')}
      ON CONFLICT (provider_id, park_page_id, campground_name) DO UPDATE SET
        campground_id = EXCLUDED.campground_id,
        nightly_fee = EXCLUDED.nightly_fee,
        booking_url = EXCLUDED.booking_url
    `;

    // 6. Bulk upsert sites — deduplicate by (campground_name, site_name) within this park
    const siteRowMap = new Map<string, { provider_id: string; park_page_id: string; campground_name: string; site_name: string }>();
    for (const cg of entry.campgrounds) {
      for (const site of cg.sites) {
        siteRowMap.set(`${cg.name}::${site.name}`, {
          provider_id: providerId,
          park_page_id: entry.parkPageId,
          campground_name: cg.name,
          site_name: site.name,
        });
      }
    }
    const siteRows = Array.from(siteRowMap.values());

    if (siteRows.length === 0) return;

    type SiteRow = { site_id: number; campground_name: string; site_name: string };
    const returnedSites = (await tx`
      INSERT INTO sites ${tx(siteRows, 'provider_id', 'park_page_id', 'campground_name', 'site_name')}
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name)
      DO UPDATE SET site_name = EXCLUDED.site_name
      RETURNING site_id, campground_name, site_name
    `) as unknown as SiteRow[];

    // 7. Build site_id lookup map
    const siteIdMap = new Map<string, number>();
    for (const row of returnedSites) {
      siteIdMap.set(`${row.campground_name}::${row.site_name}`, row.site_id);
    }

    // 8. Bulk insert availability — deduplicate by (site_id, date) within this batch
    const availMap = new Map<string, { site_id: number; date: string; status: string }>();
    for (const cg of entry.campgrounds) {
      for (const site of cg.sites) {
        const siteId = siteIdMap.get(`${cg.name}::${site.name}`);
        if (siteId === undefined) continue;
        for (const [date, status] of Object.entries(site.dates)) {
          availMap.set(`${siteId}::${date}`, { site_id: siteId, date, status });
        }
      }
    }
    const availRows = Array.from(availMap.values());

    if (availRows.length === 0) return;

    await tx`
      INSERT INTO availability ${tx(availRows, 'site_id', 'date', 'status')}
      ON CONFLICT (site_id, date) DO UPDATE SET status = EXCLUDED.status
    `;
  });
}

// ---------------------------------------------------------------------------
// Stale window detection
// ---------------------------------------------------------------------------

export async function findStaleWindows(
  candidates: Array<{ parkPageId: string; windowStart: string }>,
  providerName: string,
  nowMs = Date.now()
): Promise<Array<{ parkPageId: string; windowStart: string }>> {
  const sql = getSql();
  const rows = await sql<{ park_page_id: string; window_start: string; scanned_at: string }[]>`
    SELECT park_page_id, window_start::text, scanned_at::text
    FROM scan_windows
    WHERE provider_id = ${providerName} AND window_end >= CURRENT_DATE
  `;

  const existingMap = new Map<string, string>();
  for (const row of rows) {
    existingMap.set(`${row.park_page_id}::${row.window_start}`, row.scanned_at);
  }

  const result: Array<{ parkPageId: string; windowStart: string }> = [];
  const candidateKeys = new Set(candidates.map((c) => `${c.parkPageId}::${c.windowStart}`));

  // Check today's generated candidates (add if missing or TTL-expired)
  for (const { parkPageId, windowStart } of candidates) {
    const scannedAt = existingMap.get(`${parkPageId}::${windowStart}`);
    if (!scannedAt || isEntryStale({ scannedAt, windowStart } as AvailabilityWindowEntry, nowMs)) {
      result.push({ parkPageId, windowStart });
    }
  }

  // Also re-scan any existing window whose TTL has expired, even if it wasn't in today's
  // candidate list (window starts shift by 1 day per run, so yesterday's windows are never
  // re-queued otherwise — causing stale availability data to persist until natural eviction)
  for (const row of rows) {
    const key = `${row.park_page_id}::${row.window_start}`;
    if (candidateKeys.has(key)) continue; // already handled above
    if (isEntryStale({ scannedAt: row.scanned_at, windowStart: row.window_start } as AvailabilityWindowEntry, nowMs)) {
      result.push({ parkPageId: row.park_page_id, windowStart: row.window_start });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Bulk readers
// ---------------------------------------------------------------------------

type EntryRow = {
  park_page_id: string;
  park_name: string;
  window_start: string;
  window_end: string;
  scanned_at: string;
  source_url: string;
  cg_name: string | null;
  cg_id: string | null;
  nightly_fee: string | null;
  booking_url: string | null;
  site_id: number | null;
  site_name: string | null;
  avail_date: string | null;
  status: string | null;
};

const ENTRY_SELECT = `
  sw.park_page_id, p.park_name,
  sw.window_start::text AS window_start, sw.window_end::text AS window_end,
  sw.scanned_at::text AS scanned_at, sw.source_url,
  cg.campground_name AS cg_name, cg.campground_id AS cg_id,
  cg.nightly_fee, cg.booking_url,
  s.site_id, s.site_name,
  a.date::text AS avail_date, a.status
`;

const ENTRY_JOINS = `
  JOIN parks p ON p.provider_id = sw.provider_id AND p.park_page_id = sw.park_page_id
  LEFT JOIN campgrounds cg ON cg.provider_id = sw.provider_id AND cg.park_page_id = sw.park_page_id
  LEFT JOIN sites s ON s.provider_id = cg.provider_id AND s.park_page_id = cg.park_page_id AND s.campground_name = cg.campground_name
  LEFT JOIN availability a ON a.site_id = s.site_id AND a.date >= sw.window_start AND a.date <= sw.window_end AND a.status = 'available'
`;

function buildEntriesFromRows(rows: EntryRow[]): AvailabilityWindowEntry[] {
  const windowMap = new Map<string, AvailabilityWindowEntry>();
  const cgMap = new Map<string, CampgroundWindow>();
  const siteMap = new Map<string, { name: string; dates: Record<string, 'available' | 'unavailable' | 'unknown'> }>();

  for (const row of rows) {
    const windowKey = `${row.park_page_id}::${row.window_start}`;

    if (!windowMap.has(windowKey)) {
      windowMap.set(windowKey, {
        parkPageId: row.park_page_id,
        parkName: row.park_name,
        windowStart: row.window_start,
        windowEnd: row.window_end,
        scannedAt: row.scanned_at,
        sourceUrl: row.source_url,
        campgrounds: [],
      });
    }

    if (row.cg_name === null) continue;

    const cgKey = `${windowKey}::${row.cg_name}`;
    if (!cgMap.has(cgKey)) {
      const cg: CampgroundWindow = {
        id: row.cg_id ?? row.cg_name,
        name: row.cg_name,
        sites: [],
      };
      if (row.nightly_fee !== null) cg.nightlyFee = Number(row.nightly_fee);
      if (row.booking_url !== null) cg.bookingUrl = row.booking_url;
      cgMap.set(cgKey, cg);
      windowMap.get(windowKey)!.campgrounds.push(cg);
    }

    if (row.site_name === null) continue;

    const siteKey = `${cgKey}::${row.site_name}`;
    if (!siteMap.has(siteKey)) {
      const site = { name: row.site_name, dates: {} as Record<string, 'available' | 'unavailable' | 'unknown'> };
      siteMap.set(siteKey, site);
      cgMap.get(cgKey)!.sites.push(site);
    }

    if (row.avail_date !== null && row.status !== null) {
      siteMap.get(siteKey)!.dates[row.avail_date] = row.status as 'available' | 'unavailable' | 'unknown';
    }
  }

  return Array.from(windowMap.values());
}

async function queryEntries(freshOnly: boolean, nowMs = Date.now()): Promise<AvailabilityWindowEntry[]> {
  const sql = getSql();
  const rows = await sql.unsafe<EntryRow[]>(
    `SELECT ${ENTRY_SELECT} FROM scan_windows sw ${ENTRY_JOINS}
     WHERE sw.window_end >= CURRENT_DATE
       AND EXISTS (
         SELECT 1 FROM availability a2
         JOIN sites s2 ON s2.site_id = a2.site_id
         WHERE s2.park_page_id = sw.park_page_id
           AND a2.date >= sw.window_start AND a2.date <= sw.window_end
           AND a2.status = 'available'
       )
     ORDER BY sw.park_page_id, sw.window_start, cg.campground_name, s.site_name, a.date`,
    []
  );
  let entries = buildEntriesFromRows(rows);
  if (freshOnly) entries = entries.filter((e) => !isEntryStale(e, nowMs));
  return entries;
}

export async function listFreshEntries(nowMs = Date.now()): Promise<AvailabilityWindowEntry[]> {
  return queryEntries(true, nowMs);
}

export async function listAllEntries(): Promise<AvailabilityWindowEntry[]> {
  return queryEntries(false);
}

/** Fetch all windows for a single park. Much faster than loading all parks. */
export async function getEntriesForParks(
  parkPageIds: string[],
  providerName?: string
): Promise<AvailabilityWindowEntry[]> {
  if (parkPageIds.length === 0) return [];
  const sql = getSql();
  const providerClause = providerName ? `AND sw.provider_id = $2` : '';
  const params = providerName ? [parkPageIds, providerName] : [parkPageIds];
  const rows = await sql.unsafe<EntryRow[]>(
    `SELECT ${ENTRY_SELECT} FROM scan_windows sw ${ENTRY_JOINS}
     WHERE sw.park_page_id = ANY($1) ${providerClause} AND sw.window_end >= CURRENT_DATE
     ORDER BY sw.window_start, cg.campground_name, s.site_name, a.date`,
    params
  );
  return buildEntriesFromRows(rows);
}

export async function getEntriesForPark(
  parkPageId: string,
  providerName?: string
): Promise<AvailabilityWindowEntry[]> {
  return getEntriesForParks([parkPageId], providerName);
}

/** Returns park_page_ids that have at least one available site in the given date range. */
// Site filter patterns — mirrors the JS regex logic in web/lib/site-filters.ts,
// translated to PostgreSQL POSIX regex. Patterns are hardcoded; filterIds come
// from a closed enum so sql.unsafe is safe here.
const FILTER_SQL: Record<string, { exclude: boolean; pattern: string }> = {
  exclude_group:      { exclude: true,  pattern: '\\ygroup\\y' },
  exclude_day_use:    { exclude: true,  pattern: '\\y(day.use|dailyuse|picnic)\\y' },
  hike_in_only:       { exclude: false, pattern: '\\y(hike.in|walk.in)\\y' },
  exclude_equestrian: { exclude: true,  pattern: '\\y(equestrian|horse)\\y' },
  exclude_boat_in:    { exclude: true,  pattern: '\\yboat[ -]?(in|to|access)\\y' },
};

const WALK_UP_SQL = "s.site_name ~* 'hike *[/&]? *bike'";

export interface AvailabilityClauseResult {
  clauses: string[];
  params: string[];
  excludeWalkUp: boolean;
}

/** Pure WHERE-clause builder for the availability summary query (exported for tests). */
export function buildAvailabilityClauses(
  from?: string | null,
  to?: string | null,
  filterIds: string[] = [],
  weekendsOnly = false,
): AvailabilityClauseResult {
  const params: string[] = [];
  const clauses: string[] = ["a.status = 'available'", 'a.date >= CURRENT_DATE'];

  if (from) { clauses.push(`a.date >= $${params.length + 1}`); params.push(from); }
  if (to)   { clauses.push(`a.date <= $${params.length + 1}`); params.push(to); }

  // Weekends mode: only count Friday (5) or Saturday (6) arrivals. Sunday-only availability
  // means you can't arrive for a Fri-Sun or Sat-Sun stay, so it shouldn't light up the pin.
  if (weekendsOnly) clauses.push('EXTRACT(DOW FROM a.date)::int IN (5, 6)');

  let excludeWalkUp = false;
  for (const id of filterIds) {
    if (id === 'exclude_walk_up') { excludeWalkUp = true; continue; }
    const f = FILTER_SQL[id];
    if (!f) continue;
    const col = `(s.site_name || ' ' || s.campground_name) ~* '${f.pattern}'`;
    clauses.push(f.exclude ? `NOT (${col})` : col);
  }

  return { clauses, params, excludeWalkUp };
}

export interface ParkAvailabilityCount {
  parkPageId: string;
  siteCount: number;
  walkUpCount: number;
}

/**
 * Per-facility availability counts in the given date range. siteCount is bookable
 * sites only (walk-up hike/bike sites never count as bookable); walkUpCount is the
 * matching walk-up sites, forced to 0 when the exclude_walk_up filter is active.
 * Facilities with neither are omitted. COUNT(DISTINCT) dedupes sites that appear
 * in multiple overlapping scan windows.
 */
export async function getParkAvailabilityCounts(
  from?: string | null,
  to?: string | null,
  filterIds: string[] = [],
  weekendsOnly = false,
): Promise<ParkAvailabilityCount[]> {
  const sql = getSql();
  const { clauses, params, excludeWalkUp } = buildAvailabilityClauses(from, to, filterIds, weekendsOnly);

  const bookable = `COUNT(DISTINCT s.site_id) FILTER (WHERE NOT (${WALK_UP_SQL}))`;
  const walkUp = excludeWalkUp ? '0' : `COUNT(DISTINCT s.site_id) FILTER (WHERE ${WALK_UP_SQL})`;

  const rows = await sql.unsafe<{ park_page_id: string; site_count: number; walk_up_count: number }[]>(`
    SELECT s.park_page_id,
           (${bookable})::int AS site_count,
           (${walkUp})::int AS walk_up_count
    FROM availability a
    JOIN sites s ON s.site_id = a.site_id
    WHERE ${clauses.join('\n      AND ')}
    GROUP BY s.park_page_id
    HAVING (${bookable}) > 0${excludeWalkUp ? '' : ` OR (${walkUp}) > 0`}
  `, params);

  return rows.map((r) => ({
    parkPageId: r.park_page_id,
    siteCount: Number(r.site_count),
    walkUpCount: Number(r.walk_up_count),
  }));
}

// ---------------------------------------------------------------------------
// Materialized view
// ---------------------------------------------------------------------------

export async function refreshMaterializedView(): Promise<void> {
  const sql = getSql();
  const [row] = await sql<{ ispopulated: boolean }[]>`
    SELECT ispopulated FROM pg_matviews WHERE matviewname = 'mv_available_stays'
  `;
  if (row?.ispopulated) {
    await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_available_stays`;
  } else {
    await sql`REFRESH MATERIALIZED VIEW mv_available_stays`;
  }
}

export async function listAvailableStays(
  from?: string | null,
  to?: string | null,
): Promise<AvailableStay[]> {
  const sql = getSql();
  const params: string[] = [];
  const clauses: string[] = ['arrival_date >= CURRENT_DATE'];

  if (from) { clauses.push(`arrival_date >= $${params.length + 1}`); params.push(from); }
  if (to)   { clauses.push(`arrival_date <= $${params.length + 1}`); params.push(to); }

  type MvRow = {
    provider_id: string;
    park_page_id: string;
    park_name: string;
    campground_name: string;
    nightly_fee: string | null;
    booking_url: string | null;
    arrival_date: string;
    nights: number;
    available_sites: string[];
    walk_up_sites: string[];
  };

  const rows = await sql.unsafe<MvRow[]>(
    `SELECT provider_id, park_page_id, park_name, campground_name, nightly_fee, booking_url,
            arrival_date::text, nights, available_sites, walk_up_sites
     FROM mv_available_stays
     WHERE ${clauses.join(' AND ')}
     ORDER BY arrival_date, park_name, campground_name, nights`,
    params
  );

  return rows.map((r) => ({
    providerId: r.provider_id,
    parkPageId: r.park_page_id,
    parkName: r.park_name,
    campgroundName: r.campground_name,
    nightlyFee: r.nightly_fee !== null ? Number(r.nightly_fee) : null,
    bookingUrl: r.booking_url,
    arrivalDate: r.arrival_date,
    nights: r.nights,
    availableSites: r.available_sites,
    walkUpSites: r.walk_up_sites ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Eviction
// ---------------------------------------------------------------------------

export async function evictExpired(nowMs = Date.now()): Promise<number> {
  const sql = getSql();
  const today = dayjs(nowMs).format('YYYY-MM-DD');
  const result = await sql`DELETE FROM scan_windows WHERE window_end < ${today}`;
  await sql`DELETE FROM availability WHERE date < ${today}`;
  return Number(result.count);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getCacheStats(): Promise<{ entryCount: number; lastScanAt: string | null; maxWindowEnd: string | null }> {
  const sql = getSql();
  const [row] = await sql<{ entry_count: number; last_scan_at: string | null; max_window_end: string | null }[]>`
    SELECT COUNT(*)::int AS entry_count, MAX(scanned_at)::text AS last_scan_at, MAX(window_end)::text AS max_window_end
    FROM scan_windows
    WHERE window_end >= CURRENT_DATE
  `;
  return { entryCount: row?.entry_count ?? 0, lastScanAt: row?.last_scan_at ?? null, maxWindowEnd: row?.max_window_end ?? null };
}

// ---------------------------------------------------------------------------
// Map catalog: parks + campground counts from DB
// ---------------------------------------------------------------------------

export interface DbParkSummary {
  providerId: string;
  parkPageId: string;
  parkName: string;
  campgrounds: { name: string; siteCount: number }[];
}

export async function listParksFromDb(): Promise<DbParkSummary[]> {
  const sql = getSql();
  const rows = await sql<{ provider_id: string; park_page_id: string; park_name: string; campground_name: string; site_count: number }[]>`
    SELECT
      p.provider_id,
      p.park_page_id,
      p.park_name,
      s.campground_name,
      COUNT(s.site_id)::int AS site_count
    FROM parks p
    JOIN sites s ON s.provider_id = p.provider_id AND s.park_page_id = p.park_page_id
    GROUP BY p.provider_id, p.park_page_id, p.park_name, s.campground_name
    ORDER BY p.park_name, s.campground_name
  `;

  const byPark = new Map<string, DbParkSummary>();
  for (const row of rows) {
    const key = `${row.provider_id}:${row.park_page_id}`;
    if (!byPark.has(key)) {
      byPark.set(key, {
        providerId: row.provider_id,
        parkPageId: row.park_page_id,
        parkName: row.park_name,
        campgrounds: [],
      });
    }
    byPark.get(key)!.campgrounds.push({ name: row.campground_name, siteCount: row.site_count });
  }
  return Array.from(byPark.values());
}

// ---------------------------------------------------------------------------
// Query: available sites for a stay spanning one or more windows
// ---------------------------------------------------------------------------

export interface CampgroundStayResult {
  campgroundId: string;
  campgroundName: string;
  nightlyFee?: number;
  bookingUrl?: string;
  availableSites: string[];
}

export function getAvailableSitesForStay(
  windows: AvailabilityWindowEntry[],
  arrivalDate: string,
  nights: number
): CampgroundStayResult[] {
  const requiredDates: string[] = [];
  let cur = dayjs(arrivalDate);
  for (let i = 0; i < nights; i++) {
    requiredDates.push(cur.format('YYYY-MM-DD'));
    cur = cur.add(1, 'day');
  }

  const coveringWindows = windows.filter((w) =>
    requiredDates.some((d) => d >= w.windowStart && d <= w.windowEnd)
  );
  if (coveringWindows.length === 0) return [];

  type MergedCg = {
    id: string;
    name: string;
    nightlyFee: number | undefined;
    bookingUrl: string | undefined;
    sites: Map<string, Record<string, string>>;
  };
  const cgMap = new Map<string, MergedCg>();

  for (const w of coveringWindows) {
    for (const cg of w.campgrounds) {
      if (!cgMap.has(cg.name)) {
        cgMap.set(cg.name, {
          id: cg.id,
          name: cg.name,
          nightlyFee: cg.nightlyFee,
          bookingUrl: cg.bookingUrl,
          sites: new Map(),
        });
      }
      const merged = cgMap.get(cg.name)!;
      for (const site of cg.sites) {
        const existing = merged.sites.get(site.name) ?? {};
        Object.assign(existing, site.dates);
        merged.sites.set(site.name, existing);
      }
    }
  }

  const results: CampgroundStayResult[] = [];
  for (const cg of cgMap.values()) {
    const availableSites: string[] = [];
    for (const [siteName, dateLookup] of cg.sites) {
      if (requiredDates.every((d) => dateLookup[d] === 'available')) {
        availableSites.push(siteName);
      }
    }
    const result: CampgroundStayResult = {
      campgroundId: cg.id,
      campgroundName: cg.name,
      availableSites,
    };
    if (cg.nightlyFee !== undefined) result.nightlyFee = cg.nightlyFee;
    if (cg.bookingUrl !== undefined) result.bookingUrl = cg.bookingUrl;
    results.push(result);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Search: sites available for every night in [from, to) across all parks
// ---------------------------------------------------------------------------

export type SearchCampground = {
  name: string;
  nightlyFee: number | null;
  bookingUrl: string | null;
  availableSites: string[];   // bookable (non-walk-up) site names, sorted
  walkUpSites: string[];      // hike/bike first-come sites, sorted
};

export type SearchParkResult = {
  parkPageId: string;
  parkName: string;
  campgrounds: SearchCampground[];
};

/**
 * Find all sites with status='available' on EVERY night from `from` (inclusive)
 * to `to` (exclusive — last night is the night before `to`).
 * Applies FILTER_SQL patterns for the given filterIds. `exclude_walk_up` is
 * intentionally not in FILTER_SQL — walk-up sites are always returned in the
 * `walkUpSites` array and the caller decides whether to display them.
 * Walk-up (hike/bike) sites are separated into walkUpSites; bookable sites go
 * into availableSites. Parks with zero bookable sites still appear if they have
 * walk-up sites.
 */
export async function searchAvailableStays(params: {
  from: string;
  to: string;
  filterIds?: string[];
}): Promise<SearchParkResult[]> {
  const sql = getSql();
  const { from, to, filterIds = [] } = params;
  const nightCount = dayjs(to).diff(dayjs(from), 'day');
  if (nightCount < 1) return [];

  // Build dynamic filter clauses — patterns are hardcoded constants, not user input
  const filterClauses: string[] = [];
  for (const id of filterIds) {
    const f = FILTER_SQL[id];
    if (!f) continue; // unknown filter ids (e.g. exclude_walk_up) are silently skipped
    const col = `(s.site_name || ' ' || s.campground_name) ~* '${f.pattern}'`;
    filterClauses.push(f.exclude ? `NOT (${col})` : col);
  }
  const filterWhere = filterClauses.length > 0 ? `AND ${filterClauses.join(' AND ')}` : '';

  type Row = {
    park_page_id: string;
    park_name: string;
    campground_name: string;
    nightly_fee: string | null;
    booking_url: string | null;
    site_name: string;
    is_walk_up: boolean;
  };

  const rows = await sql.unsafe<Row[]>(`
    SELECT
      p.park_page_id,
      p.park_name,
      cg.campground_name,
      cg.nightly_fee::text,
      cg.booking_url,
      s.site_name,
      s.site_name ~* 'hike\\s*[/&]?\\s*bike' AS is_walk_up
    FROM sites s
    JOIN campgrounds cg
      ON cg.provider_id = s.provider_id
      AND cg.park_page_id = s.park_page_id
      AND cg.campground_name = s.campground_name
    JOIN parks p
      ON p.provider_id = s.provider_id
      AND p.park_page_id = s.park_page_id
    WHERE s.site_id IN (
      SELECT a.site_id
      FROM availability a
      WHERE a.date >= $1::date
        AND a.date < $2::date
        AND a.status = 'available'
      GROUP BY a.site_id
      HAVING COUNT(DISTINCT a.date) = $3::int
    )
      ${filterWhere}
    ORDER BY p.park_name, cg.campground_name, s.site_name
  `, [from, to, String(nightCount)]);

  // Group rows into parks → campgrounds
  const parkMap = new Map<string, SearchParkResult>();
  for (const row of rows) {
    if (!parkMap.has(row.park_page_id)) {
      parkMap.set(row.park_page_id, {
        parkPageId: row.park_page_id,
        parkName: row.park_name,
        campgrounds: [],
      });
    }
    const park = parkMap.get(row.park_page_id)!;
    let cg = park.campgrounds.find((c) => c.name === row.campground_name);
    if (!cg) {
      cg = {
        name: row.campground_name,
        nightlyFee: row.nightly_fee !== null ? Number(row.nightly_fee) : null,
        bookingUrl: row.booking_url,
        availableSites: [],
        walkUpSites: [],
      };
      park.campgrounds.push(cg);
    }
    if (row.is_walk_up) {
      cg.walkUpSites.push(row.site_name);
    } else {
      cg.availableSites.push(row.site_name);
    }
  }

  return [...parkMap.values()];
}

// ---------------------------------------------------------------------------
// Fallback: earliest available date per park within a look-ahead window
// ---------------------------------------------------------------------------

export type NextAvailableResult = {
  parkPageId: string;
  parkName: string;
  earliestDate: string; // YYYY-MM-DD
};

/**
 * For up to 5 parks (optionally restricted by parkPageIds), find the earliest
 * date with any available site within the next `withinDays` days.
 * Used for the "no results" fallback panel.
 */
export async function findNextAvailableDates(params: {
  withinDays?: number;
  parkPageIds?: string[];
}): Promise<NextAvailableResult[]> {
  const sql = getSql();
  const { withinDays = 60, parkPageIds } = params;
  const endDate = dayjs().add(withinDays, 'day').format('YYYY-MM-DD');

  const paramValues: string[] = [endDate];
  const clauses: string[] = [
    `a.status = 'available'`,
    `a.date >= CURRENT_DATE`,
    `a.date <= $1::date`,
    // Walk-up (hike/bike) sites are never reservable; exclude so the fallback
    // panel only surfaces parks with actual bookable openings.
    `NOT (s.site_name ~* 'hike\\s*[/&]?\\s*bike')`,
  ];

  if (parkPageIds && parkPageIds.length > 0) {
    const placeholders = parkPageIds.map((_, i) => `$${paramValues.length + i + 1}`).join(', ');
    clauses.push(`s.park_page_id IN (${placeholders})`);
    paramValues.push(...parkPageIds);
  }

  type Row = { park_page_id: string; park_name: string; earliest_date: string };

  const rows = await sql.unsafe<Row[]>(`
    SELECT s.park_page_id, p.park_name, MIN(a.date)::text AS earliest_date
    FROM availability a
    JOIN sites s ON s.site_id = a.site_id
    JOIN parks p
      ON p.provider_id = s.provider_id
      AND p.park_page_id = s.park_page_id
    WHERE ${clauses.join('\n      AND ')}
    GROUP BY s.park_page_id, p.park_name
    ORDER BY earliest_date
    LIMIT 5
  `, paramValues);

  return rows.map((r) => ({
    parkPageId: r.park_page_id,
    parkName: r.park_name,
    earliestDate: r.earliest_date,
  }));
}
