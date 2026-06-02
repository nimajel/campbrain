import fs from 'fs';
import path from 'path';
import { upsertEntry } from '../../cache/availability-cache.js';
import { initDb, endDb } from '../../cache/db.js';
import type { AvailabilityCache } from '../../cache/types.js';

export async function dbMigrateCommand(): Promise<void> {
  const jsonPath = path.join(process.cwd(), '.campbrain', 'state', 'availability-cache.json');
  if (!fs.existsSync(jsonPath)) {
    console.log('No JSON cache found at', jsonPath);
    return;
  }

  console.log('Initializing DB schema…');
  await initDb();

  console.log('Reading JSON cache…');
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { version?: number; entries?: Record<string, unknown> };
  if (raw.version !== 2) {
    console.error('Unsupported cache version:', raw.version);
    process.exit(1);
  }

  const cache = raw as AvailabilityCache;
  const entries = Object.values(cache.entries);
  console.log(`Migrating ${entries.length} entries…`);

  let done = 0;
  for (const entry of entries) {
    await upsertEntry(entry);
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${entries.length}`);
  }

  console.log(`Migration complete: ${done} entries written.`);
  await endDb();
}
