import fs from 'fs';
import path from 'path';
import type { ScanResultJSON } from '../types/scanner.js';

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
  siteName: string;
  arrivalDate: string;   // YYYY-MM-DD
  departureDate: string; // YYYY-MM-DD (= candidate.endDate)
  nights: number;
  bookingUrl?: string;
  firstSeenAt: string;   // ISO 8601
  lastSeenAt: string;    // ISO 8601
}

export interface HitsState {
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
  return `${h.targetId}|${h.siteName}|${h.arrivalDate}|${h.departureDate}`;
}

export function readHitsState(stateDir: string): HitsState {
  const p = hitsPath(stateDir);
  if (!fs.existsSync(p)) return { hits: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as HitsState;
  } catch {
    return { hits: [] };
  }
}

export function mergeHits(existing: HitsState, incoming: AvailabilityHitRecord[]): HitsState {
  const map = new Map<string, AvailabilityHitRecord>();

  // Index existing hits
  for (const h of existing.hits) {
    map.set(hitKey(h), h);
  }

  // Upsert incoming — keep firstSeenAt, update lastSeenAt
  for (const h of incoming) {
    const key = hitKey(h);
    const prev = map.get(key);
    if (prev) {
      map.set(key, { ...prev, lastSeenAt: h.lastSeenAt });
    } else {
      map.set(key, h);
    }
  }

  // Sort by arrivalDate desc, then siteName
  const hits = Array.from(map.values()).sort((a, b) => {
    const d = b.arrivalDate.localeCompare(a.arrivalDate);
    return d !== 0 ? d : a.siteName.localeCompare(b.siteName);
  });

  return { hits };
}

export function findNewHits(
  existing: HitsState,
  incoming: AvailabilityHitRecord[]
): AvailabilityHitRecord[] {
  const existingKeys = new Set(existing.hits.map(hitKey));
  return incoming.filter((h) => !existingKeys.has(hitKey(h)));
}

export function writeHitsState(stateDir: string, state: HitsState): void {
  ensureStateDir(stateDir);
  fs.writeFileSync(hitsPath(stateDir), JSON.stringify(state, null, 2) + '\n', 'utf-8');
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
