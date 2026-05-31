// ---------------------------------------------------------------------------
// Nominatim geocoder — OpenStreetMap, free, no API key required.
// Rate limit: 1 req/s. Called only during catalog refresh, not at runtime.
// ---------------------------------------------------------------------------

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

/** Expand abbreviations so Nominatim matches park names reliably. */
function expandParkName(name: string): string {
  return name
    .replace(/\bSP\b/g, 'State Park')
    .replace(/\bSRA\b/g, 'State Recreation Area')
    .replace(/\bSB\b/g, 'State Beach')
    .replace(/\bSNR\b/g, 'State Natural Reserve');
}

export interface GeoCoords {
  lat: number;
  lon: number;
}

export async function geocodeParkName(
  parkName: string,
  state = 'California'
): Promise<GeoCoords | null> {
  const expanded = expandParkName(parkName);
  const query = encodeURIComponent(`${expanded} ${state}`);
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=us`;

  try {
    const res = await fetch(url, {
      headers: {
        'Accept-Language': 'en',
        // Nominatim policy: identify your application
        'User-Agent': 'CampBrain-catalog-refresh/1.0 (personal-use)',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NominatimResult[];
    if (!data[0]) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}
