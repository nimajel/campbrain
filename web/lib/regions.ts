export type CampRegion = 'north-coast' | 'bay-area' | 'sierra' | 'central-coast' | 'socal';

export const REGION_LABELS: Record<CampRegion, string> = {
  'north-coast':   'North Coast',
  'bay-area':      'Bay Area',
  'sierra':        'Sierra',
  'central-coast': 'Central Coast',
  'socal':         'SoCal',
};

export const ALL_REGIONS: CampRegion[] = [
  'north-coast', 'bay-area', 'sierra', 'central-coast', 'socal',
];

export function classifyRegion(lat: number, lon: number): CampRegion {
  if (lat >= 39.4 && lon <= -121.5) return 'north-coast';
  if (lat >= 37.0 && lon <= -121.5) return 'bay-area';
  if (lat < 37.0 && lat >= 33.5 && lon <= -119.5) return 'central-coast';
  if (lat >= 35.0 && lon > -121.5) return 'sierra';
  return 'socal';
}
