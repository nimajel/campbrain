import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// Stub modules before importing the subject under test
// ---------------------------------------------------------------------------

// Stub the saved-search store
vi.mock('../src/saved-search/store.js', () => ({
  listAlertEnabledSavedSearches: vi.fn(async () => []),
}));

// Stub the saved-search matcher
vi.mock('../src/saved-search/match.js', () => ({
  matchSavedSearch: vi.fn(async () => []),
  todayUtc: () => new Date().toISOString().slice(0, 10),
}));

// Stub the catalog store (for parkRegionOf)
vi.mock('../src/catalog/catalog-store.js', () => ({
  listCatalogParks: vi.fn(() => []),
}));

// Stub the availability cache functions
vi.mock('../src/cache/availability-cache.js', () => ({
  getEntriesForPark: vi.fn(async () => []),
  searchAvailableStays: vi.fn(async () => []),
}));

// Captured console alerts for the buildAvailabilityAlerts branch tests
const capturedConsoleAlerts: unknown[][] = [];

// Stub notification services so we don't need email config
vi.mock('../src/notifications/console-notification-service.js', () => ({
  ConsoleNotificationService: class {
    async notify(items: unknown[]) {
      capturedConsoleAlerts.push(items);
      return 'delivered';
    }
  },
}));
vi.mock('../src/notifications/email-notification-service.js', () => ({
  EmailNotificationService: class {
    async notify() { return 'skipped-unconfigured'; }
  },
}));

// ---------------------------------------------------------------------------
// Now import the subject and collaborators after mocks are set up
// ---------------------------------------------------------------------------

import { runScan } from '../src/scanner/run-scan.js';
import { listAlertEnabledSavedSearches } from '../src/saved-search/store.js';
import { matchSavedSearch } from '../src/saved-search/match.js';
import { readHitsState } from '../src/state/scan-state.js';
import type { SavedSearch } from '../src/saved-search/types.js';
import type { SavedSearchOpening } from '../src/saved-search/match.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSavedSearch(overrides: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: 'ss-test-1',
    userId: null,
    provider: 'california-parks',
    name: 'Bay Area Weekend',
    scope: { region: 'bay-area', parkPageIds: [] },
    datePattern: { kind: 'any_weekend', horizonDays: 30 },
    filters: { access: [], kinds: [], hide: [], minNights: 1 },
    alertEnabled: true,
    emailEnabled: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeOpening(overrides: Partial<SavedSearchOpening> = {}): SavedSearchOpening {
  return {
    savedSearchId: 'ss-test-1',
    parkPageId: 'park-42',
    parkName: 'Salt Point',
    campgroundName: 'Woodside',
    siteName: 'Site 5',
    arrivalDate: '2026-07-04',
    departureDate: '2026-07-05',
    nights: 1,
    bookingUrl: 'https://example.com/book',
    availabilityAsOf: '2026-06-10T08:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runScan — saved-search source', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runscan-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('no-ops cleanly when there are zero alert-enabled saved searches', async () => {
    vi.mocked(listAlertEnabledSavedSearches).mockResolvedValue([]);
    const summary = await runScan({ notify: false, stateDir });
    expect(summary.totalNewHits).toBe(0);
    expect(matchSavedSearch).not.toHaveBeenCalled();
  });

  it('calls matchSavedSearch for each alert-enabled saved search', async () => {
    const search = makeSavedSearch();
    vi.mocked(listAlertEnabledSavedSearches).mockResolvedValue([search]);
    vi.mocked(matchSavedSearch).mockResolvedValue([]);

    await runScan({ notify: false, stateDir });

    expect(matchSavedSearch).toHaveBeenCalledOnce();
    const [calledSearch] = vi.mocked(matchSavedSearch).mock.calls[0]!;
    expect(calledSearch.id).toBe('ss-test-1');
  });

  it('hit records from openings flow into reconcile and are written to state', async () => {
    const search = makeSavedSearch();
    const opening = makeOpening();
    vi.mocked(listAlertEnabledSavedSearches).mockResolvedValue([search]);
    vi.mocked(matchSavedSearch).mockResolvedValue([opening]);

    const summary = await runScan({ notify: false, stateDir });

    expect(summary.totalNewHits).toBe(1);
    const state = readHitsState(stateDir);
    expect(state.hits).toHaveLength(1);
    const hit = state.hits[0]!;
    expect(hit.savedSearchId).toBe('ss-test-1');
    expect(hit.parkPageId).toBe('park-42');
    expect(hit.parkName).toBe('Salt Point');
    expect(hit.campgroundName).toBe('Woodside');
    expect(hit.siteName).toBe('Site 5');
    expect(hit.bookingUrl).toBe('https://example.com/book');
  });

  it('targetName on the hit record is set to the saved search name', async () => {
    const search = makeSavedSearch({ name: 'My Coastal Search' });
    const opening = makeOpening({ savedSearchId: 'ss-test-1' });
    vi.mocked(listAlertEnabledSavedSearches).mockResolvedValue([search]);
    vi.mocked(matchSavedSearch).mockResolvedValue([opening]);

    await runScan({ notify: false, stateDir });

    const state = readHitsState(stateDir);
    expect(state.hits[0]?.targetName).toBe('My Coastal Search');
  });

  it('same opening on a second run does not re-notify', async () => {
    const search = makeSavedSearch();
    const opening = makeOpening();
    vi.mocked(listAlertEnabledSavedSearches).mockResolvedValue([search]);
    vi.mocked(matchSavedSearch).mockResolvedValue([opening]);

    // First run: creates + notifies
    const first = await runScan({ notify: false, stateDir });
    expect(first.totalNewHits).toBe(1);

    // Stamp notifiedAt to simulate delivery
    const state = readHitsState(stateDir);
    const { writeHitsState } = await import('../src/state/scan-state.js');
    writeHitsState(stateDir, {
      version: 3,
      hits: state.hits.map((h) => ({ ...h, notifiedAt: '2026-06-10T08:05:00.000Z' })),
    });

    // Second run: same opening — should NOT re-notify
    const second = await runScan({ notify: false, stateDir });
    expect(second.totalNewHits).toBe(0);
  });

  it('per-search checkedKeys are computed from existing hits for that search', async () => {
    const search = makeSavedSearch();
    const opening = makeOpening();
    vi.mocked(listAlertEnabledSavedSearches).mockResolvedValue([search]);
    vi.mocked(matchSavedSearch).mockResolvedValue([opening]);

    // First run — opening appears
    await runScan({ notify: false, stateDir });

    // Stamp notifiedAt
    const state1 = readHitsState(stateDir);
    const { writeHitsState } = await import('../src/state/scan-state.js');
    writeHitsState(stateDir, {
      version: 3,
      hits: state1.hits.map((h) => ({ ...h, notifiedAt: '2026-06-10T08:05:00.000Z' })),
    });

    // Second run — opening disappears
    vi.mocked(matchSavedSearch).mockResolvedValue([]);
    await runScan({ notify: false, stateDir });

    // The hit should have disappearedAt set (means checkedKeys included the stored key)
    const state2 = readHitsState(stateDir);
    expect(state2.hits[0]!.disappearedAt).toBeTruthy();
  });

  it('store unavailability is caught and scan continues without crashing', async () => {
    vi.mocked(listAlertEnabledSavedSearches).mockRejectedValue(new Error('DB down'));
    const summary = await runScan({ notify: false, stateDir });
    expect(summary.totalNewHits).toBe(0);
    expect(matchSavedSearch).not.toHaveBeenCalled();
  });

  it('match failure for a single search is skipped without crashing the run', async () => {
    const search1 = makeSavedSearch({ id: 'ss-1', name: 'Search 1' });
    const search2 = makeSavedSearch({ id: 'ss-2', name: 'Search 2' });
    const opening2 = makeOpening({ savedSearchId: 'ss-2' });
    vi.mocked(listAlertEnabledSavedSearches).mockResolvedValue([search1, search2]);
    vi.mocked(matchSavedSearch)
      .mockRejectedValueOnce(new Error('Postgres gone'))
      .mockResolvedValueOnce([opening2]);

    const summary = await runScan({ notify: false, stateDir });
    // search1 failed, search2 succeeded with 1 opening
    expect(summary.totalNewHits).toBe(1);
  });

});

// ---------------------------------------------------------------------------
// buildAvailabilityAlerts — saved-search path
// ---------------------------------------------------------------------------

describe('buildAvailabilityAlerts — saved-search path (via runScan notify)', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runscan-notify-test-'));
    vi.clearAllMocks();
    capturedConsoleAlerts.length = 0;
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('produces an AvailabilityAlert with parkName/campgroundName from hit record for saved-search hit', async () => {
    const search = makeSavedSearch({ emailEnabled: false });
    const opening = makeOpening({
      parkName: 'Sonoma Coast SP',
      campgroundName: 'Bodega Dunes',
    });
    vi.mocked(listAlertEnabledSavedSearches).mockResolvedValue([search]);
    vi.mocked(matchSavedSearch).mockResolvedValue([opening]);

    await runScan({ notify: true, stateDir });

    expect(capturedConsoleAlerts).toHaveLength(1);
    const alertItems = capturedConsoleAlerts[0]!;
    expect(alertItems).toHaveLength(1);
    const alert = alertItems[0] as { parkName: string; campgroundName: string; sourceUrl: string };
    expect(alert.parkName).toBe('Sonoma Coast SP');
    expect(alert.campgroundName).toBe('Bodega Dunes');
    expect(alert.sourceUrl).toBe('');
  });

  it('stamps notifiedAt for saved-search hits via console-only path (emailEnabled=false)', async () => {
    const search = makeSavedSearch({ emailEnabled: false });
    const opening = makeOpening();
    vi.mocked(listAlertEnabledSavedSearches).mockResolvedValue([search]);
    vi.mocked(matchSavedSearch).mockResolvedValue([opening]);

    await runScan({ notify: true, stateDir });

    const state = readHitsState(stateDir);
    expect(state.hits[0]?.notifiedAt).toBeTruthy();
  });
});
