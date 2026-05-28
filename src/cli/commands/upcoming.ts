import { loadTargets } from '../../config/targets.js';
import { calculateBookingWindows } from '../../rules/booking-window.js';

export function upcomingCommand(): void {
  const targets = loadTargets();

  console.log('\n📅 Upcoming Booking Windows\n');
  console.log('═'.repeat(80));

  for (const target of targets) {
    console.log(`\n🏕️  ${target.name}`);
    console.log(`   Provider: ${target.provider}`);
    console.log(`   Park: ${target.parkName} - ${target.campgroundName}`);
    console.log(`   Sites: ${target.preferredSites.join(', ')}`);
    console.log(`   Dates: ${target.rangeStart} to ${target.rangeEnd}`);
    console.log(`   ${target.weekendsOnly ? 'Weekends only' : 'Any day'}`);
    console.log('');

    const windows = calculateBookingWindows(target);

    if (windows.length === 0) {
      console.log('   No booking windows in range');
      continue;
    }

    // Group by month for readability
    const byMonth: Record<string, typeof windows> = {};
    for (const window of windows) {
      const month = window.arrivalDate.slice(0, 7); // YYYY-MM
      if (!byMonth[month]) byMonth[month] = [];
      byMonth[month].push(window);
    }

    for (const [month, monthWindows] of Object.entries(byMonth)) {
      console.log(`   ${month}:`);
      for (const window of monthWindows) {
        console.log(`     ${window.arrivalDate}`);
        console.log(`       ├─ Books at:  ${window.bookingOpenTime}`);
        console.log(`       ├─ Reminder:  ${window.reminderSevenDaysBefore} (7 days)`);
        console.log(`       ├─ Reminder:  ${window.reminderNightBefore} (night before)`);
        console.log(`       └─ Reminder:  ${window.reminderTenMinutesBefore} (10 min)`);
      }
    }
  }

  console.log('\n' + '═'.repeat(80) + '\n');
}
