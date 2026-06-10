import { describe, it, expect } from 'vitest';
import { sortParkRows } from '../web/lib/park-list.js';
import type { ParkListRow } from '../web/lib/park-list.js';

function row(partial: Partial<ParkListRow> & { parkName: string }): ParkListRow {
  return {
    parkPageId: partial.parkName,
    isFederal: false,
    siteCount: 0,
    walkUpCount: 0,
    distanceMi: null,
    ...partial,
  };
}

describe('sortParkRows', () => {
  it('sites: descending, name tiebreak', () => {
    const rows = [row({ parkName: 'B', siteCount: 5 }), row({ parkName: 'A', siteCount: 5 }), row({ parkName: 'C', siteCount: 9 })];
    expect(sortParkRows(rows, 'sites').map((r) => r.parkName)).toEqual(['C', 'A', 'B']);
  });

  it('sites: walk-up-only parks (0 bookable) sort last', () => {
    const rows = [row({ parkName: 'Walk', walkUpCount: 3 }), row({ parkName: 'Book', siteCount: 1 })];
    expect(sortParkRows(rows, 'sites').map((r) => r.parkName)).toEqual(['Book', 'Walk']);
  });

  it('distance: ascending, null distances last', () => {
    const rows = [row({ parkName: 'Far', distanceMi: 90 }), row({ parkName: 'NoCoords' }), row({ parkName: 'Near', distanceMi: 12 })];
    expect(sortParkRows(rows, 'distance').map((r) => r.parkName)).toEqual(['Near', 'Far', 'NoCoords']);
  });

  it('name: alphabetical', () => {
    const rows = [row({ parkName: 'Salt Point SP' }), row({ parkName: 'Angel Island SP' })];
    expect(sortParkRows(rows, 'name').map((r) => r.parkName)).toEqual(['Angel Island SP', 'Salt Point SP']);
  });

  it('does not mutate the input array', () => {
    const rows = [row({ parkName: 'B' }), row({ parkName: 'A' })];
    sortParkRows(rows, 'name');
    expect(rows.map((r) => r.parkName)).toEqual(['B', 'A']);
  });
});
