import { runScan } from '../../scanner/run-scan.js';
import { loadTargets } from '../../config/targets.js';

const MIN_INTERVAL_MINUTES = 15;
const DEFAULT_INTERVAL_MINUTES = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function resolveIntervalMinutes(
  flagValue: number | undefined,
  envValue: string | undefined
): number {
  const raw = flagValue ?? (envValue !== undefined ? parseInt(envValue, 10) : undefined);
  const parsed = typeof raw === 'number' && !isNaN(raw) ? raw : DEFAULT_INTERVAL_MINUTES;

  if (parsed < MIN_INTERVAL_MINUTES) {
    console.warn(
      `⚠️  Requested interval ${parsed}m is below the minimum of ${MIN_INTERVAL_MINUTES}m. ` +
        `Clamping to ${MIN_INTERVAL_MINUTES}m.`
    );
    return MIN_INTERVAL_MINUTES;
  }

  return parsed;
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ---------------------------------------------------------------------------
// Worker command
// ---------------------------------------------------------------------------

export interface WorkerOptions {
  intervalMinutes?: number;
  scanOnStart?: boolean;
  targetId?: string;
  debug?: boolean;
  notify?: boolean;
}

export async function workerCommand(options: WorkerOptions = {}): Promise<void> {
  const intervalMinutes = resolveIntervalMinutes(
    options.intervalMinutes,
    process.env['CAMPBRAIN_SCAN_INTERVAL_MINUTES']
  );

  const scanOnStart =
    options.scanOnStart !== false &&
    process.env['CAMPBRAIN_SCAN_ON_START'] !== 'false';

  const targets = loadTargets().filter(
    (t) => options.targetId === undefined || t.id === options.targetId
  );

  console.log('\n🏕️  CampBrain Worker\n');
  console.log(`  Started:  ${timestamp()}`);
  console.log(`  Interval: every ${intervalMinutes} minute${intervalMinutes !== 1 ? 's' : ''}`);
  console.log(`  Targets:  ${targets.length}`);
  for (const t of targets) console.log(`    • ${t.name}`);
  console.log('');

  let scanCount = 0;
  let running = false;

  async function runScheduledScan(): Promise<void> {
    if (running) {
      console.log(`[${timestamp()}] Previous scan still in progress — skipping`);
      return;
    }
    running = true;
    scanCount++;
    console.log(`[${timestamp()}] Scan #${scanCount} starting…`);

    try {
      const summary = await runScan({
        targetId: options.targetId,
        debug: options.debug,
        notify: options.notify !== false,
      });

      const { totalCandidates, totalMatches, totalNewHits } = summary;
      console.log(
        `[${timestamp()}] Scan #${scanCount} done — ` +
          `${totalCandidates} candidates, ` +
          `${totalMatches} match${totalMatches !== 1 ? 'es' : ''}, ` +
          `${totalNewHits} new hit${totalNewHits !== 1 ? 's' : ''}`
      );
    } catch (err) {
      console.error(
        `[${timestamp()}] Scan #${scanCount} error:`,
        err instanceof Error ? err.message : err
      );
    } finally {
      running = false;
    }
  }

  // Schedule recurring scans
  const intervalMs = intervalMinutes * 60 * 1_000;
  const timer = setInterval(() => {
    void runScheduledScan();
  }, intervalMs);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n[${timestamp()}] Shutting down worker…`);
    clearInterval(timer);
    process.exit(0);
  });

  // Initial scan
  if (scanOnStart) {
    await runScheduledScan();
  } else {
    console.log(`[${timestamp()}] Waiting ${intervalMinutes}m before first scan (scan-on-start disabled)`);
  }
}
