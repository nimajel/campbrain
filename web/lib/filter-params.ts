import type { SiteAccess, SiteKind, HideTarget } from './availability-cache';

const ACCESS = new Set<SiteAccess>(['drive_in', 'hike_in', 'boat_in']);
const KINDS = new Set<SiteKind>(['tent', 'hookup', 'cabin']);
const HIDE = new Set<HideTarget>(['group', 'equestrian', 'walk_up']);

function csv<T extends string>(raw: string | null, allowed: Set<T>): T[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter((s): s is T => allowed.has(s as T));
}

export function parseFilterParams(sp: URLSearchParams): {
  access: SiteAccess[]; kinds: SiteKind[]; hide: HideTarget[]; minNights?: 1 | 2 | 3;
} {
  const access = csv(sp.get('access'), ACCESS);
  const kinds = csv(sp.get('kinds'), KINDS);
  const hide = csv(sp.get('hide'), HIDE);
  const mnRaw = Number(sp.get('minNights'));
  const minNights = mnRaw === 1 || mnRaw === 2 || mnRaw === 3 ? mnRaw : undefined;
  return { access, kinds, hide, minNights };
}
