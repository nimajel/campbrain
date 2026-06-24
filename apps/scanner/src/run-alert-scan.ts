import {
  listAlertEnabledSavedSearches,
  buildParkRegionOf,
  matchSavedSearchAgainstDb,
  reconcileHits,
  listHitsToNotify,
  markNotified,
  countCurrentHits,
  startScanRun,
  finishScanRun,
  type Db,
  type NotifyRow,
} from "@campbrain/db";
import { sendAlertEmail, type AlertEmailRow } from "./notifications/email";

export interface AlertScanDeps {
  db: Db;
  dashboardUrl: string;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function safeFinish(
  db: Db,
  runId: string,
  patch: Parameters<typeof finishScanRun>[2],
): Promise<void> {
  try {
    await finishScanRun(db, runId, patch);
  } catch (e: unknown) {
    console.error(`alert scan: failed to record scan run ${runId}: ${String(e)}`);
  }
}

export async function runAlertScan(deps: AlertScanDeps): Promise<void> {
  const { db, dashboardUrl } = deps;
  const runStart = new Date().toISOString();
  const today = todayUtc();
  // runId is null until startScanRun succeeds. Keeping startScanRun INSIDE the try (and
  // guarding the catch on runId) makes runAlertScan unconditionally non-throwing — even if
  // the hits/scan_runs tables don't exist yet (e.g. pushed before the Neon migration), the
  // alert phase just logs and the 6h scan job's exit code stays owned by the proactive phase.
  let runId: string | null = null;
  let searchesScanned = 0;
  let hitsNew = 0;
  let emailsSent = 0;
  let errors = 0;

  try {
    runId = await startScanRun(db, "alert");
    const searches = await listAlertEnabledSavedSearches(db);
    const regionOf = await buildParkRegionOf(db);

    for (const search of searches) {
      searchesScanned++;
      try {
        const openings = await matchSavedSearchAgainstDb(db, search, today, regionOf);
        const { newCount } = await reconcileHits(db, search, openings, runStart);
        hitsNew += newCount;
      } catch (err: unknown) {
        errors++;
        console.error(`alert scan: search ${search.id} failed: ${String(err)}`);
      }
    }

    const toNotify = await listHitsToNotify(db, today);
    const byUser = new Map<string, NotifyRow[]>();
    for (const r of toNotify) {
      const arr = byUser.get(r.userId) ?? [];
      arr.push(r);
      byUser.set(r.userId, arr);
    }

    const apiKey = process.env["RESEND_API_KEY"];
    const from = process.env["ALERT_EMAIL_FROM"];

    for (const [, group] of byUser) {
      const emailRows: AlertEmailRow[] = group.map((g) => ({
        searchName: g.searchName,
        parkName: g.parkName,
        campgroundName: g.campgroundName,
        siteName: g.siteName,
        arrivalDate: g.arrivalDate,
        departureDate: g.departureDate,
        nights: g.nights,
        bookingUrl: g.bookingUrl,
      }));
      const res = await sendAlertEmail(
        { apiKey, from, to: group[0]!.email },
        emailRows,
        dashboardUrl,
      );
      if (res === "delivered") {
        await markNotified(
          db,
          group.map((g) => g.id),
          new Date().toISOString(),
        );
        emailsSent++;
      }
      // 'skipped-unconfigured' / 'failed' → leave notified_at NULL so a future run retries
    }

    const hitsCurrent = await countCurrentHits(db, today);
    await safeFinish(db, runId, { status: "ok", searchesScanned, hitsNew, hitsCurrent, emailsSent, errors });
  } catch (err: unknown) {
    console.error(`alert scan failed: ${String(err)}`);
    // If startScanRun itself failed, runId is null and there is nothing to finish — the
    // error is already logged above; never let this propagate and crash the scan job.
    if (runId) {
      await safeFinish(db, runId, {
        status: "error",
        searchesScanned,
        hitsNew,
        emailsSent,
        errors: errors + 1,
      });
    }
  }
}
