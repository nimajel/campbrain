import postgres from 'postgres';

let _sql: ReturnType<typeof postgres> | null = null;

export function getSql(): ReturnType<typeof postgres> {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    _sql = postgres(process.env.DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      onnotice: () => {}, // suppress IF NOT EXISTS / index-already-exists NOTICE logs
    });
  }
  return _sql;
}

export async function endDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}

// ---------------------------------------------------------------------------
// Materialized view definition — kept here so both initDb (IF NOT EXISTS) and
// rebuildMaterializedView (DROP + recreate) share the same SQL.
// ---------------------------------------------------------------------------
// Walk-up / first-come sites (hike/bike) appear in `walk_up_sites` and are
// excluded from `available_sites` so they never inflate bookable counts.
const MV_DEFINITION = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS mv_available_stays AS
  WITH avail AS (
    SELECT
      s.provider_id,
      s.park_page_id,
      s.campground_name,
      s.site_name,
      s.site_id,
      a.date,
      s.site_name ~* 'hike\\s*[/&]?\\s*bike' AS is_walk_up
    FROM availability a
    JOIN sites s ON s.site_id = a.site_id
    WHERE a.status = 'available' AND a.date >= CURRENT_DATE
  ),
  stays AS (
    -- 1-night stays: all sites (bookable + walk-up)
    SELECT a.provider_id, a.park_page_id, a.campground_name, a.date AS arrival_date, 1 AS nights,
           a.site_name, a.is_walk_up
    FROM avail a
    UNION ALL
    -- 2-night stays: bookable sites only (walk-up cannot be reserved multi-night)
    SELECT a1.provider_id, a1.park_page_id, a1.campground_name, a1.date AS arrival_date, 2 AS nights,
           a1.site_name, a1.is_walk_up
    FROM avail a1
    JOIN avail a2 ON a2.site_id = a1.site_id AND a2.date = a1.date + interval '1 day'
    WHERE NOT a1.is_walk_up
  )
  SELECT
    s.provider_id,
    s.park_page_id,
    p.park_name,
    s.campground_name,
    cg.nightly_fee::numeric(8,2),
    cg.booking_url,
    s.arrival_date,
    s.nights,
    coalesce(
      array_agg(s.site_name ORDER BY s.site_name) FILTER (WHERE NOT s.is_walk_up),
      '{}'::text[]
    ) AS available_sites,
    coalesce(
      array_agg(DISTINCT s.site_name ORDER BY s.site_name) FILTER (WHERE s.is_walk_up),
      '{}'::text[]
    ) AS walk_up_sites
  FROM stays s
  JOIN parks p ON p.provider_id = s.provider_id AND p.park_page_id = s.park_page_id
  JOIN campgrounds cg
    ON cg.provider_id = s.provider_id
    AND cg.park_page_id = s.park_page_id
    AND cg.campground_name = s.campground_name
  GROUP BY s.provider_id, s.park_page_id, p.park_name, s.campground_name,
           cg.nightly_fee, cg.booking_url, s.arrival_date, s.nights
  WITH NO DATA
`;

export async function initDb(): Promise<void> {
  const db = getSql();

  await db`
    CREATE TABLE IF NOT EXISTS providers (
      provider_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      base_url TEXT
    )
  `;

  await db`
    INSERT INTO providers (provider_id, display_name, base_url)
    VALUES ('california-parks', 'California State Parks', 'https://www.parks.ca.gov')
    ON CONFLICT (provider_id) DO NOTHING
  `;

  await db`
    INSERT INTO providers (provider_id, display_name, base_url)
    VALUES ('recreation-gov', 'Recreation.gov', 'https://www.recreation.gov')
    ON CONFLICT (provider_id) DO NOTHING
  `;

  await db`
    CREATE TABLE IF NOT EXISTS parks (
      provider_id TEXT NOT NULL REFERENCES providers(provider_id),
      park_page_id TEXT NOT NULL,
      park_name TEXT NOT NULL,
      PRIMARY KEY (provider_id, park_page_id)
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS campgrounds (
      provider_id TEXT NOT NULL,
      park_page_id TEXT NOT NULL,
      campground_name TEXT NOT NULL,
      campground_id TEXT NOT NULL,
      nightly_fee NUMERIC(8,2),
      booking_url TEXT,
      PRIMARY KEY (provider_id, park_page_id, campground_name),
      FOREIGN KEY (provider_id, park_page_id) REFERENCES parks(provider_id, park_page_id)
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS sites (
      site_id SERIAL PRIMARY KEY,
      provider_id TEXT NOT NULL,
      park_page_id TEXT NOT NULL,
      campground_name TEXT NOT NULL,
      site_name TEXT NOT NULL,
      UNIQUE (provider_id, park_page_id, campground_name, site_name),
      FOREIGN KEY (provider_id, park_page_id, campground_name)
        REFERENCES campgrounds(provider_id, park_page_id, campground_name)
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS scan_windows (
      provider_id TEXT NOT NULL,
      park_page_id TEXT NOT NULL,
      window_start DATE NOT NULL,
      window_end DATE NOT NULL,
      scanned_at TIMESTAMPTZ NOT NULL,
      source_url TEXT NOT NULL,
      PRIMARY KEY (provider_id, park_page_id, window_start),
      FOREIGN KEY (provider_id, park_page_id) REFERENCES parks(provider_id, park_page_id)
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS availability (
      site_id INTEGER NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
      date DATE NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('available', 'unavailable', 'unknown')),
      PRIMARY KEY (site_id, date)
    )
  `;

  await db`CREATE INDEX IF NOT EXISTS idx_availability_date ON availability(date)`;
  await db`CREATE INDEX IF NOT EXISTS idx_availability_available ON availability(date) WHERE status = 'available'`;
  await db`CREATE INDEX IF NOT EXISTS idx_scan_windows_end ON scan_windows(window_end)`;
  await db`CREATE INDEX IF NOT EXISTS idx_sites_park ON sites(provider_id, park_page_id)`;

  await db.unsafe(MV_DEFINITION);

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_available_stays_pk
      ON mv_available_stays(provider_id, park_page_id, campground_name, arrival_date, nights)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_mv_available_stays_date
      ON mv_available_stays(arrival_date)
  `;
}

/**
 * Drop and recreate the materialized view with the current definition.
 * Required when the MV schema changes (e.g. adding walk_up_sites column).
 * After this call, run refreshMaterializedView() to repopulate data.
 */
export async function rebuildMaterializedView(): Promise<void> {
  const db = getSql();
  await db`DROP MATERIALIZED VIEW IF EXISTS mv_available_stays`;
  await db.unsafe(MV_DEFINITION.replace('IF NOT EXISTS ', ''));
  await db`
    CREATE UNIQUE INDEX idx_mv_available_stays_pk
      ON mv_available_stays(provider_id, park_page_id, campground_name, arrival_date, nights)
  `;
  await db`
    CREATE INDEX idx_mv_available_stays_date
      ON mv_available_stays(arrival_date)
  `;
}
