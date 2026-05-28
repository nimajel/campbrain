import { loadTargets } from '../../lib/targets';
import TargetsClient from './TargetsClient';

export const dynamic = 'force-dynamic';

export default function TargetsPage() {
  const targets = loadTargets();

  return (
    <>
      <div className="page-header">
        <h1>Targets</h1>
        <p className="page-subtitle">Configure campgrounds and sites to monitor</p>
      </div>

      <TargetsClient initialTargets={targets} />
    </>
  );
}
