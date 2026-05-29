// ---------------------------------------------------------------------------
// Catalog refresh — backend process that keeps the park/campground/site
// catalog populated. Users never enter page IDs; this loads the known parks
// index from seed/catalog data and refreshes stale or missing campground data
// using the existing California Parks discovery logic.
// ---------------------------------------------------------------------------

import type { ParkCatalogEntry, DiscoveryStatus } from './types.js';
import { listCatalogParks, getCatalogPark, updateParkMetadata } from './catalog-store.js';
import {
  discoverCaliforniaParkCatalog,
  type DiscoverOptions,
  type DiscoverResult,
} from './discover-california-parks.js';

export type DiscoverFn = (opts: DiscoverOptions) => Promise<DiscoverResult>;

const DEFAULT_MAX_AGE_DAYS = 30;
// Politeness delay between parks so we never hammer the provider.
const DEFAULT_DELAY_MS = 2000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Staleness + selection (pure, testable)
// ---------------------------------------------------------------------------

export function isParkStale(
  park: ParkCatalogEntry,
  nowMs: number,
  maxAgeDays = DEFAULT_MAX_AGE_DAYS
): boolean {
  // Missing campground data is always considered stale.
  if (park.campgrounds.length === 0) return true;
  // Never successfully discovered.
  if (!park.lastUpdatedAt) return true;
  const updatedMs = new Date(park.lastUpdatedAt).getTime();
  if (Number.isNaN(updatedMs)) return true;
  return nowMs - updatedMs > maxAgeDays * MS_PER_DAY;
}

export interface SelectOptions {
  nowMs: number;
  parkName?: string;
  provider?: string;
  force?: boolean;
  maxAgeDays?: number;
  // When set, only parks whose page ID has been confirmed against the provider
  // are eligible. Used for the default (untargeted) auto-refresh so we never
  // hammer the provider with fabricated/guessed page IDs.
  requireVerified?: boolean;
}

export function selectParksToRefresh(
  parks: ParkCatalogEntry[],
  opts: SelectOptions
): ParkCatalogEntry[] {
  let candidates = parks;
  if (opts.provider) {
    candidates = candidates.filter((p) => p.provider === opts.provider);
  }
  if (opts.parkName) {
    const target = opts.parkName.toLowerCase();
    candidates = candidates.filter((p) => p.parkName.toLowerCase() === target);
  }
  if (opts.requireVerified) {
    candidates = candidates.filter((p) => p.pageIdVerified === true);
  }
  if (opts.force) return candidates;
  return candidates.filter((p) => isParkStale(p, opts.nowMs, opts.maxAgeDays));
}

// ---------------------------------------------------------------------------
// Sample date — a near-future, bookable date used to load the availability
// page (which lists campgrounds regardless of vacancy).
// ---------------------------------------------------------------------------

export function defaultSampleDate(nowMs: number, daysAhead = 30): string {
  const d = new Date(nowMs + daysAhead * MS_PER_DAY);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Refresh runner
// ---------------------------------------------------------------------------

export interface RefreshOptions {
  dataDir?: string;
  parkName?: string;
  provider?: string;
  force?: boolean;
  maxAgeDays?: number;
  sampleDate?: string;
  delayMs?: number;
  nowMs?: number;
  discover?: DiscoverFn;
  logger?: (msg: string) => void;
}

export interface RefreshParkResult {
  parkName: string;
  parkPageId: string;
  status: DiscoveryStatus;
  campgroundCount?: number;
  error?: string;
}

export interface RefreshSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  results: RefreshParkResult[];
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function refreshCatalog(opts: RefreshOptions = {}): Promise<RefreshSummary> {
  const nowMs = opts.nowMs ?? Date.now();
  const log = opts.logger ?? (() => {});
  const discover = opts.discover ?? discoverCaliforniaParkCatalog;
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
  const sampleDate = opts.sampleDate ?? defaultSampleDate(nowMs);

  // Default (untargeted) refresh only attempts verified page IDs. Explicit
  // --park or --force is an intentional opt-in to attempt unverified parks.
  const requireVerified = !opts.force && opts.parkName === undefined;

  const allParks = listCatalogParks(opts.dataDir);
  const selected = selectParksToRefresh(allParks, {
    nowMs,
    requireVerified,
    ...(opts.parkName !== undefined ? { parkName: opts.parkName } : {}),
    ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
    ...(opts.force !== undefined ? { force: opts.force } : {}),
    ...(opts.maxAgeDays !== undefined ? { maxAgeDays: opts.maxAgeDays } : {}),
  });

  if (selected.length === 0) {
    log('Catalog is up to date — nothing to refresh.');
    return { attempted: 0, succeeded: 0, failed: 0, results: [] };
  }

  log(`Refreshing ${selected.length} park(s)…`);
  const results: RefreshParkResult[] = [];

  for (let i = 0; i < selected.length; i++) {
    const park = selected[i]!;
    const attemptAt = new Date(nowMs).toISOString();

    // Mark the attempt before contacting the provider.
    updateParkMetadata(
      park.parkPageId,
      { lastDiscoveryAttemptAt: attemptAt, discoveryStatus: 'pending' },
      opts.dataDir
    );

    try {
      await discover({
        parkPageId: park.parkPageId,
        parkName: park.parkName,
        sampleDate,
        ...(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {}),
      });

      // Re-read to count freshly written campgrounds.
      const refreshed = getCatalogPark(park.parkPageId, opts.dataDir);
      const campgroundCount = refreshed?.campgrounds.length ?? 0;

      // A page that returns no campgrounds usually means the page ID is wrong.
      // Treat it as a failure rather than a misleading "success".
      if (campgroundCount === 0) {
        const message = 'No campgrounds found — the page ID may be incorrect.';
        updateParkMetadata(
          park.parkPageId,
          {
            discoveryStatus: 'failed',
            lastDiscoveryAttemptAt: attemptAt,
            discoveryError: message,
          },
          opts.dataDir
        );
        results.push({
          parkName: park.parkName,
          parkPageId: park.parkPageId,
          status: 'failed',
          campgroundCount,
          error: message,
        });
        log(`  ❌ ${park.parkName} — ${message}`);
      } else {
        updateParkMetadata(
          park.parkPageId,
          {
            discoveryStatus: 'success',
            lastUpdatedAt: new Date(nowMs).toISOString(),
            lastDiscoveryAttemptAt: attemptAt,
            discoveryError: undefined,
          },
          opts.dataDir
        );

        results.push({
          parkName: park.parkName,
          parkPageId: park.parkPageId,
          status: 'success',
          campgroundCount,
        });
        log(`  ✅ ${park.parkName} — ${campgroundCount} campground(s)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateParkMetadata(
        park.parkPageId,
        {
          discoveryStatus: 'failed',
          lastDiscoveryAttemptAt: attemptAt,
          discoveryError: message,
        },
        opts.dataDir
      );
      results.push({
        parkName: park.parkName,
        parkPageId: park.parkPageId,
        status: 'failed',
        error: message,
      });
      log(`  ❌ ${park.parkName} — ${message}`);
    }

    if (i < selected.length - 1) await sleep(delayMs);
  }

  const succeeded = results.filter((r) => r.status === 'success').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  return { attempted: selected.length, succeeded, failed, results };
}
