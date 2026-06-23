import type { WeekendCampground, AvailableDateEntry } from "@campbrain/core";
import { addDaysIso } from "./map-utils";
import type { MinNights } from "./types";

export interface WeekendTierFlags {
  line3: boolean;
  line2Fri: boolean;
  line2Sat: boolean;
  line1Fri: boolean;
  line1Sat: boolean;
}

/** Which weekend stay-tier lines are visible for a campground given minNights.
 *  Mirrors the inline per-campground rules in the legacy WeekendRow (lines 362-369). */
export function selectWeekendTiers(cg: WeekendCampground, minNights: MinNights): WeekendTierFlags {
  const show3Night = minNights !== 1;
  const show2Night = minNights !== 1 && minNights !== 3;
  const show3NightOnly = minNights === 3;

  const line3 = show3Night && cg.sites3Night.length > 0;
  const line2Fri = show2Night && !show3NightOnly && cg.sites2NightFri.length > 0 && !line3;
  const line2Sat = show2Night && !show3NightOnly && cg.sites2NightSat.length > 0 && !line3;
  const longerShown = line3 || line2Fri || line2Sat;
  const show1Night = minNights === 1 || (minNights === null && !longerShown);
  const line1Fri = show1Night && cg.sites1NightFri.length > 0;
  const line1Sat = show1Night && cg.sites1NightSat.length > 0;

  return { line3, line2Fri, line2Sat, line1Fri, line1Sat };
}

/** For the dates view with minNights >= 2, keep only dates that anchor a full
 *  N-consecutive-night chain, intersecting each campground's sites across the chain.
 *  minNights null/1 → input returned unchanged (same reference). */
export function intersectConsecutiveDates(
  dates: AvailableDateEntry[],
  minNights: MinNights,
): AvailableDateEntry[] {
  if (minNights === null || minNights < 2) return dates;

  const byDate = new Map(dates.map((d) => [d.date, d]));
  return dates.flatMap((entry) => {
    const chain: AvailableDateEntry[] = [entry];
    for (let i = 1; i < minNights; i++) {
      const next = byDate.get(addDaysIso(entry.date, i));
      if (!next) return [];
      chain.push(next);
    }
    const campgrounds = entry.campgrounds.flatMap((cg) => {
      let sitesIntersection = cg.sites;
      for (let i = 1; i < chain.length; i++) {
        const chainCg = chain[i]!.campgrounds.find((c) => c.name === cg.name);
        if (!chainCg) return [];
        sitesIntersection = sitesIntersection.filter((s) => chainCg.sites.includes(s));
      }
      if (sitesIntersection.length === 0) return [];
      return [{ ...cg, sites: sitesIntersection, walkUpSites: [], availableSiteCount: sitesIntersection.length }];
    });
    if (campgrounds.length === 0) return [];
    return [{ ...entry, campgrounds }];
  });
}
