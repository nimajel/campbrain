import { getSql, endDb } from '../../cache/db.js';
import { classifySite } from '../../catalog/site-classifier.js';

export async function dbBackfillTypesCommand(): Promise<void> {
  const sql = getSql();
  console.log('Backfilling site type columns by name…');

  const rows = await sql<{ site_id: number; site_name: string; campground_name: string }[]>`
    SELECT site_id, site_name, campground_name FROM sites
  `;
  console.log(`Classifying ${rows.length} sites…`);

  let done = 0;
  for (const row of rows) {
    const info = classifySite(row.site_name, row.campground_name);
    await sql`
      UPDATE sites SET
        access = ${info.access},
        site_kind = ${info.siteKind},
        is_group = ${info.isGroup},
        is_equestrian = ${info.isEquestrian},
        is_walk_up = ${info.isWalkUp},
        is_day_use = ${info.isDayUse}
      WHERE site_id = ${row.site_id}
    `;
    done++;
    if (done % 500 === 0) console.log(`  ${done}/${rows.length}`);
  }

  console.log(`Backfill complete: ${done} sites updated.`);
  await endDb();
}
