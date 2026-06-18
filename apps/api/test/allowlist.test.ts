import { describe, it, expect, vi } from "vitest";
import { isAllowlisted } from "../src/allowlist";

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
  it("returns true for a listed email (case-insensitive)", async () => {
    expect(await isAllowlisted(fakeDb(["a@b.com"]), "A@B.com")).toBe(true);
  });
  it("returns false when not listed", async () => {
    expect(await isAllowlisted(fakeDb([]), "x@y.com")).toBe(false);
  });
});
