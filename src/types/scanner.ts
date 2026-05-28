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
  parsedCampground?: ParsedCampground;
  statusBySite?: Map<string, DailySiteStatus[]>;
}
