import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDb, closeDb } from "@campbrain/db";
import type { ParkCatalogEntry } from "@campbrain/core";
import { runProactiveScan } from "./run-proactive-scan";

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

async function main() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");
  const debugDir =
    process.env["SCAN_DEBUG_DIR"] ?? join(process.cwd(), ".scan-debug");

  const db = createDb(url);
  let summary;
  try {
    summary = await runProactiveScan({
      db,
      parks: loadCaParks(),
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
  } finally {
    await closeDb(db);
  }
  console.log(`✅ scan complete: ${JSON.stringify(summary)}`);
  if (summary.windows > 0 && summary.cacheWrites === 0) {
    console.error(
      `scan produced 0 cache writes across ${summary.windows} windows — likely an upstream outage`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
