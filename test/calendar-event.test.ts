import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  reminderKey,
  generateEventDrafts,
  hasEventChanged,
} from '../src/calendar/calendar-event.js';
import {
  readCalendarState,
  writeCalendarState,
  upsertEventRecord,
} from '../src/calendar/calendar-state.js';
import { hasCredentials } from '../src/calendar/google-auth.js';
import type { Target } from '../src/config/schemas.js';
import type { BookingWindowInfo } from '../src/rules/booking-window.js';
import type { CalendarEventRecord } from '../src/calendar/calendar-event.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockTarget: Target = {
  id: 'angel-island',
  name: 'Angel Island Ridge weekends',
  provider: 'california-parks',
  parkName: 'Angel Island State Park',
  parkPageId: '468',
  campgroundName: 'Ridge (sites 4-6)',
  acceptableSites: ['Hike in Campsite #4', 'Hike in Campsite #5', 'Hike in Campsite #6'],
  preferredSites: ['Hike in Campsite #5', 'Hike in Campsite #4', 'Hike in Campsite #6'],
  campingType: 'hike-in',
  people: 2,
  dateMode: 'next_available_weekend',
  nextWeeksCount: 4,
  minNights: 1,
  maxNights: 2,
  weekendsOnly: true,
  bookingRule: {
    type: 'rolling_months_before',
    monthsBefore: 6,
    releaseTime: '08:00',
    timezone: 'America/Los_Angeles',
  },
};

const mockWindow: BookingWindowInfo = {
  arrivalDate: '2026-08-14',
  bookingOpenTime: '2026-02-14 08:00:00 -08:00',
  reminderSevenDaysBefore: '2026-02-07 09:00:00 -08:00',
  reminderNightBefore: '2026-02-13 20:00:00 -08:00',
  reminderTenMinutesBefore: '2026-02-14 07:50:00 -08:00',
};

// ---------------------------------------------------------------------------
// 1. reminderKey — dedupe key generation
// ---------------------------------------------------------------------------

describe('reminderKey', () => {
  it('produces targetId|arrivalDate|reminderType format', () => {
    expect(reminderKey('angel-island', '2026-08-14', 'prep')).toBe(
      'angel-island|2026-08-14|prep'
    );
  });

  it('differs for different reminder types', () => {
    const prep = reminderKey('t', '2026-08-14', 'prep');
    const booking = reminderKey('t', '2026-08-14', 'booking');
    const nightBefore = reminderKey('t', '2026-08-14', 'night-before');
    expect(new Set([prep, booking, nightBefore]).size).toBe(3);
  });

  it('differs for different arrival dates', () => {
    const a = reminderKey('t', '2026-08-14', 'prep');
    const b = reminderKey('t', '2026-08-21', 'prep');
    expect(a).not.toBe(b);
  });

  it('differs for different target IDs', () => {
    const a = reminderKey('target-a', '2026-08-14', 'prep');
    const b = reminderKey('target-b', '2026-08-14', 'prep');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 2. generateEventDrafts — reminder event generation
// ---------------------------------------------------------------------------

describe('generateEventDrafts', () => {
  it('generates exactly 3 events per booking window', () => {
    const drafts = generateEventDrafts(mockTarget, mockWindow);
    expect(drafts).toHaveLength(3);
  });

  it('produces prep, night-before, and booking reminder types', () => {
    const drafts = generateEventDrafts(mockTarget, mockWindow);
    const types = drafts.map((d) => d.reminderType);
    expect(types).toContain('prep');
    expect(types).toContain('night-before');
    expect(types).toContain('booking');
  });

  it('each event has the correct targetId', () => {
    const drafts = generateEventDrafts(mockTarget, mockWindow);
    for (const d of drafts) {
      expect(d.targetId).toBe('angel-island');
    }
  });

  it('event title includes park and campground names', () => {
    const drafts = generateEventDrafts(mockTarget, mockWindow);
    for (const d of drafts) {
      expect(d.summary).toContain('Angel Island State Park');
      expect(d.summary).toContain('Ridge (sites 4-6)');
    }
  });

  it('description includes target name, park, and campground', () => {
    const drafts = generateEventDrafts(mockTarget, mockWindow);
    for (const d of drafts) {
      expect(d.description).toContain('Angel Island Ridge weekends');
      expect(d.description).toContain('Angel Island State Park');
      expect(d.description).toContain('Ridge (sites 4-6)');
    }
  });

  it('description includes the manual booking checklist', () => {
    const [draft] = generateEventDrafts(mockTarget, mockWindow);
    expect(draft?.description).toContain('Log into reservation site');
    expect(draft?.description).toContain('official site');
  });

  it('booking reminder title has BOOK NOW marker', () => {
    const drafts = generateEventDrafts(mockTarget, mockWindow);
    const booking = drafts.find((d) => d.reminderType === 'booking');
    expect(booking?.summary).toContain('BOOK NOW');
  });

  it('keys are unique per draft', () => {
    const drafts = generateEventDrafts(mockTarget, mockWindow);
    const keys = drafts.map((d) => d.key);
    expect(new Set(keys).size).toBe(3);
  });

  it('endTime is 30 minutes after startTime', () => {
    const drafts = generateEventDrafts(mockTarget, mockWindow);
    for (const d of drafts) {
      const start = new Date(d.startTimeIso).getTime();
      const end = new Date(d.endTimeIso).getTime();
      expect(end - start).toBe(30 * 60 * 1000);
    }
  });

  it('prep event start time is parsed correctly from window reminder time', () => {
    const drafts = generateEventDrafts(mockTarget, mockWindow);
    const prep = drafts.find((d) => d.reminderType === 'prep');
    // reminderSevenDaysBefore = '2026-02-07 09:00:00 -08:00'
    // That's 17:00:00 UTC
    expect(prep?.startTimeIso).toContain('2026-02-07');
    expect(prep?.startTimeIso).toContain('17:00:00');
  });
});

// ---------------------------------------------------------------------------
// 3. hasEventChanged — update vs create decision logic
// ---------------------------------------------------------------------------

describe('hasEventChanged', () => {
  const [draft] = generateEventDrafts(mockTarget, mockWindow);

  function makeRecord(overrides?: Partial<CalendarEventRecord>): CalendarEventRecord {
    return {
      key: draft!.key,
      googleEventId: 'google-event-123',
      summary: draft!.summary,
      startTimeIso: draft!.startTimeIso,
      lastSyncedAt: '2026-05-28T12:00:00.000Z',
      ...overrides,
    };
  }

  it('returns false when summary and startTime match', () => {
    expect(hasEventChanged(draft!, makeRecord())).toBe(false);
  });

  it('returns true when summary changes', () => {
    expect(hasEventChanged(draft!, makeRecord({ summary: 'Old title' }))).toBe(true);
  });

  it('returns true when startTime changes', () => {
    expect(hasEventChanged(draft!, makeRecord({ startTimeIso: '2025-01-01T00:00:00.000Z' }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Missing credentials behavior
// ---------------------------------------------------------------------------

describe('hasCredentials', () => {
  const origClientId = process.env['GOOGLE_CLIENT_ID'];
  const origClientSecret = process.env['GOOGLE_CLIENT_SECRET'];

  beforeEach(() => {
    delete process.env['GOOGLE_CLIENT_ID'];
    delete process.env['GOOGLE_CLIENT_SECRET'];
  });

  afterEach(() => {
    if (origClientId !== undefined) process.env['GOOGLE_CLIENT_ID'] = origClientId;
    if (origClientSecret !== undefined) process.env['GOOGLE_CLIENT_SECRET'] = origClientSecret;
  });

  it('returns false when env vars are absent', () => {
    expect(hasCredentials()).toBe(false);
  });

  it('returns false when only client ID is set', () => {
    process.env['GOOGLE_CLIENT_ID'] = 'some-id';
    expect(hasCredentials()).toBe(false);
  });

  it('returns true when both client ID and secret are set', () => {
    process.env['GOOGLE_CLIENT_ID'] = 'some-id';
    process.env['GOOGLE_CLIENT_SECRET'] = 'some-secret';
    expect(hasCredentials()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Calendar state read/write + upsert
// ---------------------------------------------------------------------------

describe('calendarState', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'campbrain-cal-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty state when no file exists', () => {
    expect(readCalendarState(dir)).toEqual({ events: {} });
  });

  it('round-trips state through write/read', () => {
    const state = {
      events: {
        'angel-island|2026-08-14|prep': {
          key: 'angel-island|2026-08-14|prep',
          googleEventId: 'ev-123',
          summary: 'CampBrain: Book Angel Island',
          startTimeIso: '2026-02-07T17:00:00.000Z',
          lastSyncedAt: '2026-05-28T12:00:00.000Z',
        },
      },
    };
    writeCalendarState(dir, state);
    expect(readCalendarState(dir)).toEqual(state);
  });

  it('upsertEventRecord adds a new record', () => {
    const state = { events: {} };
    const record: CalendarEventRecord = {
      key: 'target|date|prep',
      googleEventId: 'ev-999',
      summary: 'Test',
      startTimeIso: '2026-01-01T00:00:00.000Z',
      lastSyncedAt: '2026-05-28T12:00:00.000Z',
    };
    const next = upsertEventRecord(state, record);
    expect(next.events['target|date|prep']).toEqual(record);
  });

  it('upsertEventRecord overwrites an existing record', () => {
    const existing: CalendarEventRecord = {
      key: 'target|date|prep',
      googleEventId: 'ev-old',
      summary: 'Old',
      startTimeIso: '2025-01-01T00:00:00.000Z',
      lastSyncedAt: '2025-01-01T00:00:00.000Z',
    };
    const state = { events: { 'target|date|prep': existing } };
    const updated = { ...existing, summary: 'New', googleEventId: 'ev-new' };
    const next = upsertEventRecord(state, updated);
    expect(next.events['target|date|prep']?.summary).toBe('New');
    expect(next.events['target|date|prep']?.googleEventId).toBe('ev-new');
  });
});
