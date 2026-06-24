import { router, publicProcedure } from "./trpc";
import { mapRouter } from "./routers/map";
import { searchRouter } from "./routers/search";
import { savedSearchesRouter } from "./routers/saved-searches";
import { dashboardRouter } from "./routers/dashboard";
import { targetsRouter } from "./routers/targets";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  map: mapRouter,
  search: searchRouter,
  savedSearches: savedSearchesRouter,
  dashboard: dashboardRouter,
  targets: targetsRouter,
});

export type AppRouter = typeof appRouter;
