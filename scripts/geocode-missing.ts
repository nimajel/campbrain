// Patch coordinates for the 7 parks that Nominatim couldn't resolve.
// Coords sourced from: parks.ca.gov park pages and Nominatim (where it worked).
import { updateParkMetadata } from '../src/catalog/catalog-store.js';

const patches: { parkPageId: string; parkName: string; lat: number; lon: number }[] = [
  { parkPageId: '426',  parkName: 'Benbow SRA',               lat: 40.067,      lon: -123.79       },
  { parkPageId: '494',  parkName: 'Malakoff Diggins SHP',     lat: 39.3750138,  lon: -120.9160464  },
  { parkPageId: '504',  parkName: 'Tahoe SRA',                lat: 39.176194,   lon: -120.135031   },
  { parkPageId: '553',  parkName: 'Indian Grinding Rock SHP', lat: 38.4248945,  lon: -120.6435204  },
  { parkPageId: '583',  parkName: 'Colonel Allensworth SHP',  lat: 35.8727103,  lon: -119.4018538  },
  { parkPageId: '585',  parkName: 'Fort Tejon SHP',           lat: 34.8693465,  lon: -118.9025777  },
  { parkPageId: '1207', parkName: 'Oceano Dunes SVRA',        lat: 35.1058800,  lon: -120.6308600  },
];

async function main() {
  for (const { parkPageId, parkName, lat, lon } of patches) {
    updateParkMetadata(parkPageId, { lat, lon });
    console.log(`✅ ${parkName}: ${lat}, ${lon}`);
  }
}

main();
