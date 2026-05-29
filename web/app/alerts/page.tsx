import { listAlertsWeb } from '../../lib/alerts';
import { listParksWeb } from '../../lib/catalog';
import { getLatestScanState } from '../../lib/state';
import AlertsClient from './AlertsClient';

export const dynamic = 'force-dynamic';

export default function AlertsPage() {
  const alerts = listAlertsWeb();
  const parks = listParksWeb();
  const scanState = getLatestScanState();
  return <AlertsClient initial={alerts} parks={parks} scanState={scanState} />;
}
