import { initTRPC, TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create();

const requireSession = t.middleware(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  // Narrows: downstream handlers see ctx.userId as a non-null string.
  return next({ ctx: { userId: ctx.session.user.id } });
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(requireSession);
// Future tiers compose WITHOUT touching existing handlers, e.g.:
//   export const allowlistedProcedure = protectedProcedure.use(requireAllowlistRecheck);
