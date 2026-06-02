import { listParksWeb } from '../../lib/catalog';
import AvailableClient from './AvailableClient';

export default function AvailablePage() {
  const parks = listParksWeb();

  const coordsByParkId: Record<string, { lat: number; lon: number }> = {};
  for (const p of parks) {
    if (p.lat !== undefined && p.lon !== undefined) {
      coordsByParkId[p.parkPageId] = { lat: p.lat, lon: p.lon };
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>What&apos;s Available</h1>
        <p className="page-subtitle">
          Auto-updated every 2 hours · upcoming weekends across all parks
        </p>
      </div>
      <AvailableClient initialEntries={[]} coordsByParkId={coordsByParkId} />
    </>
  );
}
