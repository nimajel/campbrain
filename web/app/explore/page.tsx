import FindCampsitesClient from './FindCampsitesClient';

export const dynamic = 'force-dynamic';

export default function FindCampsitesPage() {
  return (
    <>
      <div className="page-header">
        <h1>Find Campsites</h1>
        <p className="page-subtitle">
          Search available campsites across California state parks
        </p>
      </div>
      <FindCampsitesClient />
    </>
  );
}
