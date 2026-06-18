import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { accessAllowlist } from "@campbrain/db";
import { isAllowlisted } from "../src/allowlist";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: vi.fn(actual.eq) };
});

function fakeDb(emails: string[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(emails.map((email) => ({ email }))),
      }),
    }),
  } as unknown as Parameters<typeof isAllowlisted>[0];
}

describe("isAllowlisted", () => {
  it("returns true when a matching row exists", async () => {
    expect(await isAllowlisted(fakeDb(["a@b.com"]), "a@b.com")).toBe(true);
  });

  it("returns false when no row matches", async () => {
    expect(await isAllowlisted(fakeDb([]), "x@y.com")).toBe(false);
  });

  it("normalizes the email (trim + lowercase) before querying", async () => {
    await isAllowlisted(fakeDb([]), "  A@B.com  ");
    expect(eq).toHaveBeenCalledWith(accessAllowlist.email, "a@b.com");
  });
});
