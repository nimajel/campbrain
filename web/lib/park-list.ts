export type ParkListSort = 'sites' | 'distance' | 'name';

export interface ParkListRow {
  parkPageId: string;
  parkName: string;
  isFederal: boolean;
  siteCount: number;
  walkUpCount: number;
  distanceMi: number | null;
}

export function sortParkRows(rows: ParkListRow[], sort: ParkListSort): ParkListRow[] {
  const byName = (a: ParkListRow, b: ParkListRow) => a.parkName.localeCompare(b.parkName);
  const out = [...rows];
  if (sort === 'name') return out.sort(byName);
  if (sort === 'sites') return out.sort((a, b) => b.siteCount - a.siteCount || byName(a, b));
  return out.sort(
    (a, b) => (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity) || byName(a, b),
  );
}
