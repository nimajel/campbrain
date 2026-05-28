import { program } from 'commander';
import { upcomingCommand } from './commands/upcoming.js';
import { scanCommand } from './commands/scan.js';

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
  .action(async (options) => {
    try {
      await scanCommand({ debug: options.debug });
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('sync-calendar')
  .description('Sync reminders to Google Calendar (not implemented)')
  .action(() => {
    console.log('Calendar sync not implemented yet');
  });

program.parse();
