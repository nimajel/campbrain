import { listParksWeb } from '../../lib/catalog';
import CatalogClient from './CatalogClient';

export default function CatalogPage() {
  const parks = listParksWeb();
  return <CatalogClient initialParks={parks} />;
}
