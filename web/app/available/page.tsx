import { listFreshEntriesWeb } from '../../lib/availability-cache';
import { listParksWeb } from '../../lib/catalog';
import AvailableClient from './AvailableClient';

export const dynamic = 'force-dynamic';

export default function AvailablePage() {
  const entries = listFreshEntriesWeb();
  const parks = listParksWeb();

  // Build a pageId → {lat, lon} lookup so the client can pass coords to ParkMapPopover
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
      <AvailableClient initialEntries={entries} coordsByParkId={coordsByParkId} />
    </>
  );
}
