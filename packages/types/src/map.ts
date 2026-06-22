import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const accessSchema = z.array(z.enum(["drive_in", "hike_in", "boat_in"])).default([]);
const kindsSchema = z.array(z.enum(["tent", "hookup", "cabin"])).default([]);
const hideSchema = z.array(z.enum(["group", "equestrian", "walk_up"])).default([]);
const minNightsSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]).optional();

export const MapAvailabilityInputSchema = z.object({
  parkPageId: z.string(),
  provider: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  access: accessSchema,
  kinds: kindsSchema,
  hide: hideSchema,
});
export type MapAvailabilityInput = z.infer<typeof MapAvailabilityInputSchema>;

export const MapSummaryInputSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  weekendsOnly: z.boolean().default(false),
  access: accessSchema,
  kinds: kindsSchema,
  hide: hideSchema,
  minNights: minNightsSchema,
});
export type MapSummaryInput = z.infer<typeof MapSummaryInputSchema>;
