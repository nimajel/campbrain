import dayjs from 'dayjs';
import { listCatalogParks, updateParkMetadata } from '../catalog/catalog-store.js';
import { CaliforniaParksProvider } from '../providers/california-parks-provider.js';
import { RecreationGovProvider } from '../providers/recreation-gov-provider.js';
import type { AvailabilityProvider } from '../providers/availability-provider.js';
import {
  findStaleWindows,
  upsertEntry,
  evictExpired,
  refreshMaterializedView,
} from '../cache/availability-cache.js';
import { initDb } from '../cache/db.js';
import { runWithConcurrency } from '../utils/concurrency.js';

const FETCH_CONCURRENCY = 5;
const BATCH_DELAY_MS = 500;

export interface ProactiveScanOptions {
  /** Days ahead to cover. Default: 180. */
  daysAhead?: number;
  /** Scan only pageIdVerified parks. Default: false. */
  verifiedOnly?: boolean;
  /** Force re-scan even when cache is fresh. Default: false. */
  force?: boolean;
  /** Restrict scan to a single provider, e.g. 'recreation-gov'. Default: all providers. */
  provider?: string;
  todayOverride?: string;
  logger?: (msg: string) => void;
}

export interface ProactiveScanSummary {
  totalWindows: number;
  staleCount: number;
  fetchCount: number;
  fetchErrors: number;
  cacheWrites: number;
  durationMs: number;
}

function getProvider(providerName: string): AvailabilityProvider {
  switch (providerName) {
    case 'recreation-gov':
      return new RecreationGovProvider();
    default:
      return new CaliforniaParksProvider();
  }
}

export async function runProactiveScan(
  opts: ProactiveScanOptions = {}
): Promise<ProactiveScanSummary> {
  const startMs = Date.now();
  const log = opts.logger ?? (() => {});
  const daysAhead = opts.daysAhead ?? 180;
  const verifiedOnly = opts.verifiedOnly ?? false;

  await initDb();

  const today = opts.todayOverride ? dayjs(opts.todayOverride) : dayjs();
  const rangeStart = today.add(2, 'day').format('YYYY-MM-DD');
  const rangeEnd = today.add(daysAhead, 'day').format('YYYY-MM-DD');

  // Eligible parks: any provider with a valid page ID.
  // CA Parks requires pre-discovered campground/site data (populated by catalog:refresh).
  // Rec.gov discovers sites live from the availability API — just needs a parkPageId.
  const parks = listCatalogParks().filter((p) => {
    if (opts.provider && p.provider !== opts.provider) return false;
    if (verifiedOnly && !p.pageIdVerified) return false;
    // Skip parks permanently marked as not having a usable availability endpoint
    if (p.discoveryStatus === 'failed') return false;
    if (p.provider === 'recreation-gov') return !!p.parkPageId;
    return p.campgrounds.some((c) => c.sites.length > 0);
  });

  if (parks.length === 0) {
    log('No eligible parks found (run catalog refresh first).');
    return { totalWindows: 0, staleCount: 0, fetchCount: 0, fetchErrors: 0, cacheWrites: 0, durationMs: Date.now() - startMs };
  }

  // Generate (park × window) candidates per provider
  type Candidate = { parkPageId: string; windowStart: string; windowEnd: string; providerName: string };
  const allCandidates: Candidate[] = parks.flatMap((park) => {
    const provider = getProvider(park.provider);
    return provider.generateCacheWindows(rangeStart, rangeEnd).map((w) => ({
      parkPageId: park.parkPageId,
      windowStart: w.windowStart,
      windowEnd: w.windowEnd,
      providerName: park.provider,
    }));
  });

  const totalWindows = allCandidates.length;

  // Filter to stale/missing — group by provider so we batch the DB queries
  let toScan: Candidate[];
  if (opts.force) {
    toScan = allCandidates;
  } else {
    const byProvider = new Map<string, Candidate[]>();
    for (const c of allCandidates) {
      const list = byProvider.get(c.providerName) ?? [];
      list.push(c);
      byProvider.set(c.providerName, list);
    }
    const staleLists = await Promise.all(
      Array.from(byProvider.entries()).map(async ([providerName, candidates]) => {
        const staleKeys = new Set(
          (await findStaleWindows(
            candidates.map((c) => ({ parkPageId: c.parkPageId, windowStart: c.windowStart })),
            providerName
          )).map((s) => `${s.parkPageId}::${s.windowStart}`)
        );
        return candidates.filter((c) => staleKeys.has(`${c.parkPageId}::${c.windowStart}`));
      })
    );
    toScan = staleLists.flat();
  }

  const staleCount = toScan.length;
  log(`Proactive scan: ${parks.length} parks, ${allCandidates.length} windows (${daysAhead}d ahead)`);
  log(`  ${totalWindows} total — ${staleCount} stale / missing`);

  if (staleCount === 0) {
    await evictExpired();
    return { totalWindows, staleCount: 0, fetchCount: 0, fetchErrors: 0, cacheWrites: 0, durationMs: Date.now() - startMs };
  }

  const parkByPageId = new Map(parks.map((p) => [p.parkPageId, p]));
  let fetchCount = 0;
  let fetchErrors = 0;
  let cacheWrites = 0;

  // Track parks permanently marked unsupported within this run so we skip
  // their remaining windows immediately without making further API calls.
  const unsupportedParkIds = new Set<string>();

  // Build task function for a single candidate
  const makeTask = (candidate: Candidate) => async () => {
    const park = parkByPageId.get(candidate.parkPageId);
    if (!park) return;

    // Skip parks already flagged as unsupported in this run
    if (unsupportedParkIds.has(candidate.parkPageId)) return;

    const provider = getProvider(park.provider);
    fetchCount++;

    const entry = await provider.proactiveScanWindow(
      candidate.parkPageId,
      { windowStart: candidate.windowStart, windowEnd: candidate.windowEnd },
      park.parkName,
      park.campgrounds
    );

    if (entry === 'unsupported') {
      // Permanent: this park has no campground availability endpoint.
      // Mark in catalog so it's excluded from all future scans.
      unsupportedParkIds.add(candidate.parkPageId);
      updateParkMetadata(candidate.parkPageId, {
        discoveryStatus: 'failed',
        discoveryError: 'No campground availability endpoint (HTTP 400/404)',
      });
      return;
    }

    if (entry === null) {
      fetchErrors++;
      log(`  ✗ ${park.parkName} ${candidate.windowStart} — fetch failed, will retry next cycle`);
      return;
    }

    await upsertEntry(entry, park.provider);
    cacheWrites++;

    const windowsWithAvail = entry.campgrounds.filter((c) =>
      c.sites.some((s) => Object.values(s.dates).includes('available'))
    ).length;
    if (windowsWithAvail > 0) {
      log(`  ✓ ${park.parkName} ${candidate.windowStart} — ${windowsWithAvail} campground(s) with availability`);
    }
  };

  // Run each provider's tasks with its declared concurrency. Different providers
  // have different rate limits — Rec.gov is much stricter than CA Parks.
  const byProvider = new Map<string, Candidate[]>();
  for (const c of toScan) {
    const list = byProvider.get(c.providerName) ?? [];
    list.push(c);
    byProvider.set(c.providerName, list);
  }

  for (const [providerName, candidates] of byProvider) {
    const provider = getProvider(providerName);
    const concurrency = provider.proactiveConcurrency ?? FETCH_CONCURRENCY;
    const delayMs = provider.batchDelayMs ?? BATCH_DELAY_MS;
    // Use concurrency as batchSize (not concurrency*2) so the delay fires
    // after every batch — critical for providers like Rec.gov where concurrency=1
    // and each "batch" is a single request.
    const batchSize = concurrency;
    const tasks = candidates.map(makeTask);

    log(`  Scanning ${candidates.length} windows for ${providerName} (concurrency: ${concurrency}, delay: ${delayMs}ms)…`);

    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      await runWithConcurrency(batch, concurrency);
      if (i + batch.length < tasks.length) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  const evicted = await evictExpired();
  if (evicted > 0) log(`  Evicted ${evicted} expired cache entries`);

  try {
    await refreshMaterializedView();
    log('  MV refreshed: mv_available_stays');
  } catch (err) {
    log(`  MV refresh failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  return { totalWindows, staleCount, fetchCount, fetchErrors, cacheWrites, durationMs: Date.now() - startMs };
}
