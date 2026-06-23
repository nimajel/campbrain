import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Input for the public `search` procedure. NO minNights: the date range IS the stay
 *  length (searchAvailableStays finds sites open every night in [from, to)).
 *  Region is filtered in the procedure handler, not the DB query. */
export const SearchInputSchema = z.object({
  from: isoDate,
  to: isoDate,
  access: z.array(z.enum(["drive_in", "hike_in", "boat_in"])).default([]),
  kinds: z.array(z.enum(["tent", "hookup", "cabin"])).default([]),
  hide: z.array(z.enum(["group", "equestrian", "walk_up"])).default([]),
  region: z.enum(["north-coast", "bay-area", "sierra", "central-coast", "socal"]).nullable().default(null),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;
