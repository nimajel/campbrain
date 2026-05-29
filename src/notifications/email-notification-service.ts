import type { NotificationService, AvailabilityAlert } from './notification-service.js';

export function buildEmailSubject(alerts: AvailabilityAlert[]): string {
  return alerts.length === 1
    ? `CampBrain: campsite opening found – ${alerts[0]!.hit.targetName}`
    : `CampBrain: ${alerts.length} campsite openings found`;
}

export function buildEmailBody(alerts: AvailabilityAlert[]): string {
  const lines: string[] = [
    'CampBrain found new campsite availability.\n',
  ];

  for (const a of alerts) {
    const { hit } = a;
    lines.push(`Target:     ${hit.targetName}`);
    lines.push(`Park:       ${a.parkName}`);
    lines.push(`Campground: ${a.campgroundName}`);
    lines.push(`Site:       ${hit.siteName}`);
    lines.push(`Arrival:    ${hit.arrivalDate}`);
    lines.push(`Departure:  ${hit.departureDate} (${hit.nights} night${hit.nights !== 1 ? 's' : ''})`);
    if (hit.bookingUrl) lines.push(`Book:       ${hit.bookingUrl}`);
    lines.push(`Source:     ${a.sourceUrl}`);
    lines.push(`Checked:    ${a.checkedAt}`);
    lines.push('');
  }

  lines.push(
    '⚠️  Availability can disappear quickly.',
    'Complete your booking manually on the official reservation site.'
  );

  return lines.join('\n');
}

export class EmailNotificationService implements NotificationService {
  async notify(alerts: AvailabilityAlert[]): Promise<void> {
    if (alerts.length === 0) return;

    const apiKey = process.env['RESEND_API_KEY'];
    const to = process.env['ALERT_EMAIL_TO'];
    const from = process.env['ALERT_EMAIL_FROM'];

    if (!apiKey || !to || !from) {
      console.log('📧 Email skipped: RESEND_API_KEY, ALERT_EMAIL_TO, and ALERT_EMAIL_FROM must all be set.');
      return;
    }

    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);

    const subject = buildEmailSubject(alerts);
    const text = buildEmailBody(alerts);

    const { error } = await resend.emails.send({ from, to, subject, text });

    if (error) {
      console.error(`📧 Email send failed: ${error.message}`);
    } else {
      console.log(`📧 Alert email sent to ${to}`);
    }
  }
}
