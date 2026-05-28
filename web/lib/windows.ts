import { calculateBookingWindows } from '../../src/rules/booking-window';
import type { Target } from '../../src/config/schemas';
import type { BookingWindowInfo } from '../../src/rules/booking-window';

export type { BookingWindowInfo };

export function getBookingWindows(target: Target): BookingWindowInfo[] {
  return calculateBookingWindows(target);
}
