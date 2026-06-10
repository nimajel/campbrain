import type { NotificationService, AvailabilityAlert, DeliveryResult } from './notification-service.js';

export class ConsoleNotificationService implements NotificationService {
  async notify(alerts: AvailabilityAlert[]): Promise<DeliveryResult> {
    for (const a of alerts) {
      const { hit } = a;
      console.log(`\n🏕️  NEW AVAILABILITY: ${hit.targetName}`);
      console.log(`   Park:       ${a.parkName}`);
      console.log(`   Campground: ${a.campgroundName}`);
      console.log(`   Site:       ${hit.siteName}`);
      console.log(`   Arrival:    ${hit.arrivalDate}`);
      console.log(`   Departure:  ${hit.departureDate} (${hit.nights}N)`);
      if (hit.bookingUrl) console.log(`   Book:       ${hit.bookingUrl}`);
      console.log(`   Source:     ${a.sourceUrl}`);
      console.log(`   Checked:    ${a.checkedAt}`);
      if (a.availabilityAsOf) console.log(`   As of:      ${a.availabilityAsOf} (cached — verify before booking)`);
      console.log('');
    }
    return 'delivered';
  }
}
