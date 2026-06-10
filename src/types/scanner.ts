// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------
export type AvailabilityStatus = 'available' | 'unavailable' | 'unknown';
export type AvailabilityConfidence = 'high' | 'medium' | 'low';

// ---------------------------------------------------------------------------
// Scanner inputs
// ---------------------------------------------------------------------------
export interface ScanCandidate {
  arrivalDate: string; // YYYY-MM-DD
  nights: number;
  endDate: string; // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Parser output types
// ---------------------------------------------------------------------------
export interface DailySiteStatus {
  date: string; // YYYY-MM-DD
  siteName: string;
  status: AvailabilityStatus;
  confidence: AvailabilityConfidence;
}

export interface ParsedCampground {
  campgroundName: string;
  bookingUrl: string;
  dates: string[]; // YYYY-MM-DD, column order
  siteRows: DailySiteStatus[][]; // one per entry in target.acceptableSites
  hasUnknownStatuses: boolean;
  sitesFound: string[];
  sitesMissing: string[];
}

// ---------------------------------------------------------------------------
// Scanner output types
// ---------------------------------------------------------------------------
export interface AvailabilityHit {
  siteName: string;
  status: string;
  confidence: AvailabilityConfidence;
}

export interface ScanResult {
  targetId: string;
  targetName: string;
  candidate: ScanCandidate;
  sourceUrl: string;
  debugHtmlPath: string;
  hits: AvailabilityHit[];
  parsingNotes: string;
  scannedAt: string; // ISO 8601
  bookingUrl?: string;
  availabilityAsOf?: string; // ISO 8601 — oldest covering cache window
  parsedCampground?: ParsedCampground;
  statusBySite?: Map<string, DailySiteStatus[]>;
}

// ---------------------------------------------------------------------------
// Serializable scan result — Maps don't survive JSON.stringify/parse
// ---------------------------------------------------------------------------
export interface ScanResultJSON {
  targetId: string;
  targetName: string;
  candidate: ScanCandidate;
  sourceUrl: string;
  debugHtmlPath: string;
  hits: AvailabilityHit[];
  parsingNotes: string;
  scannedAt: string;
  bookingUrl?: string;
  availabilityAsOf?: string;
  statusBySite?: Record<string, DailySiteStatus[]>;
}

export function serializeResult(r: ScanResult): ScanResultJSON {
  const out: ScanResultJSON = {
    targetId: r.targetId,
    targetName: r.targetName,
    candidate: r.candidate,
    sourceUrl: r.sourceUrl,
    debugHtmlPath: r.debugHtmlPath,
    hits: r.hits,
    parsingNotes: r.parsingNotes,
    scannedAt: r.scannedAt,
  };
  if (r.bookingUrl !== undefined) out.bookingUrl = r.bookingUrl;
  if (r.availabilityAsOf !== undefined) out.availabilityAsOf = r.availabilityAsOf;
  if (r.statusBySite !== undefined) out.statusBySite = Object.fromEntries(r.statusBySite);
  return out;
}
