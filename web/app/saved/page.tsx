import SavedSearchesClient from './SavedSearchesClient';

export const dynamic = 'force-dynamic';

export default function SavedSearchesPage() {
  return (
    <>
      <div className="page-header">
        <h1>Saved Searches</h1>
        <p className="page-subtitle">
          Your saved campsite searches — run them or set up email alerts.
        </p>
      </div>
      <SavedSearchesClient />
    </>
  );
}
