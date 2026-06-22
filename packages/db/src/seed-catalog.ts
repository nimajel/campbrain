import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { classifySite } from "@campbrain/core";

type CatalogSite = { id: string; name: string };
type CatalogCampground = { id: string; name: string; bookingUrl?: string; nightlyFee?: number; sites: CatalogSite[] };
type CatalogPark = { parkName: string; parkPageId: string; campgrounds: CatalogCampground[]; lat?: number; lon?: number };
type ProviderCatalog = { provider: string; parks: CatalogPark[] };

type Sql = ReturnType<typeof postgres>;

const PROVIDER_ID = "california-parks";
const PROVIDER_NAME = "California State Parks";

function defaultCatalogPath(): string {
  // packages/db/src/seed-catalog.ts → repo root is ../../../
  return fileURLToPath(new URL("../../../data/catalog/california-parks.json", import.meta.url));
}

/** Upsert the CA-parks catalog (providers/parks/campgrounds/sites) into Postgres. Returns row counts. */
export async function seedCatalog(
  sql: Sql,
  opts: { catalogPath?: string } = {},
): Promise<{ parks: number; campgrounds: number; sites: number }> {
  const path = opts.catalogPath ?? defaultCatalogPath();
  const catalog = JSON.parse(readFileSync(path, "utf-8")) as ProviderCatalog;

  await sql`INSERT INTO providers (provider_id, display_name) VALUES (${PROVIDER_ID}, ${PROVIDER_NAME}) ON CONFLICT (provider_id) DO NOTHING`;

  let parkCount = 0, cgCount = 0, siteCount = 0;
  for (const park of catalog.parks) {
    await sql`
      INSERT INTO parks (provider_id, park_page_id, park_name, latitude, longitude)
      VALUES (${PROVIDER_ID}, ${park.parkPageId}, ${park.parkName}, ${park.lat ?? null}, ${park.lon ?? null})
      ON CONFLICT (provider_id, park_page_id) DO UPDATE SET
        park_name = EXCLUDED.park_name, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude`;
    parkCount++;

    const cgByName = new Map<string, CatalogCampground>();
    for (const cg of park.campgrounds) cgByName.set(cg.name, cg);
    const cgs = [...cgByName.values()];
    if (cgs.length === 0) continue;

    const cgRows = cgs.map((cg) => ({
      provider_id: PROVIDER_ID,
      park_page_id: park.parkPageId,
      campground_name: cg.name,
      campground_id: cg.id,
      nightly_fee: cg.nightlyFee ?? null,
      booking_url: cg.bookingUrl ?? null,
    }));
    await sql`
      INSERT INTO campgrounds ${sql(cgRows, "provider_id", "park_page_id", "campground_name", "campground_id", "nightly_fee", "booking_url")}
      ON CONFLICT (provider_id, park_page_id, campground_name) DO UPDATE SET
        campground_id = EXCLUDED.campground_id, nightly_fee = EXCLUDED.nightly_fee, booking_url = EXCLUDED.booking_url`;
    cgCount += cgRows.length;

    const siteByKey = new Map<string, { cgName: string; site: CatalogSite }>();
    for (const cg of cgs) for (const s of cg.sites) siteByKey.set(`${cg.name}::${s.name}`, { cgName: cg.name, site: s });
    const siteRows = [...siteByKey.values()].map(({ cgName, site }) => {
      const info = classifySite(site.name, cgName);
      return {
        provider_id: PROVIDER_ID,
        park_page_id: park.parkPageId,
        campground_name: cgName,
        site_name: site.name,
        access: info.access,
        site_kind: info.siteKind,
        is_group: info.isGroup,
        is_equestrian: info.isEquestrian,
        is_walk_up: info.isWalkUp,
        is_day_use: info.isDayUse,
      };
    });
    if (siteRows.length === 0) continue;
    await sql`
      INSERT INTO sites ${sql(siteRows, "provider_id", "park_page_id", "campground_name", "site_name", "access", "site_kind", "is_group", "is_equestrian", "is_walk_up", "is_day_use")}
      ON CONFLICT (provider_id, park_page_id, campground_name, site_name) DO UPDATE SET
        access = EXCLUDED.access, site_kind = EXCLUDED.site_kind, is_group = EXCLUDED.is_group,
        is_equestrian = EXCLUDED.is_equestrian, is_walk_up = EXCLUDED.is_walk_up, is_day_use = EXCLUDED.is_day_use`;
    siteCount += siteRows.length;
  }
  return { parks: parkCount, campgrounds: cgCount, sites: siteCount };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const counts = await seedCatalog(sql);
    console.log(`✅ seeded ${counts.parks} parks, ${counts.campgrounds} campgrounds, ${counts.sites} sites`);
  } finally {
    await sql.end();
  }
}

// Run as CLI only when invoked directly (bun sets import.meta.main); not when imported by tests.
if (import.meta.main) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
