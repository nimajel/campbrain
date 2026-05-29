import fs from 'fs';
import path from 'path';
import type { CalendarSyncState, CalendarEventRecord } from './calendar-event.js';

function calendarStatePath(stateDir: string): string {
  return path.join(stateDir, 'calendar-events.json');
}

function ensureStateDir(stateDir: string): void {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
}

export function readCalendarState(stateDir: string): CalendarSyncState {
  const p = calendarStatePath(stateDir);
  if (!fs.existsSync(p)) return { events: {} };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as CalendarSyncState;
  } catch {
    return { events: {} };
  }
}

export function writeCalendarState(stateDir: string, state: CalendarSyncState): void {
  ensureStateDir(stateDir);
  fs.writeFileSync(
    calendarStatePath(stateDir),
    JSON.stringify(state, null, 2) + '\n',
    'utf-8'
  );
}

export function upsertEventRecord(
  state: CalendarSyncState,
  record: CalendarEventRecord
): CalendarSyncState {
  return {
    events: {
      ...state.events,
      [record.key]: record,
    },
  };
}
