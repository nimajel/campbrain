import {
  listCalendarSyncTargets,
  getSyncState,
  upsertSyncState,
  startScanRun,
  finishScanRun,
  type Db,
} from "@campbrain/db";
import { computeBookingWindows, generateEventDrafts, hasEventChanged } from "@campbrain/core";
import { makeGoogleCalendarClient, type CalendarClient, type ClientConfig } from "./google-calendar";

export interface CalendarSyncDeps {
  db: Db;
  clientId: string;
  clientSecret: string;
  // Default = makeGoogleCalendarClient; tests inject a mock here to avoid live Google calls.
  makeClient?: (cfg: ClientConfig) => CalendarClient;
  log?: (m: string) => void;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runCalendarSync(deps: CalendarSyncDeps): Promise<void> {
  const { db, clientId, clientSecret } = deps;
  const makeClient = deps.makeClient ?? makeGoogleCalendarClient;
  const log = deps.log ?? ((_m: string) => {});

  const runId = await startScanRun(db, "calendar");
  const today = todayUtc();
  const nowMs = Date.now();

  // Column reuse: searchesScanned=usersProcessed, hitsNew=eventsCreated, hitsCurrent=eventsUpdated
  let usersProcessed = 0;
  let eventsCreated = 0;
  let eventsUpdated = 0;
  let errors = 0;

  try {
    const rows = await listCalendarSyncTargets(db);

    // Group rows by userId so we build one CalendarClient per user.
    const byUser = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byUser.get(r.userId) ?? [];
      arr.push(r);
      byUser.set(r.userId, arr);
    }

    for (const [userId, userRows] of byUser) {
      usersProcessed++;
      const conn = userRows[0]!;

      let client: CalendarClient;
      try {
        client = makeClient({
          clientId,
          clientSecret,
          refreshToken: conn.refreshToken,
          accessToken: conn.accessToken,
          expiryMs: conn.accessTokenExpiresAt ? Date.parse(conn.accessTokenExpiresAt) : null,
        });
      } catch (e: unknown) {
        errors++;
        log(`calendar sync: client for user ${userId} failed: ${String(e)}`);
        continue;
      }

      for (const row of userRows) {
        try {
          const t = row.target;
          const windows = computeBookingWindows(t.datePattern, t.bookingRule, today);

          const drafts = windows
            .flatMap((w) =>
              generateEventDrafts({
                targetId: t.id,
                targetName: t.name,
                parkName: t.scope.parkName,
                campgroundName: t.scope.campgroundName,
                timeZone: t.bookingRule.timezone,
                window: w,
              }),
            )
            // Drop reminders whose start time is already in the past.
            .filter((d) => Date.parse(d.startTimeIso) > nowMs);

          if (drafts.length === 0) continue;

          const existing = await getSyncState(
            db,
            userId,
            drafts.map((d) => d.key),
          );

          for (const draft of drafts) {
            const prev = existing.get(draft.key);
            if (!prev) {
              const eventId = await client.insertEvent(draft);
              await upsertSyncState(db, userId, t.id, {
                key: draft.key,
                googleEventId: eventId,
                summary: draft.summary,
                startTimeIso: draft.startTimeIso,
              });
              eventsCreated++;
            } else if (hasEventChanged(draft, prev)) {
              await client.updateEvent(prev.googleEventId, draft);
              await upsertSyncState(db, userId, t.id, {
                key: draft.key,
                googleEventId: prev.googleEventId,
                summary: draft.summary,
                startTimeIso: draft.startTimeIso,
              });
              eventsUpdated++;
            }
            // else: draft unchanged — skip (idempotent)
          }
        } catch (e: unknown) {
          errors++;
          log(`calendar sync: target ${row.target.id} failed: ${String(e)}`);
        }
      }
    }

    await finishScanRun(db, runId, {
      status: "ok",
      // Reusing alert-scan columns: usersProcessed→searchesScanned, created→hitsNew, updated→hitsCurrent
      searchesScanned: usersProcessed,
      hitsNew: eventsCreated,
      hitsCurrent: eventsUpdated,
      errors,
    });
    log(
      `calendar sync: users=${usersProcessed} created=${eventsCreated} updated=${eventsUpdated} errors=${errors}`,
    );
  } catch (e: unknown) {
    log(`calendar sync failed: ${String(e)}`);
    await finishScanRun(db, runId, {
      status: "error",
      searchesScanned: usersProcessed,
      hitsNew: eventsCreated,
      hitsCurrent: eventsUpdated,
      errors: errors + 1,
    });
  }
}
