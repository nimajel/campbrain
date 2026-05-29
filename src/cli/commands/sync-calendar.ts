import path from 'path';
import { listAlerts, activeAlerts, calendarAlerts } from '../../config/alerts.js';
import { calculateBookingWindows } from '../../rules/booking-window.js';
import { generateEventDrafts, hasEventChanged } from '../../calendar/calendar-event.js';
import { readCalendarState, writeCalendarState, upsertEventRecord } from '../../calendar/calendar-state.js';
import { getAuthClient, hasCredentials } from '../../calendar/google-auth.js';
import { createCalendarEvent, updateCalendarEvent } from '../../calendar/google-calendar.js';
import type { CalendarEventDraft } from '../../calendar/calendar-event.js';

function stateDir(): string {
  return path.join(process.cwd(), '.campbrain', 'state');
}

export interface SyncCalendarOptions {
  dryRun?: boolean;
  targetId?: string;
}

export async function syncCalendarCommand(options: SyncCalendarOptions = {}): Promise<void> {
  const { dryRun = false } = options;

  console.log('\n📅 Calendar Sync\n');

  // Prefer calendarEnabled alerts; fall back to all active alerts if none configured
  const withCalendar = calendarAlerts();
  const allActive = activeAlerts();
  const effectivePool = withCalendar.length > 0 ? withCalendar : allActive;

  const targets = options.targetId
    ? listAlerts().filter((a) => a.id === options.targetId)
    : effectivePool;

  if (targets.length === 0) {
    console.log('  No targets found.');
    return;
  }

  // Generate all event drafts from booking windows
  const allDrafts: CalendarEventDraft[] = [];
  for (const target of targets) {
    const windows = calculateBookingWindows(target);
    for (const window of windows) {
      allDrafts.push(...generateEventDrafts(target, window));
    }
  }

  // Filter out past events
  const now = new Date();
  const futureDrafts = allDrafts.filter((draft) => new Date(draft.startTimeIso) > now);
  const pastCount = allDrafts.length - futureDrafts.length;

  console.log(`  Targets:      ${targets.length}`);
  console.log(`  Event drafts: ${futureDrafts.length}${pastCount > 0 ? ` (${pastCount} past, skipped)` : ''}`);

  // Load existing state
  const state = readCalendarState(stateDir());

  // Classify future drafts into create / update / skip
  const toCreate = futureDrafts.filter((d) => !state.events[d.key]);
  const toUpdate = futureDrafts.filter((d) => {
    const existing = state.events[d.key];
    return existing !== undefined && hasEventChanged(d, existing);
  });
  const toSkip = futureDrafts.length - toCreate.length - toUpdate.length;

  console.log(`  To create:    ${toCreate.length}`);
  console.log(`  To update:    ${toUpdate.length}`);
  console.log(`  Up to date:   ${toSkip}`);

  if (dryRun) {
    console.log('\n  [Dry run — no changes made to Google Calendar]\n');

    if (toCreate.length > 0) {
      console.log('  Would create:');
      for (const d of toCreate.slice(0, 10)) {
        console.log(`    • [${d.reminderType.padEnd(12)}] ${d.summary} @ ${d.startTimeIso.slice(0, 16)}`);
      }
      if (toCreate.length > 10) console.log(`    … and ${toCreate.length - 10} more`);
    }

    if (toUpdate.length > 0) {
      console.log('\n  Would update:');
      for (const d of toUpdate) {
        console.log(`    • [${d.reminderType.padEnd(12)}] ${d.summary} @ ${d.startTimeIso.slice(0, 16)}`);
      }
    }

    return;
  }

  if (toCreate.length === 0 && toUpdate.length === 0) {
    console.log('\n  ✅ All events are up to date. Nothing to sync.\n');
    return;
  }

  // Need Google credentials for live sync
  if (!hasCredentials()) {
    // getAuthClient() will print setup instructions
    await getAuthClient();
    return;
  }

  const auth = await getAuthClient();
  if (!auth) return;

  let currentState = state;
  let created = 0;
  let updated = 0;

  for (const draft of toCreate) {
    try {
      const googleEventId = await createCalendarEvent(auth, draft);
      currentState = upsertEventRecord(currentState, {
        key: draft.key,
        googleEventId,
        summary: draft.summary,
        startTimeIso: draft.startTimeIso,
        lastSyncedAt: new Date().toISOString(),
      });
      created++;
      console.log(`  ✅ Created: [${draft.reminderType}] ${draft.startTimeIso.slice(0, 16)}`);
    } catch (err) {
      console.error(`  ❌ Failed to create event ${draft.key}:`, err instanceof Error ? err.message : err);
    }
  }

  for (const draft of toUpdate) {
    const existing = currentState.events[draft.key];
    if (!existing) continue;
    try {
      await updateCalendarEvent(auth, draft, existing.googleEventId);
      currentState = upsertEventRecord(currentState, {
        ...existing,
        summary: draft.summary,
        startTimeIso: draft.startTimeIso,
        lastSyncedAt: new Date().toISOString(),
      });
      updated++;
      console.log(`  🔄 Updated: [${draft.reminderType}] ${draft.startTimeIso.slice(0, 16)}`);
    } catch (err) {
      console.error(`  ❌ Failed to update event ${draft.key}:`, err instanceof Error ? err.message : err);
    }
  }

  writeCalendarState(stateDir(), currentState);

  console.log(`\n  Done — ${created} created, ${updated} updated.\n`);
}
