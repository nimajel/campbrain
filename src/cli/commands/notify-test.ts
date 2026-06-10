import { ConsoleNotificationService } from '../../notifications/console-notification-service.js';
import { EmailNotificationService } from '../../notifications/email-notification-service.js';
import type { AvailabilityAlert } from '../../notifications/notification-service.js';

function sampleAlert(): AvailabilityAlert {
  const now = new Date().toISOString();
  return {
    hit: {
      targetId: 'notify-test',
      targetName: 'Notification test (not a real opening)',
      siteName: 'Campsite #0',
      arrivalDate: now.slice(0, 10),
      departureDate: now.slice(0, 10),
      nights: 1,
      bookingUrl: 'https://www.reservecalifornia.com/',
      firstSeenAt: now,
      lastSeenAt: now,
    },
    parkName: 'Test Park',
    campgroundName: 'Test Campground',
    sourceUrl: 'https://www.parks.ca.gov/',
    checkedAt: now,
    availabilityAsOf: now,
  };
}

/** Verify notification config on demand without waiting for a real hit. */
export async function notifyTestCommand(): Promise<void> {
  const alert = sampleAlert();

  console.log('Testing console notification…');
  const consoleResult = await new ConsoleNotificationService().notify([alert]);
  console.log(`Console: ${consoleResult}`);

  console.log('\nTesting email notification…');
  const emailResult = await new EmailNotificationService().notify([alert]);
  console.log(`Email:   ${emailResult}`);

  if (emailResult === 'failed') {
    process.exitCode = 1;
  }
}
