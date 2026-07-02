import { sql } from "drizzle-orm";
import { rows, type QueryDb } from "./exec";
import type { ScanRunKind } from "@campbrain/types";

export async function startScanRun(db: QueryDb, kind: ScanRunKind): Promise<string> {
  const id = crypto.randomUUID();
  await rows(db, sql`INSERT INTO scan_runs (id, kind, started_at, status) VALUES (${id}, ${kind}, now(), 'running')`);
  return id;
}

export interface ScanRunPatch {
  status: "ok" | "error";
  searchesScanned?: number;
  hitsNew?: number;
  hitsCurrent?: number;
  emailsSent?: number;
  parksScanned?: number;
  errors?: number;
}

export async function finishScanRun(db: QueryDb, id: string, patch: ScanRunPatch): Promise<void> {
  await rows(db, sql`UPDATE scan_runs SET finished_at = now(), status = ${patch.status},
    searches_scanned = ${patch.searchesScanned ?? null}, hits_new = ${patch.hitsNew ?? null},
    hits_current = ${patch.hitsCurrent ?? null}, emails_sent = ${patch.emailsSent ?? null},
    parks_scanned = ${patch.parksScanned ?? null}, errors = ${patch.errors ?? null}
    WHERE id = ${id}`);
}

export async function latestAlertRun(db: QueryDb): Promise<{ finishedAt: string } | null> {
  const r = await rows<{ finishedAt: string }>(db, sql`SELECT finished_at::text AS "finishedAt"
    FROM scan_runs WHERE kind = 'alert' AND status = 'ok' AND finished_at IS NOT NULL
    ORDER BY finished_at DESC LIMIT 1`);
  return r[0] ?? null;
}

/** Flips scan_runs rows stuck at status='running' (e.g. a SIGKILLed job) to 'error' so they
 *  don't linger forever. Returns the number of rows updated. */
export async function failStaleScanRuns(db: QueryDb, olderThanHours = 12): Promise<number> {
  const r = await rows<{ id: string }>(db, sql`UPDATE scan_runs SET status = 'error', finished_at = now()
    WHERE status = 'running' AND started_at < now() - (${olderThanHours} || ' hours')::interval
    RETURNING id`);
  return r.length;
}
