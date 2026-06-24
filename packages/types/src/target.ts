import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const TargetScopeSchema = z.object({
  parkPageId: z.string().nullable(),
  parkName: z.string().nullable(),
  campgroundName: z.string().nullable(),
});
export type TargetScope = z.infer<typeof TargetScopeSchema>;

export const TargetDatePatternSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact"), date: isoDate }),
  z.object({ kind: z.literal("range"), from: isoDate, to: isoDate, weekendsOnly: z.boolean() }),
  z.object({ kind: z.literal("rolling_weekends"), weeks: z.number().int().min(1).max(52) }),
]);
export type TargetDatePattern = z.infer<typeof TargetDatePatternSchema>;

export const BookingRuleSchema = z.object({
  monthsBefore: z.number().int().positive().default(6),
  releaseTime: z.string().regex(/^\d{2}:\d{2}$/).default("08:00"),
  timezone: z.string().default("America/Los_Angeles"),
});
export type BookingRule = z.infer<typeof BookingRuleSchema>;

export const TargetInputSchema = z.object({
  userId: z.string().nullable(),
  provider: z.string(),
  name: z.string().min(1),
  scope: TargetScopeSchema,
  datePattern: TargetDatePatternSchema,
  bookingRule: BookingRuleSchema,
  enabled: z.boolean(),
  calendarEnabled: z.boolean(),
});
export type TargetInput = z.infer<typeof TargetInputSchema>;

export const TargetSchema = TargetInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Target = z.infer<typeof TargetSchema>;

export const BookingWindowSchema = z.object({
  arrivalDate: isoDate,
  bookingOpensAt: z.string(),
  reminders: z.object({
    sevenDaysBefore: z.string(),
    nightBefore: z.string(),
    tenMinutesBefore: z.string(),
  }),
});
export type BookingWindow = z.infer<typeof BookingWindowSchema>;

export const UpcomingTargetSchema = z.object({
  targetId: z.string(),
  name: z.string(),
  scopeLabel: z.string(),
  windows: z.array(BookingWindowSchema),
});
export type UpcomingTarget = z.infer<typeof UpcomingTargetSchema>;
