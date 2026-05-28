export interface ScanCandidate {
  arrivalDate: string; // YYYY-MM-DD
  nights: number;
  endDate: string; // YYYY-MM-DD
}

export interface AvailabilityHit {
  siteName: string;
  status: string; // e.g., "Available", "Reserved", Unknown/unparsed status text
  confidence: 'high' | 'medium' | 'low';
}

export interface ScanResult {
  targetId: string;
  targetName: string;
  candidate: ScanCandidate;
  sourceUrl: string;
  debugHtmlPath: string;
  hits: AvailabilityHit[];
  parsingNotes: string;
  scannedAt: string; // ISO 8601 timestamp
}
