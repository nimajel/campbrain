import { z } from 'zod';

export const BookingRuleSchema = z.object({
  type: z.literal('rolling_months_before'),
  monthsBefore: z.number().int().positive(),
  releaseTime: z.string().regex(/^\d{2}:\d{2}$/), // HH:MM format
  timezone: z.string(),
});

export type BookingRule = z.infer<typeof BookingRuleSchema>;

export const TargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(['california-parks', 'recreation-gov', 'yosemite-lottery']),
  parkName: z.string(),
  parkPageId: z.string(),
  campgroundName: z.string(),
  acceptableSites: z.array(z.string()),
  preferredSites: z.array(z.string()),
  campingType: z.enum(['hike-in', 'drive-to', 'walk-in']),
  people: z.number().int().positive(),
  dateMode: z.enum(['weekend_range', 'specific_dates', 'any_weekend']),
  rangeStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  rangeEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minNights: z.number().int().positive(),
  maxNights: z.number().int().positive(),
  weekendsOnly: z.boolean(),
  bookingRule: BookingRuleSchema,
});

export type Target = z.infer<typeof TargetSchema>;

export const TargetsConfigSchema = z.object({
  targets: z.array(TargetSchema),
});

export type TargetsConfig = z.infer<typeof TargetsConfigSchema>;
