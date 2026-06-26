import { router, protectedProcedure } from "../trpc";
import { getConnectionStatus, deleteConnection } from "@campbrain/db";

export const calendarRouter = router({
  status: protectedProcedure.query(({ ctx }) =>
    getConnectionStatus(ctx.db, ctx.userId),
  ),

  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await deleteConnection(ctx.db, ctx.userId);
    return { connected: false as const };
  }),
});
