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
const BOAT_IN_RE = /\b(boat[\s-]?(in|to|access)?|kayak|canoe)\b/i;
const HOOKUP_RE = /\bhook.?up\b|\(E\/W/i;
const TENT_RE = /\btent\b/i;
const CABIN_RE = /\b(cabin|yurt|cottage)\b/i;

// Park-specific access reference data. Some parks have NO drive-in campsites but the
// individual site names carry no access keyword the classifier can read (e.g. Angel
// Island's "Campsite #7"). Keyed by provider park_page_id; residualDriveInAccess
// reassigns any non-day-use site that would otherwise default to drive_in.
interface ParkAccessOverride {
  residualDriveInAccess: SiteAccess;
}
const PARK_ACCESS_OVERRIDES: Record<string, ParkAccessOverride> = {
  '468': { residualDriveInAccess: 'hike_in' }, // Angel Island SP — ferry/boat/kayak access only
};

export function isWalkUpSite(siteName: string, campgroundName = ''): boolean {
  return WALK_UP_RE.test(`${siteName} ${campgroundName}`);
}

function classifyByName(text: string): SiteTypeInfo {
  const isWalkUp = WALK_UP_RE.test(text);
  let access: SiteAccess = 'drive_in';
  // boat-in wins over hike-in: "Boat In Primitive Campsite" carries both signals
  // (primitive matches HIKE_IN_RE) but is reached by boat.
  if (BOAT_IN_RE.test(text)) access = 'boat_in';
  else if (HIKE_IN_RE.test(text)) access = 'hike_in';

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

function applyParkOverride(info: SiteTypeInfo, parkPageId?: string): SiteTypeInfo {
  if (!parkPageId) return info;
  const ov = PARK_ACCESS_OVERRIDES[parkPageId];
  if (!ov) return info;
  if (info.access === 'drive_in' && !info.isDayUse) {
    return { ...info, access: ov.residualDriveInAccess };
  }
  return info;
}

export function classifySite(
  siteName: string,
  campgroundName: string,
  recGovCampsiteType?: string,
  parkPageId?: string,
): SiteTypeInfo {
  const base = classifyByName(`${siteName} ${campgroundName}`);
  const t = recGovCampsiteType?.trim().toUpperCase();
  const typed = t ? applyRecGovType(base, t) : base;
  return applyParkOverride(typed, parkPageId);
}
