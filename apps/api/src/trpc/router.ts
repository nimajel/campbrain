import { router, publicProcedure } from "./trpc";
import { mapRouter } from "./routers/map";
import { searchRouter } from "./routers/search";
// TODO(Task 4): import { savedSearchesRouter } from "./routers/saved-searches";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  map: mapRouter,
  search: searchRouter, // → api.search.query(input)
  // TODO(Task 4): savedSearches: savedSearchesRouter,
});

export type AppRouter = typeof appRouter;
