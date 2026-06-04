import { runProactiveScan } from '../../scanner/proactive-scanner.js';

export interface CacheRefreshOptions {
  force?: boolean;
  daysAhead?: number;
  provider?: string;
}

export async function cacheRefreshCommand(options: CacheRefreshOptions = {}): Promise<void> {
  const daysAhead = options.daysAhead ?? 180;
  const scope = options.provider ? ` (${options.provider} only)` : '';
  console.log(`\nRefreshing availability cache (${daysAhead}-day window${scope})…\n`);

  const summary = await runProactiveScan({
    daysAhead,
    ...(options.force && { force: true }),
    ...(options.provider && { provider: options.provider }),
    logger: (msg) => console.log(msg),
  });

  console.log(`
Done.
  Parks scanned:  ${summary.fetchCount} fetches
  Cache writes:   ${summary.cacheWrites}
  Errors:         ${summary.fetchErrors}
  Duration:       ${(summary.durationMs / 1000).toFixed(1)}s
`);
}
