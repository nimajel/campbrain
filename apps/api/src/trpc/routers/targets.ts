import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { TargetInputSchema, type UpcomingTarget } from "@campbrain/types";
import { listTargets, createTarget, updateTarget, deleteTarget, setTargetEnabled } from "@campbrain/db";
import { computeBookingWindows } from "@campbrain/core";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function scopeLabel(scope: { parkName: string | null; campgroundName: string | null }): string {
  return [scope.parkName, scope.campgroundName].filter(Boolean).join(" — ") || "Any park";
}

export const targetsRouter = router({
  list: protectedProcedure.query(({ ctx }) => listTargets(ctx.db, ctx.userId)),

  create: protectedProcedure
    .input(TargetInputSchema)
    .mutation(({ ctx, input }) => createTarget(ctx.db, ctx.userId, input)),

  update: protectedProcedure
    .input(z.object({ id: z.string(), patch: TargetInputSchema.partial() }))
    .mutation(({ ctx, input }) => updateTarget(ctx.db, input.id, ctx.userId, input.patch)),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await deleteTarget(ctx.db, input.id, ctx.userId);
      return { id: input.id };
    }),

  setEnabled: protectedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await setTargetEnabled(ctx.db, input.id, ctx.userId, input.enabled);
      return { id: input.id, enabled: input.enabled };
    }),

  upcoming: protectedProcedure.query(async ({ ctx }) => {
    const today = todayUtc();
    const nowMs = Date.now();
    const targets = await listTargets(ctx.db, ctx.userId);
    const out: UpcomingTarget[] = [];
    for (const t of targets) {
      if (!t.enabled) continue;
      const windows = computeBookingWindows(t.datePattern, t.bookingRule, today)
        .filter((w) => new Date(w.bookingOpensAt).getTime() > nowMs)
        .sort((a, b) => a.bookingOpensAt.localeCompare(b.bookingOpensAt));
      if (windows.length > 0) {
        out.push({ targetId: t.id, name: t.name, scopeLabel: scopeLabel(t.scope), windows });
      }
    }
    out.sort((a, b) => (a.windows[0]!.bookingOpensAt).localeCompare(b.windows[0]!.bookingOpensAt));
    return out;
  }),
});
