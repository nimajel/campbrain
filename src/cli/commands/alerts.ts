import { listAlerts, enableAlert, disableAlert, getAlert } from '../../config/alerts.js';

export function alertsListCommand(): void {
  const alerts = listAlerts();

  if (alerts.length === 0) {
    console.log('No alerts configured.');
    return;
  }

  console.log('\n🔔 Configured Alerts\n');
  console.log('═'.repeat(72));

  for (const a of alerts) {
    const status = a.enabled ? '✅ enabled ' : '⏸  disabled';
    const email = a.emailEnabled ? '📧' : '  ';
    const cal = a.calendarEnabled ? '📅' : '  ';
    console.log(`\n  [${status}] ${email} ${cal}  ${a.name} (${a.id})`);
    console.log(`    Park:      ${a.parkName} · ${a.campgroundName}`);
    console.log(`    Sites:     ${a.acceptableSites.join(', ')}`);
    console.log(`    Nights:    ${a.minNights}–${a.maxNights}`);
    console.log(`    People:    ${a.people}`);
    if (a.createdAt) console.log(`    Created:   ${a.createdAt.slice(0, 10)}`);
    if (a.updatedAt) console.log(`    Updated:   ${a.updatedAt.slice(0, 10)}`);
  }

  console.log('\n' + '═'.repeat(72) + '\n');
}

export function alertsEnableCommand(id: string): void {
  const alert = getAlert(id);
  if (!alert) {
    console.error(`Alert "${id}" not found.`);
    process.exit(1);
  }
  enableAlert(id);
  console.log(`✅ Alert "${id}" enabled.`);
}

export function alertsDisableCommand(id: string): void {
  const alert = getAlert(id);
  if (!alert) {
    console.error(`Alert "${id}" not found.`);
    process.exit(1);
  }
  disableAlert(id);
  console.log(`⏸  Alert "${id}" disabled.`);
}
