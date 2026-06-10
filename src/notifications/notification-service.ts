import type { AvailabilityHitRecord } from '../state/scan-state.js';

export interface AvailabilityAlert {
  hit: AvailabilityHitRecord;
  parkName: string;
  campgroundName: string;
  sourceUrl: string;
  checkedAt: string;
  availabilityAsOf?: string; // ISO 8601 — cache freshness at match time
}

export type DeliveryResult = 'delivered' | 'skipped-unconfigured' | 'failed';

export interface NotificationService {
  notify(alerts: AvailabilityAlert[]): Promise<DeliveryResult>;
}
