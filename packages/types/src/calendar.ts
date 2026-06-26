import { z } from "zod";

export const ReminderTypeSchema = z.enum(["prep", "night-before", "booking"]);
export type ReminderType = z.infer<typeof ReminderTypeSchema>;

export const CalendarConnectionStatusSchema = z.object({
  connected: z.boolean(),
  connectedAt: z.string().optional(),
});
export type CalendarConnectionStatus = z.infer<typeof CalendarConnectionStatusSchema>;

export const CalendarEventDraftSchema = z.object({
  key: z.string(),
  targetId: z.string(),
  reminderType: ReminderTypeSchema,
  summary: z.string(),
  description: z.string(),
  startTimeIso: z.string(),
  endTimeIso: z.string(),
  timeZone: z.string(),
});
export type CalendarEventDraft = z.infer<typeof CalendarEventDraftSchema>;
