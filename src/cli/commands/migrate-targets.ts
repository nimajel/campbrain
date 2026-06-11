import dayjs from 'dayjs';
import { listAlerts } from '../../config/alerts.js';
import { upsertSavedSearch } from '../../saved-search/store.js';
import { initDb, endDb } from '../../cache/db.js';
import type { Alert } from '../../config/alerts.js';
import type { SavedSearch, SavedSearchDatePattern, SavedSearchFilters } from '../../saved-search/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LegacyBlob = Record<string, unknown>;

// A SavedSearch with the legacy passthrough field present (used by migration).
export type MigratedSavedSearch = SavedSearch & { legacy: LegacyBlob };

// ---------------------------------------------------------------------------
// Pure mapper — no DB I/O; accepts a today string for testability.
// ---------------------------------------------------------------------------

export function targetToSavedSearch(alert: Alert, today: string): MigratedSavedSearch | null {
  if (alert.provider === 'yosemite-lottery') {
    console.warn(
      `[migrate-targets] Skipping "${alert.id}" (${alert.name}): provider=yosemite-lottery has no scanner support.`
    );
    return null;
  }

  const datePattern = resolveDatePattern(alert, today);
  const filters = resolveFilters(alert);
  const legacy = buildLegacy(alert);

  const now = new Date().toISOString();

  return {
    id: alert.id,
    userId: null,
    provider: alert.provider,
    name: alert.name,
    scope: {
      region: null,
      parkPageIds: [alert.parkPageId],
    },
    datePattern,
    filters,
    alertEnabled: false,
    emailEnabled: alert.emailEnabled,
    createdAt: now,
    updatedAt: now,
    legacy,
  };
}

// ---------------------------------------------------------------------------
// Date pattern resolution
// ---------------------------------------------------------------------------

function resolveDatePattern(alert: Alert, today: string): SavedSearchDatePattern {
  // weekendsOnly=true overrides dateMode to any_weekend regardless of mode.
  if (alert.weekendsOnly) {
    return { kind: 'any_weekend', horizonDays: computeHorizonFromRange(alert, today) };
  }

  switch (alert.dateMode) {
    case 'date_range':
      return {
        kind: 'fixed_range',
        from: alert.rangeStart ?? today,
        to: alert.rangeEnd ?? today,
      };

    case 'weekend_range':
      return { kind: 'any_weekend', horizonDays: computeHorizonFromRange(alert, today) };

    case 'next_available_weekend':
      return { kind: 'any_weekend', horizonDays: computeHorizonFromWeeksCount(alert) };

    case 'exact_dates': {
      const from = alert.exactStartDate ?? today;
      const to = alert.exactEndDate ?? dayjs(from).add(alert.maxNights, 'day').format('YYYY-MM-DD');
      return { kind: 'fixed_range', from, to };
    }
  }
}

function computeHorizonFromRange(alert: Alert, today: string): number {
  if (!alert.rangeEnd) return 90;
  const days = dayjs(alert.rangeEnd).diff(dayjs(today), 'day');
  return Math.min(Math.max(days, 1), 180);
}

function computeHorizonFromWeeksCount(alert: Alert): number {
  if (!alert.nextWeeksCount) return 90;
  return Math.min(alert.nextWeeksCount * 7, 180);
}

// ---------------------------------------------------------------------------
// Filters resolution
// ---------------------------------------------------------------------------

function resolveFilters(alert: Alert): SavedSearchFilters {
  const rawMinNights = alert.minNights;
  let minNights: 1 | 2 | 3 = 1;

  if (rawMinNights > 3) {
    console.warn(
      `[migrate-targets] "${alert.id}": minNights=${rawMinNights} exceeds maximum (3); clamping to 3.`
    );
    minNights = 3;
  } else if (rawMinNights === 2) {
    minNights = 2;
  } else if (rawMinNights === 3) {
    minNights = 3;
  } else {
    minNights = 1;
  }

  const access: SavedSearchFilters['access'] = alert.campingType === 'hike-in' ? ['hike_in'] : [];

  return {
    access,
    kinds: [],
    hide: [],
    minNights,
  };
}

// ---------------------------------------------------------------------------
// Legacy blob: all fields dropped from the SavedSearch schema
// ---------------------------------------------------------------------------

function buildLegacy(alert: Alert): LegacyBlob {
  return {
    enabled: alert.enabled,
    parkName: alert.parkName,
    campgroundName: alert.campgroundName,
    acceptableSites: alert.acceptableSites,
    preferredSites: alert.preferredSites,
    campingType: alert.campingType,
    people: alert.people,
    dateMode: alert.dateMode,
    maxNights: alert.maxNights,
    weekendsOnly: alert.weekendsOnly,
    bookingRule: alert.bookingRule,
    calendarEnabled: alert.calendarEnabled,
    scanIntervalMinutes: alert.scanIntervalMinutes,
    ...(alert.rangeStart !== undefined ? { rangeStart: alert.rangeStart } : {}),
    ...(alert.rangeEnd !== undefined ? { rangeEnd: alert.rangeEnd } : {}),
    ...(alert.exactStartDate !== undefined ? { exactStartDate: alert.exactStartDate } : {}),
    ...(alert.exactEndDate !== undefined ? { exactEndDate: alert.exactEndDate } : {}),
    ...(alert.nextWeeksCount !== undefined ? { nextWeeksCount: alert.nextWeeksCount } : {}),
    ...(alert.createdAt !== undefined ? { createdAt: alert.createdAt } : {}),
    ...(alert.updatedAt !== undefined ? { updatedAt: alert.updatedAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// CLI command shell: load → map → upsert → report
// ---------------------------------------------------------------------------

export async function migrateTargetsCommand(): Promise<void> {
  await initDb();

  const alerts = listAlerts();

  if (alerts.length === 0) {
    console.log('[migrate-targets] No targets found in data/targets.json — nothing to migrate.');
    await endDb();
    return;
  }

  console.log(`[migrate-targets] Found ${alerts.length} target(s) in data/targets.json`);

  const today = dayjs().format('YYYY-MM-DD');
  let imported = 0;
  let skipped = 0;

  for (const alert of alerts) {
    const mapped = targetToSavedSearch(alert, today);

    if (!mapped) {
      skipped++;
      continue;
    }

    await upsertSavedSearch(mapped);
    imported++;

    if (alert.enabled) {
      console.log(
        `  [imported] "${alert.id}" — imported with alerts OFF (legacy target still active); enable on /saved after legacy retirement.`
      );
    } else {
      console.log(`  [imported] "${alert.id}"`);
    }
  }

  console.log(
    `[migrate-targets] Done. ${imported} imported, ${skipped} skipped (yosemite-lottery).`
  );

  await endDb();
}
