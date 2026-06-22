import { router, publicProcedure } from "../trpc";
import { MapAvailabilityInputSchema, MapSummaryInputSchema } from "@campbrain/types";
import { getCatalogParks, getEntriesForParks, getParkAvailabilityCounts } from "@campbrain/db";
import { toMapPark, buildParkAvailability } from "@campbrain/core";

export const mapRouter = router({
  catalog: publicProcedure.query(async ({ ctx }) => {
    const parks = await getCatalogParks(ctx.db);
    return { parks: parks.map(toMapPark) };
  }),

  availability: publicProcedure.input(MapAvailabilityInputSchema).query(async ({ ctx, input }) => {
    const entries = await getEntriesForParks(ctx.db, [input.parkPageId], input.provider);
    return buildParkAvailability(
      entries,
      { from: input.from, to: input.to, access: input.access, kinds: input.kinds, hide: input.hide },
      input.parkPageId,
    );
  }),

  summary: publicProcedure.input(MapSummaryInputSchema).query(async ({ ctx, input }) => {
    const parks = await getParkAvailabilityCounts(ctx.db, input);
    return { parks };
  }),
});
