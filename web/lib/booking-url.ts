/**
 * Replaces the date/night query params in a ReserveCalifornia booking URL
 * with the actual arrival date and night count from the scan.
 *
 * Catalog booking URLs are stored with a sample date from discovery time
 * (e.g. date=2026-11-22&night=1). This swaps in the real values so the
 * booking page opens pre-populated to the right dates.
 */
export function injectBookingDates(
  bookingUrl: string,
  arrivalDate: string,
  nights: number
): string {
  try {
    const url = new URL(bookingUrl);
    url.searchParams.set('date', arrivalDate);
    url.searchParams.set('night', String(nights));
    return url.toString();
  } catch {
    return bookingUrl;
  }
}
