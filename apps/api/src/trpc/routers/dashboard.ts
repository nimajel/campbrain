import { router, protectedProcedure } from "../trpc";
import { getDashboardStats, getRecentOpenings, latestAlertRun } from "@campbrain/db";

function todayUtc(): string { return new Date().toISOString().slice(0, 10); }

export const dashboardRouter = router({
  stats: protectedProcedure.query(({ ctx }) => getDashboardStats(ctx.db, ctx.userId)),
  recentOpenings: protectedProcedure.query(({ ctx }) => getRecentOpenings(ctx.db, ctx.userId, todayUtc())),
  lastScan: protectedProcedure.query(({ ctx }) => latestAlertRun(ctx.db)),
});
