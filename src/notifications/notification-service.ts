import type { AvailabilityHitRecord } from '../state/scan-state.js';

export interface AvailabilityAlert {
  hit: AvailabilityHitRecord;
  parkName: string;
  campgroundName: string;
  sourceUrl: string;
  checkedAt: string;
}

export interface NotificationService {
  notify(alerts: AvailabilityAlert[]): Promise<void>;
}
