import fs from 'fs';
import path from 'path';
import type { ScanResultJSON } from '../types/scanner.js';
import type { SavedSearchOpening } from '../saved-search/match.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LatestScanSummary {
  targetId: string;
  targetName: string;
  scannedAt: string;        // ISO 8601 of the most recent scan run
  candidatesScanned: number;
  matchCount: number;
  results: ScanResultJSON[];
}

// Keyed by targetId
export type LatestScanState = Record<string, LatestScanSummary>;

export interface AvailabilityHitRecord {
  targetId: string;
  targetName: string;
  // Optional fields set when this record originates from a saved search
  savedSearchId?: string;
  parkPageId?: string;
  parkName?: string;
  campgroundName?: string;
  siteName: string;
  arrivalDate: string;   // YYYY-MM-DD
  departureDate: string; // YYYY-MM-DD (= candidate.endDate)
  nights: number;
  bookingUrl?: string;
  firstSeenAt: string;   // ISO 8601
  lastSeenAt: string;    // ISO 8601
  notifiedAt?: string;   // ISO 8601 of the last successful notification delivery
  disappearedAt?: string; // ISO 8601 — checked but no longer available
  availabilityAsOf?: string; // ISO 8601 — cache freshness at match time
}

export interface HitsState {
  version?: number; // 3 = saved-search-aware records (adds optional opening fields)
  hits: AvailabilityHitRecord[];
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function ensureStateDir(stateDir: string): void {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
}

function latestScanPath(stateDir: string): string {
  return path.join(stateDir, 'latest-scan-results.json');
}

function hitsPath(stateDir: string): string {
  return path.join(stateDir, 'availability-hits.json');
}

// ---------------------------------------------------------------------------
// Latest scan state
// ---------------------------------------------------------------------------

export function readLatestScanState(stateDir: string): LatestScanState {
  const p = latestScanPath(stateDir);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as LatestScanState;
  } catch {
    return {};
  }
}

export function writeLatestScan(
  stateDir: string,
  targetId: string,
  summary: LatestScanSummary
): void {
  ensureStateDir(stateDir);
  const existing = readLatestScanState(stateDir);
  existing[targetId] = summary;
  fs.writeFileSync(latestScanPath(stateDir), JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Hits state
// ---------------------------------------------------------------------------

export function hitKey(h: AvailabilityHitRecord): string {
  if (h.savedSearchId !== undefined) {
    return `ss:${h.savedSearchId}|${h.parkPageId ?? ''}|${h.campgroundName ?? ''}|${h.siteName}|${h.arrivalDate}|${h.departureDate}`;
  }
  return `${h.targetId}|${h.siteName}|${h.arrivalDate}|${h.departureDate}`;
}

export function readHitsState(stateDir: string): HitsState {
  const p = hitsPath(stateDir);
  if (!fs.existsSync(p)) return { version: 3, hits: [] };
  try {
    const state = JSON.parse(fs.readFileSync(p, 'utf-8')) as HitsState;
    if (!state.version) {
      // v1→v3 migration: legacy records predate notifiedAt, so treat them as
      // already notified to avoid a re-notification burst on first run.
      return {
        version: 3,
        hits: state.hits.map((h) => (h.notifiedAt ? h : { ...h, notifiedAt: h.lastSeenAt })),
      };
    }
    if (state.version === 2) {
      // v2→v3: records load unchanged — v3 only adds optional opening fields
      // that are simply absent on old records; no notifiedAt rewrite needed.
      return { version: 3, hits: state.hits };
    }
    return state;
  } catch {
    return { version: 3, hits: [] };
  }
}

export function writeHitsState(stateDir: string, state: HitsState): void {
  ensureStateDir(stateDir);
  const out: HitsState = { version: 3, hits: state.hits };
  fs.writeFileSync(hitsPath(stateDir), JSON.stringify(out, null, 2) + '\n', 'utf-8');
}

/**
 * Reconcile this scan's incoming hits against stored state.
 *
 * - prunes past-arrival hits
 * - new key → add + notify
 * - reappeared (had disappearedAt) → clear + notify
 * - still present → bump lastSeenAt only
 * - checked but absent → stamp disappearedAt
 * - unchecked (park not scanned this run) → untouched
 * - at-least-once: retained visible hits without notifiedAt are re-queued
 */
export function reconcileHits(
  existing: HitsState,
  incoming: AvailabilityHitRecord[],
  checkedKeys: Set<string>,
  now: string,
  today: string,
): { merged: HitsState; toNotify: AvailabilityHitRecord[] } {
  const map = new Map<string, AvailabilityHitRecord>();
  for (const h of existing.hits) {
    if (h.arrivalDate < today) continue;
    map.set(hitKey(h), h);
  }

  const incomingKeys = new Set<string>();
  const toNotifyKeys = new Set<string>();

  for (const h of incoming) {
    const key = hitKey(h);
    incomingKeys.add(key);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, h);
      toNotifyKeys.add(key);
    } else if (prev.disappearedAt) {
      const { disappearedAt: _gone, ...rest } = prev;
      map.set(key, {
        ...rest,
        lastSeenAt: h.lastSeenAt,
        ...(h.availabilityAsOf || prev.availabilityAsOf
          ? { availabilityAsOf: h.availabilityAsOf ?? prev.availabilityAsOf }
          : {}),
      });
      toNotifyKeys.add(key);
    } else {
      map.set(key, {
        ...prev,
        lastSeenAt: h.lastSeenAt,
        ...(h.availabilityAsOf || prev.availabilityAsOf
          ? { availabilityAsOf: h.availabilityAsOf ?? prev.availabilityAsOf }
          : {}),
      });
    }
  }

  for (const [key, h] of map) {
    if (!incomingKeys.has(key) && checkedKeys.has(key) && !h.disappearedAt) {
      map.set(key, { ...h, disappearedAt: now });
    }
  }

  for (const [key, h] of map) {
    if (!h.notifiedAt && !h.disappearedAt) toNotifyKeys.add(key);
  }

  const hits = Array.from(map.values()).sort((a, b) => {
    const d = b.arrivalDate.localeCompare(a.arrivalDate);
    return d !== 0 ? d : a.siteName.localeCompare(b.siteName);
  });

  return {
    merged: { version: 3, hits },
    toNotify: hits.filter((h) => toNotifyKeys.has(hitKey(h))),
  };
}

// ---------------------------------------------------------------------------
// Convert scan results → hit records
// ---------------------------------------------------------------------------

export function resultsToHitRecords(
  results: ScanResultJSON[],
  now: string = new Date().toISOString()
): AvailabilityHitRecord[] {
  const records: AvailabilityHitRecord[] = [];

  for (const r of results) {
    for (const hit of r.hits) {
      const record: AvailabilityHitRecord = {
        targetId: r.targetId,
        targetName: r.targetName,
        siteName: hit.siteName,
        arrivalDate: r.candidate.arrivalDate,
        departureDate: r.candidate.endDate,
        nights: r.candidate.nights,
        firstSeenAt: now,
        lastSeenAt: now,
      };
      if (r.bookingUrl !== undefined) record.bookingUrl = r.bookingUrl;
      if (r.availabilityAsOf !== undefined) record.availabilityAsOf = r.availabilityAsOf;
      records.push(record);
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// Build a LatestScanSummary from results
// ---------------------------------------------------------------------------

export function buildScanSummary(
  targetId: string,
  targetName: string,
  results: ScanResultJSON[]
): LatestScanSummary {
  const scannedAt = results[0]?.scannedAt ?? new Date().toISOString();
  return {
    targetId,
    targetName,
    scannedAt,
    candidatesScanned: results.length,
    matchCount: results.filter((r) => r.hits.length > 0).length,
    results,
  };
}

// ---------------------------------------------------------------------------
// savedSearchCheckedKeys
//
// For a saved-search run, "checked" = keys of currently-stored hits for this
// saved search (whose window was re-evaluated this run) ∪ incoming keys.
// This preserves disappear→reappear semantics without enumerating the catalog.
// ---------------------------------------------------------------------------

export function savedSearchCheckedKeys(
  existing: HitsState,
  savedSearchId: string,
  incomingKeys: Set<string>,
): Set<string> {
  const checked = new Set(incomingKeys);
  for (const h of existing.hits) {
    if (h.savedSearchId === savedSearchId) {
      checked.add(hitKey(h));
    }
  }
  return checked;
}

// ---------------------------------------------------------------------------
// Convert saved-search openings → hit records
// ---------------------------------------------------------------------------

export function openingsToHitRecords(
  openings: SavedSearchOpening[],
  now: string = new Date().toISOString()
): AvailabilityHitRecord[] {
  return openings.map((o) => {
    const record: AvailabilityHitRecord = {
      targetId: '',
      targetName: '',
      savedSearchId: o.savedSearchId,
      parkPageId: o.parkPageId,
      parkName: o.parkName,
      campgroundName: o.campgroundName,
      siteName: o.siteName,
      arrivalDate: o.arrivalDate,
      departureDate: o.departureDate,
      nights: o.nights,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    if (o.bookingUrl !== null) record.bookingUrl = o.bookingUrl;
    if (o.availabilityAsOf !== undefined) record.availabilityAsOf = o.availabilityAsOf;
    return record;
  });
}
