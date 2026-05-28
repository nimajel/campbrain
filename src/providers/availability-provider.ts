import type { Target } from '../config/schemas.js';
import type { ScanCandidate, ScanResult } from '../types/scanner.js';

export interface AvailabilityProvider {
  name: string;
  scan(
    target: Target,
    candidates: ScanCandidate[]
  ): Promise<ScanResult[]>;
}
