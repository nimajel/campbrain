import { program } from 'commander';
import { upcomingCommand } from './commands/upcoming.js';
import { scanCommand } from './commands/scan.js';
import { workerCommand } from './commands/worker.js';
import { syncCalendarCommand } from './commands/sync-calendar.js';
import { alertsListCommand, alertsEnableCommand, alertsDisableCommand } from './commands/alerts.js';
import { catalogRefreshCommand, catalogListCommand } from './commands/catalog.js';

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

program.parse();
