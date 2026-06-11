import { runScan } from '../../scanner/run-scan.js';
import { endDb } from '../../cache/db.js';

export interface ScanCommandOptions {
  debug?: boolean;
  notify?: boolean;
  targetId?: string;
}

export async function scanCommand(options: ScanCommandOptions = {}): Promise<void> {
  console.log('\nAvailability Scanner\n');

  let summary;
  try {
    summary = await runScan({
      debug: options.debug,
      notify: options.notify !== false,
      targetId: options.targetId,
    });
  } finally {
    await endDb();
  }

  console.log('\n' + '='.repeat(72));
  console.log(`\n${summary.totalNewHits} new hit(s)\n`);
  console.log('='.repeat(72) + '\n');
}
