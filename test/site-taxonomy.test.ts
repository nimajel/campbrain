import { describe, it, expect } from 'vitest';
import { ACCESS_GROUP, KIND_GROUP, HIDE_GROUP, taxonomyToParams, isWalkUpSite } from '../web/lib/site-taxonomy.js';

describe('site taxonomy groups', () => {
  it('exposes the three access options', () => {
    expect(ACCESS_GROUP.options.map((o) => o.id)).toEqual(['drive_in', 'hike_in', 'boat_in']);
  });
  it('exposes the three site kinds', () => {
    expect(KIND_GROUP.options.map((o) => o.id)).toEqual(['tent', 'hookup', 'cabin']);
  });
  it('exposes the three hide targets', () => {
    expect(HIDE_GROUP.options.map((o) => o.id)).toEqual(['group', 'equestrian', 'walk_up']);
  });
  it('maps selected state to query params, omitting empties', () => {
    const qp = taxonomyToParams({ access: ['drive_in'], kinds: [], hide: ['walk_up'] });
    expect(qp.get('access')).toBe('drive_in');
    expect(qp.get('hide')).toBe('walk_up');
    expect(qp.has('kinds')).toBe(false);
  });
  it('re-exports isWalkUpSite from the classifier', () => {
    expect(isWalkUpSite('Hike/Bike 1')).toBe(true);
  });
});
