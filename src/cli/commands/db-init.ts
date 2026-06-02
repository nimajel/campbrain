import { initDb, endDb } from '../../cache/db.js';

export async function dbInitCommand(): Promise<void> {
  console.log('Initializing database schema…');
  await initDb();
  console.log('Done.');
  await endDb();
}
