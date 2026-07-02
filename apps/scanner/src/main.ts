import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { closeDb, startScanRun, finishScanRun } from "@campbrain/db";
import { createNodeDb } from "@campbrain/db/node";
import { RecreationGovProvider, type ParkCatalogEntry } from "@campbrain/core";
import { runProactiveScan } from "./run-proactive-scan";
import { runAlertScan } from "./run-alert-scan";
import { runDigestBuild } from "./run-digest-build";
import { runCalendarSync } from "./run-calendar-sync";

function loadCaParks(): ParkCatalogEntry[] {
  // apps/scanner/src/main.ts → repo root is ../../../
  const path = fileURLToPath(
    new URL("../../../data/catalog/california-parks.json", import.meta.url),
  );
  const catalog = JSON.parse(readFileSync(path, "utf-8")) as {
    parks: ParkCatalogEntry[];
  };
  return catalog.parks.filter(
    (p) =>
      p.discoveryStatus !== "failed" && p.campgrounds.some((c) => c.sites.length > 0),
  );
}

function loadRecGovParks(): ParkCatalogEntry[] {
  // apps/scanner/src/main.ts → repo root is ../../../
  const path = fileURLToPath(
    new URL("../../../data/catalog/recreation-gov.json", import.meta.url),
  );
  const catalog = JSON.parse(readFileSync(path, "utf-8")) as {
    parks: ParkCatalogEntry[];
  };
  return catalog.parks.filter((p) => p.discoveryStatus !== "failed");
}

async function main() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");
  const debugDir =
    process.env["SCAN_DEBUG_DIR"] ?? join(process.cwd(), ".scan-debug");

  const db = createNodeDb(url);
  let summary;
  try {
    const proactiveRunId = await startScanRun(db, "proactive");
    try {
      summary = await runProactiveScan({
        db,
        providerId: "california-parks",
        parks: loadCaParks(),
        refreshMv: false,
        log: (m) => console.log(m),
        onUnexpectedHtml: async (html, ctx) => {
          mkdirSync(debugDir, { recursive: true });
          const safe = `${ctx.parkPageId}-${ctx.arrivalDate}`.replace(
            /[^a-z0-9-]/gi,
            "_",
          );
          writeFileSync(join(debugDir, `${safe}.html`), html);
          console.warn(
            `⚠ unexpected page: park ${ctx.parkPageId} ${ctx.arrivalDate} → ${ctx.url}`,
          );
        },
      });
      await finishScanRun(db, proactiveRunId, {
        status: "ok",
        parksScanned: summary.parks,
        errors: summary.fetchErrors,
      });
    } catch (err: unknown) {
      await finishScanRun(db, proactiveRunId, { status: "error", errors: 1 });
      throw err;
    }

    console.log(`✅ proactive scan complete: ${JSON.stringify(summary)}`);
    if (summary.windows > 0 && summary.cacheWrites === 0) {
      console.error(
        `scan produced 0 cache writes across ${summary.windows} windows — likely an upstream outage`,
      );
    }

    // Recreation.gov pass is a separate scan_runs bracket and must NOT fail the CA scan or the job.
    try {
      const recGovRunId = await startScanRun(db, "proactive");
      try {
        const recGovSummary = await runProactiveScan({
          db,
          providerId: "recreation-gov",
          provider: new RecreationGovProvider(),
          parks: loadRecGovParks(),
          refreshMv: true,
          log: (m) => console.log(m),
          onUnexpectedHtml: async (html, ctx) => {
            mkdirSync(debugDir, { recursive: true });
            const safe = `${ctx.parkPageId}-${ctx.arrivalDate}`.replace(
              /[^a-z0-9-]/gi,
              "_",
            );
            writeFileSync(join(debugDir, `${safe}.html`), html);
            console.warn(
              `⚠ unexpected page: park ${ctx.parkPageId} ${ctx.arrivalDate} → ${ctx.url}`,
            );
          },
        });
        await finishScanRun(db, recGovRunId, {
          status: "ok",
          parksScanned: recGovSummary.parks,
          errors: recGovSummary.fetchErrors,
        });
        console.log(`✅ recreation.gov scan complete: ${JSON.stringify(recGovSummary)}`);
      } catch (err: unknown) {
        await finishScanRun(db, recGovRunId, { status: "error", errors: 1 });
        throw err;
      }
    } catch (e: unknown) {
      console.error(`recreation.gov scan threw unexpectedly: ${String(e)}`);
    }

    // Digest build is best-effort: a failure must NOT kill the scan job.
    try {
      await runDigestBuild({ db, log: (m) => console.log(m) });
      console.log("✅ digest build complete");
    } catch (e: unknown) {
      console.error(`digest build threw unexpectedly: ${String(e)}`);
    }
    try {
      await runDigestBuild({ db, provider: "recreation-gov", log: (m) => console.log(m) });
      console.log("✅ recreation.gov digest build complete");
    } catch (e: unknown) {
      console.error(`recreation.gov digest build threw unexpectedly: ${String(e)}`);
    }

    const dashboardUrl =
      (process.env["WEB_ORIGIN"] ?? "https://campbrain-api.jelvehn.workers.dev") +
      "/dashboard";
    await runAlertScan({ db, dashboardUrl });
    console.log("✅ alert scan complete");

    // Calendar sync is best-effort: a failure must NOT kill the scan job.
    try {
      const clientId = process.env["GOOGLE_CLIENT_ID"] ?? "";
      const clientSecret = process.env["GOOGLE_CLIENT_SECRET"] ?? "";
      await runCalendarSync({ db, clientId, clientSecret, log: (m) => console.log(m) });
      console.log("✅ calendar sync complete");
    } catch (e: unknown) {
      console.error(`calendar sync threw unexpectedly: ${String(e)}`);
    }
  } finally {
    await closeDb(db);
  }

  if (summary && summary.windows > 0 && summary.cacheWrites === 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
