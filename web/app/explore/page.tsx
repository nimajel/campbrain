import { listParksWeb } from '../../lib/catalog';
import ExploreClient from './ExploreClient';

export const dynamic = 'force-dynamic';

export default function ExplorePage() {
  const parks = listParksWeb();
  return (
    <>
      <div className="page-header">
        <h1>Take Me Camping!</h1>
        <p className="page-subtitle">
          Pick dates and parks — see what&apos;s available across all campgrounds at once
        </p>
      </div>
      <ExploreClient parks={parks} />
    </>
  );
}
