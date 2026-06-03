import { runScan } from '../../scanner/run-scan.js';
import { runProactiveScan } from '../../scanner/proactive-scanner.js';
import { loadTargets } from '../../config/targets.js';

const MIN_INTERVAL_MINUTES = 15;
const DEFAULT_INTERVAL_MINUTES = 60;
const DEFAULT_PROACTIVE_INTERVAL_MINUTES = 120;

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
  proactiveIntervalMinutes?: number;
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

  const rawProactive = options.proactiveIntervalMinutes
    ?? (process.env['CAMPBRAIN_PROACTIVE_INTERVAL_MINUTES'] !== undefined
      ? parseInt(process.env['CAMPBRAIN_PROACTIVE_INTERVAL_MINUTES'], 10)
      : undefined);
  const proactiveIntervalMinutes = typeof rawProactive === 'number' && !isNaN(rawProactive) && rawProactive >= MIN_INTERVAL_MINUTES
    ? rawProactive
    : DEFAULT_PROACTIVE_INTERVAL_MINUTES;

  const scanOnStart =
    options.scanOnStart !== false &&
    process.env['CAMPBRAIN_SCAN_ON_START'] !== 'false';

  const targets = loadTargets().filter(
    (t) => options.targetId === undefined || t.id === options.targetId
  );

  console.log('\n🏕️  CampBrain Worker\n');
  console.log(`  Started:        ${timestamp()}`);
  console.log(`  Alert scan:     every ${intervalMinutes} minute${intervalMinutes !== 1 ? 's' : ''} (${targets.length} target${targets.length !== 1 ? 's' : ''})`);
  console.log(`  Cache refresh:  every ${proactiveIntervalMinutes} minute${proactiveIntervalMinutes !== 1 ? 's' : ''} (all 88 CA parks)`);
  if (targets.length > 0) {
    for (const t of targets) console.log(`    • ${t.name}`);
  }
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
    console.log(`[${timestamp()}] Alert scan #${scanCount} starting…`);

    try {
      const summary = await runScan({
        targetId: options.targetId,
        debug: options.debug,
        notify: options.notify !== false,
      });

      const { totalCandidates, totalMatches, totalNewHits } = summary;
      console.log(
        `[${timestamp()}] Alert scan #${scanCount} done — ` +
          `${totalCandidates} candidates, ` +
          `${totalMatches} match${totalMatches !== 1 ? 'es' : ''}, ` +
          `${totalNewHits} new hit${totalNewHits !== 1 ? 's' : ''}`
      );
    } catch (err) {
      console.error(
        `[${timestamp()}] Alert scan #${scanCount} error:`,
        err instanceof Error ? err.message : err
      );
    } finally {
      running = false;
    }
  }

  // Schedule recurring alert scans
  const intervalMs = intervalMinutes * 60 * 1_000;
  const timer = setInterval(() => {
    void runScheduledScan();
  }, intervalMs);

  // Schedule proactive availability cache scans (independent interval)
  let proactiveRunning = false;
  const proactiveIntervalMs = proactiveIntervalMinutes * 60 * 1_000;

  function runProactiveNow() {
    if (proactiveRunning) return;
    proactiveRunning = true;
    console.log(`[${timestamp()}] Proactive scan starting…`);
    runProactiveScan({
      logger: (msg) => console.log(`[${timestamp()}] ${msg}`),
    })
      .then((summary) => {
        console.log(
          `[${timestamp()}] Proactive scan done — ` +
            `${summary.fetchCount} fetches, ` +
            `${summary.cacheWrites} cache writes, ` +
            `${summary.fetchErrors} errors, ` +
            `${(summary.durationMs / 1000).toFixed(1)}s`
        );
      })
      .catch((err) => {
        console.error(`[${timestamp()}] Proactive scan error:`, err instanceof Error ? err.message : err);
      })
      .finally(() => { proactiveRunning = false; });
  }

  const proactiveTimer = setInterval(runProactiveNow, proactiveIntervalMs);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n[${timestamp()}] Shutting down worker…`);
    clearInterval(timer);
    clearInterval(proactiveTimer);
    process.exit(0);
  });

  // Run both scans immediately on startup, then repeat on their own intervals
  if (scanOnStart) {
    await runScheduledScan();
  } else {
    console.log(`[${timestamp()}] Waiting ${intervalMinutes}m before first alert scan (scan-on-start disabled)`);
  }

  // Always start the proactive scan immediately — don't wait 2 hours for the
  // first cache population.
  runProactiveNow();
}
