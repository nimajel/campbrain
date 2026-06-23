import { describe, it, expect } from "vitest";
import { createContext } from "../src/trpc/context";

describe("createContext dev session", () => {
  it("synthesizes a stub session from x-dev-user when ALLOW_DEV_SESSION=true", async () => {
    process.env["ALLOW_DEV_SESSION"] = "true";
    const ctx = await createContext({
      db: {} as never, auth: {} as never,
      headers: new Headers({ "x-dev-user": "local-dev" }),
    });
    expect(ctx.session?.user.id).toBe("local-dev");
    delete process.env["ALLOW_DEV_SESSION"];
  });
  it("ignores x-dev-user when the flag is off (would call auth.getSession)", async () => {
    delete process.env["ALLOW_DEV_SESSION"];
    const auth = { api: { getSession: async () => null } } as never;
    const ctx = await createContext({ db: {} as never, auth, headers: new Headers({ "x-dev-user": "x" }) });
    expect(ctx.session).toBeNull();
  });
});
