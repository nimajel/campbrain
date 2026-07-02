import { router, publicProcedure } from "../trpc";
import { MapAvailabilityInputSchema, MapSummaryInputSchema } from "@campbrain/types";
import { getCatalogParks, getEntriesForParks, getParkAvailabilityCounts, getParkDigest } from "@campbrain/db";
import { toMapPark, buildParkAvailability, filterDigest } from "@campbrain/core";
import type { SiteClassEntry } from "@campbrain/core";

export const mapRouter = router({
  catalog: publicProcedure.query(async ({ ctx }) => {
    const parks = await getCatalogParks(ctx.db);
    return { parks: parks.map(toMapPark) };
  }),

  availability: publicProcedure.input(MapAvailabilityInputSchema).query(async ({ ctx, input }) => {
    const filters = { from: input.from, to: input.to, access: input.access, kinds: input.kinds, hide: input.hide };

    const row = await getParkDigest(ctx.db, input.provider ?? "california-parks", input.parkPageId);
    if (row) {
      // site_class is stored as an untyped JSONB map (SiteClassMap); it is produced
      // by buildSiteClassMap in the scanner digest phase, which matches SiteClassEntry.
      // A structurally malformed digest row would make filterDigest throw — fall
      // through to live compute rather than 500.
      try {
        return filterDigest(row.digest, row.siteClass as Record<string, SiteClassEntry>, filters);
      } catch (err) {
        console.error(`malformed park digest for ${input.parkPageId}, falling back to live compute`, err);
      }
    }

    const entries = await getEntriesForParks(ctx.db, [input.parkPageId], input.provider);
    return buildParkAvailability(entries, filters, input.parkPageId);
  }),

  summary: publicProcedure.input(MapSummaryInputSchema).query(async ({ ctx, input }) => {
    const parks = await getParkAvailabilityCounts(ctx.db, input);
    return { parks };
  }),
});
