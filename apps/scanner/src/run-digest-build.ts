import {
  getCatalogParks,
  getEntriesForParks,
  upsertParkDigest,
  startScanRun,
  finishScanRun,
  type Db,
} from "@campbrain/db";
import { buildParkAvailability, buildSiteClassMap, type AvailabilityWindowEntry } from "@campbrain/core";

export interface DigestBuildDeps {
  db: Db;
  provider?: string;
  getEntries?: (db: Db, ids: string[], provider?: string) => Promise<AvailabilityWindowEntry[]>;
  log?: (m: string) => void;
}

export async function runDigestBuild(deps: DigestBuildDeps): Promise<void> {
  const { db } = deps;
  const provider = deps.provider ?? "california-parks";
  const getEntries = deps.getEntries ?? getEntriesForParks;
  const log = deps.log ?? ((_m: string) => {});

  const runId = await startScanRun(db, "digest");
  let parksScanned = 0;
  let errors = 0;

  try {
    const catalogParks = await getCatalogParks(db);
    const seen = new Set<string>();
    const parks = catalogParks.filter((p) => {
      if (p.providerId !== provider) return false;
      const key = `${p.providerId}:${p.parkPageId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    for (const park of parks) {
      try {
        const entries = await getEntries(db, [park.parkPageId], provider);
        const digest = buildParkAvailability(entries, {}, park.parkPageId);
        const siteClass = buildSiteClassMap(entries, park.parkPageId);
        await upsertParkDigest(db, {
          provider,
          parkPageId: park.parkPageId,
          asOf: digest.asOf,
          digest,
          siteClass,
        });
        parksScanned++;
      } catch (e: unknown) {
        errors++;
        log(`digest build: park ${park.parkPageId} failed: ${String(e)}`);
      }
    }

    await finishScanRun(db, runId, { status: "ok", parksScanned, errors });
    log(`digest build: parks=${parksScanned} errors=${errors}`);
  } catch (e: unknown) {
    log(`digest build failed: ${String(e)}`);
    await finishScanRun(db, runId, { status: "error", parksScanned, errors: errors + 1 });
  }
}
