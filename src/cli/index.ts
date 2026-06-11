import 'dotenv/config';
import { program } from 'commander';
import { upcomingCommand } from './commands/upcoming.js';
import { scanCommand } from './commands/scan.js';
import { workerCommand } from './commands/worker.js';
import { syncCalendarCommand } from './commands/sync-calendar.js';
import { alertsListCommand, alertsEnableCommand, alertsDisableCommand } from './commands/alerts.js';
import { catalogRefreshCommand, catalogListCommand } from './commands/catalog.js';
import { cacheRefreshCommand } from './commands/cache-refresh.js';
import { dbInitCommand } from './commands/db-init.js';
import { dbMigrateCommand } from './commands/db-migrate.js';
import { dbBackfillTypesCommand } from './commands/db-backfill-types.js';
import { notifyTestCommand } from './commands/notify-test.js';
import { migrateTargetsCommand } from './commands/migrate-targets.js';

program
  .name('campbrain')
  .description('Camping reservation assistant for California campgrounds')
  .version('1.0.0');

program
  .command('upcoming')
  .description('Show upcoming booking windows and reminders')
  .action(() => {
    try {
      upcomingCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('scan')
  .description('Check availability for configured targets')
  .option('--target <id>', 'Scan specific target by ID')
  .option('--debug', 'Save debug HTML for all scans')
  .option('--no-notify', 'Suppress all notifications')
  .action(async (options) => {
    try {
      await scanCommand({ debug: options.debug, notify: options.notify, targetId: options.target });
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('worker')
  .description('Run scheduled availability scans on an interval')
  .option('--interval-minutes <n>', 'Scan interval in minutes (min 15, default 60)', parseInt)
  .option('--no-scan-on-start', 'Wait for the first interval before scanning')
  .option('--target <id>', 'Scan specific target by ID')
  .option('--debug', 'Save debug HTML for all scans')
  .option('--no-notify', 'Suppress all notifications')
  .action(async (options) => {
    try {
      await workerCommand({
        intervalMinutes: options.intervalMinutes,
        scanOnStart: options.scanOnStart,
        targetId: options.target,
        debug: options.debug,
        notify: options.notify,
      });
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

const alertsCmd = program
  .command('alerts')
  .description('Manage availability alerts');

alertsCmd
  .command('list')
  .description('List all configured alerts')
  .action(() => {
    try {
      alertsListCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

alertsCmd
  .command('enable <id>')
  .description('Enable an alert by ID')
  .action((id: string) => {
    try {
      alertsEnableCommand(id);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

alertsCmd
  .command('disable <id>')
  .description('Disable an alert by ID')
  .action((id: string) => {
    try {
      alertsDisableCommand(id);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

const catalogCmd = program
  .command('catalog')
  .description('Maintain the park/campground/site catalog (backend/admin)');

catalogCmd
  .command('refresh')
  .description('Refresh campground/site data for stale or missing parks')
  .option('--park <name>', 'Refresh only the named park')
  .option('--provider <provider>', 'Refresh only parks for this provider')
  .option('--force', 'Refresh all matching parks regardless of staleness')
  .option('--max-age-days <n>', 'Staleness threshold in days (default 30)', parseInt)
  .action(async (options) => {
    try {
      await catalogRefreshCommand({
        park: options.park,
        provider: options.provider,
        force: options.force,
        maxAgeDays: options.maxAgeDays,
      });
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

catalogCmd
  .command('list')
  .description('List parks in the catalog with discovery status')
  .action(() => {
    try {
      catalogListCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('cache-refresh')
  .description('Refresh the availability cache for all parks across the 180-day window')
  .option('--force', 'Re-fetch all windows, even if cache is still fresh')
  .option('--days-ahead <n>', 'Days to cover (default 180)', parseInt)
  .option('--provider <name>', 'Limit scan to a single provider (e.g. recreation-gov, california-parks)')
  .action(async (options) => {
    try {
      await cacheRefreshCommand({ force: options.force, daysAhead: options.daysAhead, provider: options.provider });
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('notify-test')
  .description('Send a sample alert through the console + email notification services')
  .action(async () => {
    try {
      await notifyTestCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('sync-calendar')
  .description('Sync booking-window reminder events to Google Calendar')
  .option('--dry-run', 'Print events that would be created/updated without calling Google')
  .option('--target <id>', 'Sync specific target by ID')
  .action(async (options) => {
    try {
      await syncCalendarCommand({ dryRun: options.dryRun, targetId: options.target });
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

const dbCmd = program.command('db').description('Database management');

dbCmd.command('init').description('Initialize database schema').action(async () => {
  try { await dbInitCommand(); }
  catch (e) { console.error(e); process.exit(1); }
});

dbCmd.command('migrate').description('Migrate JSON cache to PostgreSQL').action(async () => {
  try { await dbMigrateCommand(); }
  catch (e) { console.error(e); process.exit(1); }
});

dbCmd.command('backfill-types')
  .description('Classify existing sites rows by name and set type columns')
  .action(async () => {
    try { await dbBackfillTypesCommand(); }
    catch (e) { console.error(e); process.exit(1); }
  });

dbCmd.command('migrate-targets')
  .description('Migrate data/targets.json → saved_searches table (idempotent)')
  .action(async () => {
    try { await migrateTargetsCommand(); }
    catch (e) { console.error(e); process.exit(1); }
  });

dbCmd.command('rebuild-mv')
  .description('Rebuild materialized view (required after MV schema changes)')
  .action(async () => {
    try {
      const { rebuildMaterializedView, refreshMaterializedView } = await import('../cache/availability-cache.js');
      const { endDb } = await import('../cache/db.js');
      console.log('Dropping and recreating mv_available_stays…');
      await rebuildMaterializedView();
      console.log('Refreshing data…');
      await refreshMaterializedView();
      console.log('Done.');
      await endDb();
    } catch (e) { console.error(e); process.exit(1); }
  });

program.parse();
