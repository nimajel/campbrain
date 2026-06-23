export interface ParkAvailabilitySummary {
  siteCount: number;
  walkUpCount: number;
  soonestDate: string | null;
}
export type Preset = "this_weekend" | "next_2_weeks" | "next_month" | "anytime";
export type MinNights = 1 | 2 | 3 | null;
export interface ResolvedLocation { lat: number; lon: number; name: string }
