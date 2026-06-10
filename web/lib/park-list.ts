export type ParkListSort = 'sites' | 'distance' | 'name' | 'soonest';

export interface ParkListRow {
  parkPageId: string;
  parkName: string;
  isFederal: boolean;
  siteCount: number;
  walkUpCount: number;
  distanceMi: number | null;
  soonestDate: string | null;
}

export function sortParkRows(rows: ParkListRow[], sort: ParkListSort): ParkListRow[] {
  const byName = (a: ParkListRow, b: ParkListRow) => a.parkName.localeCompare(b.parkName);
  const out = [...rows];
  if (sort === 'name') return out.sort(byName);
  if (sort === 'sites') return out.sort((a, b) => b.siteCount - a.siteCount || byName(a, b));
  if (sort === 'soonest') {
    return out.sort((a, b) => {
      if (a.soonestDate === b.soonestDate) return byName(a, b);
      if (a.soonestDate === null) return 1;
      if (b.soonestDate === null) return -1;
      return a.soonestDate < b.soonestDate ? -1 : 1;
    });
  }
  return out.sort(
    (a, b) => (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity) || byName(a, b),
  );
}
