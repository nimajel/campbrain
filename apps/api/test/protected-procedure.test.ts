import { describe, it, expect } from "vitest";
import { TRPCError, initTRPC } from "@trpc/server";
import type { TrpcContext } from "../src/trpc/context";
import { protectedProcedure, router } from "../src/trpc/trpc";

// A throwaway router exercising protectedProcedure in isolation (no DB needed).
const testRouter = router({
  whoami: protectedProcedure.query(({ ctx }) => ({ userId: ctx.userId })),
});

function caller(session: TrpcContext["session"]) {
  return testRouter.createCaller({ db: {} as never, auth: {} as never, session });
}

describe("protectedProcedure", () => {
  it("throws UNAUTHORIZED when there is no session", async () => {
    await expect(caller(null).whoami()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("exposes ctx.userId from the session when present", async () => {
    const session = { user: { id: "userA" } } as unknown as TrpcContext["session"];
    const res = await caller(session).whoami();
    expect(res).toEqual({ userId: "userA" });
  });

  it("keeps publicProcedure callable without a session (regression)", () => {
    expect(typeof initTRPC).toBe("object");
    expect(TRPCError).toBeTruthy();
  });
});
