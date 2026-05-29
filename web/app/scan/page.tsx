import { loadTargets } from '../../lib/targets';
import { getLatestScanState, getHitsState } from '../../lib/state';
import ScanClient from './ScanClient';
import type { Target } from '../../../src/config/schemas';

export const dynamic = 'force-dynamic';

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const targets = loadTargets();
  const { target: targetParam } = await searchParams;

  const selectedTarget: Target | undefined =
    targetParam
      ? targets.find((t) => t.id === targetParam)
      : targets[0];

  const scanState = getLatestScanState();
  const { hits: allHits } = getHitsState();
  const savedScan = selectedTarget ? scanState[selectedTarget.id] : undefined;
  const targetHits = allHits.filter((h) => h.targetId === selectedTarget?.id);

  return (
    <>
      <div className="page-header">
        <h1>Availability Scan</h1>
        <p className="page-subtitle">
          Check upcoming availability against ReserveCalifornia — no automatic polling
        </p>
      </div>

      {targets.length === 0 && (
        <div className="empty">
          No targets configured.{' '}
          <a href="/targets">Add a target</a> first.
        </div>
      )}

      {targets.length > 0 && (
        <ScanClient
          targets={targets}
          selectedTargetId={selectedTarget?.id}
          initialSavedScan={savedScan}
          initialHits={targetHits}
        />
      )}
    </>
  );
}
