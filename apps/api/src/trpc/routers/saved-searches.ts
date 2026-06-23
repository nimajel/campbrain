import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { SavedSearchInputSchema } from "@campbrain/types";
import {
  listSavedSearches, createSavedSearch,
  updateSavedSearch, deleteSavedSearch, setAlertEnabled,
} from "@campbrain/db";

const idInput = z.object({ id: z.string() });

export const savedSearchesRouter = router({
  list: protectedProcedure.query(({ ctx }) => listSavedSearches(ctx.db, ctx.userId)),

  create: protectedProcedure
    .input(SavedSearchInputSchema)
    .mutation(({ ctx, input }) => createSavedSearch(ctx.db, ctx.userId, input)),

  update: protectedProcedure
    .input(z.object({ id: z.string(), patch: SavedSearchInputSchema.partial() }))
    .mutation(({ ctx, input }) => updateSavedSearch(ctx.db, input.id, ctx.userId, input.patch)),

  delete: protectedProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      await deleteSavedSearch(ctx.db, input.id, ctx.userId);
      return { id: input.id };
    }),

  toggleAlert: protectedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await setAlertEnabled(ctx.db, input.id, ctx.userId, input.enabled);
      return { id: input.id, alertEnabled: input.enabled };
    }),
});
