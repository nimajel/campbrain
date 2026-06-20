export type SiteAccess = 'drive_in' | 'hike_in' | 'boat_in';
export type SiteKind = 'tent' | 'hookup' | 'cabin';

export interface SiteTypeInfo {
  access: SiteAccess;
  siteKind: SiteKind | null;
  isGroup: boolean;
  isEquestrian: boolean;
  isWalkUp: boolean;
  isDayUse: boolean;
}

const WALK_UP_RE = /\bhike\s*[/&]?\s*bike\b/i;
const GROUP_RE = /\bgroup\b/i;
const EQUESTRIAN_RE = /\b(equestrian|horse)\b/i;
const DAY_USE_RE = /\b(day.?use|dailyuse|picnic)\b/i;
const HIKE_IN_RE = /\b(hike.?in|walk.?in|environmental|primitive)\b/i;
const BOAT_IN_RE = /\bboat[\s-]?(in|to|access)?\b/i;
const HOOKUP_RE = /\bhook.?up\b|\(E\/W/i;
const TENT_RE = /\btent\b/i;
const CABIN_RE = /\b(cabin|yurt|cottage)\b/i;

export function isWalkUpSite(siteName: string, campgroundName = ''): boolean {
  return WALK_UP_RE.test(`${siteName} ${campgroundName}`);
}

function classifyByName(text: string): SiteTypeInfo {
  const isWalkUp = WALK_UP_RE.test(text);
  let access: SiteAccess = 'drive_in';
  if (HIKE_IN_RE.test(text)) access = 'hike_in';
  else if (BOAT_IN_RE.test(text)) access = 'boat_in';

  let siteKind: SiteKind | null = null;
  if (HOOKUP_RE.test(text)) siteKind = 'hookup';
  else if (TENT_RE.test(text)) siteKind = 'tent';
  else if (CABIN_RE.test(text)) siteKind = 'cabin';

  return {
    access,
    siteKind,
    isGroup: GROUP_RE.test(text),
    isEquestrian: EQUESTRIAN_RE.test(text),
    isWalkUp,
    isDayUse: DAY_USE_RE.test(text),
  };
}

function applyRecGovType(info: SiteTypeInfo, t: string): SiteTypeInfo {
  const next = { ...info };
  if (t.includes('GROUP')) next.isGroup = true;
  if (t.includes('EQUESTRIAN')) next.isEquestrian = true;
  if (t.includes('DAY USE')) next.isDayUse = true;
  if (t.includes('WALK TO') || t.includes('HIKE TO')) next.access = 'hike_in';
  else if (t.includes('BOAT')) next.access = 'boat_in';
  if (t.includes('CABIN') || t.includes('YURT')) next.siteKind = 'cabin';
  else if (t.includes('RV') || (t.includes('ELECTRIC') && !t.includes('NONELECTRIC'))) next.siteKind = 'hookup';
  else if (t.includes('TENT')) next.siteKind = 'tent';
  return next;
}

export function classifySite(
  siteName: string,
  campgroundName: string,
  recGovCampsiteType?: string,
): SiteTypeInfo {
  const base = classifyByName(`${siteName} ${campgroundName}`);
  const t = recGovCampsiteType?.trim().toUpperCase();
  if (!t) return base;
  return applyRecGovType(base, t);
}
