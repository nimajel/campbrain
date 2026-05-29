import { listAlertsWeb } from '../../lib/alerts';
import { listParksWeb } from '../../lib/catalog';
import AlertsClient from './AlertsClient';

export const dynamic = 'force-dynamic';

export default function AlertsPage() {
  const alerts = listAlertsWeb();
  const parks = listParksWeb();
  return <AlertsClient initial={alerts} parks={parks} />;
}
