import { router, publicProcedure } from "./trpc";
import { mapRouter } from "./routers/map";


export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  map: mapRouter,
});

export type AppRouter = typeof appRouter;
