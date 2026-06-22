import {
  CaliforniaParksProvider,
  runWithConcurrency,
  type AvailabilityProvider,
  type AvailabilityWindowEntry,
  type ParkCatalogEntry,
  type OnUnexpectedHtml,
} from "@campbrain/core";
import {
  upsertEntry,
  evictExpired,
  refreshMaterializedView,
  type QueryDb,
  type TransactionalDb,
} from "@campbrain/db";
import dayjs from "dayjs";

const PROVIDER_ID = "california-parks";
const CONCURRENCY = 5;
const BATCH_DELAY_MS = 500;

/** Minimal provider surface the orchestration needs (lets tests inject a fake).
 *  Based on the AvailabilityProvider interface so the return type includes 'unsupported'. */
export type ScanProvider = Pick<AvailabilityProvider, "generateCacheWindows" | "proactiveScanWindow">;

export interface ScanDeps {
  db: TransactionalDb & QueryDb;
  parks: ParkCatalogEntry[];
  provider?: ScanProvider;
  daysAhead?: number;
  todayOverride?: string;
  concurrency?: number;
  batchDelayMs?: number;
  log?: (msg: string) => void;
  onUnexpectedHtml?: OnUnexpectedHtml;
  sleep?: (ms: number) => Promise<void>;
}

export interface ScanSummary {
  parks: number;
  windows: number;
  fetched: number;
  fetchErrors: number;
  cacheWrites: number;
  durationMs: number;
}

/** Scan every 8-day window for every park, upsert results, evict expired, refresh the MV. */
export async function runProactiveScan(deps: ScanDeps): Promise<ScanSummary> {
  const startMs = Date.now();
  const log = deps.log ?? (() => {});
  const provider: ScanProvider = deps.provider ?? new CaliforniaParksProvider();
  const concurrency = deps.concurrency ?? CONCURRENCY;
  const delayMs = deps.batchDelayMs ?? BATCH_DELAY_MS;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const today = deps.todayOverride ? dayjs(deps.todayOverride) : dayjs();
  const rangeStart = today.add(2, "day").format("YYYY-MM-DD");
  const rangeEnd = today.add(deps.daysAhead ?? 180, "day").format("YYYY-MM-DD");

  type Candidate = {
    park: ParkCatalogEntry;
    windowStart: string;
    windowEnd: string;
  };
  const candidates: Candidate[] = deps.parks.flatMap((park) =>
    provider
      .generateCacheWindows(rangeStart, rangeEnd)
      .map((w) => ({ park, windowStart: w.windowStart, windowEnd: w.windowEnd })),
  );
  log(`Proactive scan: ${deps.parks.length} parks, ${candidates.length} windows`);

  let fetched = 0,
    fetchErrors = 0,
    cacheWrites = 0;

  const tasks = candidates.map((c) => async () => {
    fetched++;
    const result: AvailabilityWindowEntry | "unsupported" | null =
      await provider.proactiveScanWindow(
        c.park.parkPageId,
        { windowStart: c.windowStart, windowEnd: c.windowEnd },
        c.park.parkName,
        c.park.campgrounds,
        deps.onUnexpectedHtml ? { onUnexpectedHtml: deps.onUnexpectedHtml } : undefined,
      );
    if (result === null || result === "unsupported") {
      fetchErrors++;
      return;
    }
    await upsertEntry(deps.db, result, PROVIDER_ID);
    cacheWrites++;
  });

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    await runWithConcurrency(batch, concurrency);
    if (i + batch.length < tasks.length) await sleep(delayMs);
  }

  const evicted = await evictExpired(deps.db);
  if (evicted > 0) log(`Evicted ${evicted} expired scan windows`);
  try {
    await refreshMaterializedView(deps.db);
    log("MV refreshed");
  } catch (e) {
    log(
      `MV refresh failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return {
    parks: deps.parks.length,
    windows: candidates.length,
    fetched,
    fetchErrors,
    cacheWrites,
    durationMs: Date.now() - startMs,
  };
}
