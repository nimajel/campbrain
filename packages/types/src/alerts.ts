import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RecentOpeningSchema = z.object({
  id: z.string(),
  parkPageId: z.string(),
  parkName: z.string(),
  campgroundName: z.string(),
  siteName: z.string(),
  arrivalDate: isoDate,
  nights: z.number().int().positive(),
  bookingUrl: z.string().nullable(),
  firstSeenAt: z.string(),
});
export type RecentOpening = z.infer<typeof RecentOpeningSchema>;

export const DashboardStatsSchema = z.object({
  activeAlerts: z.number().int().nonnegative(),
  currentMatches: z.number().int().nonnegative(),
  totalHits: z.number().int().nonnegative(),
});
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;

export const ScanRunKind = z.enum(["proactive", "alert", "calendar"]);
export type ScanRunKind = z.infer<typeof ScanRunKind>;
