import { describe, it, expect } from "vitest";
import { parseServerEnv } from "../src/env";

describe("parseServerEnv", () => {
  it("parses a complete env", () => {
    const env = parseServerEnv({
      DATABASE_URL: "postgres://u:p@host/db",
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://api.example.com",
      WEB_ORIGIN: "https://app.example.com",
      GOOGLE_CLIENT_ID: "gid",
      GOOGLE_CLIENT_SECRET: "gsecret",
    });
    expect(env.DATABASE_URL).toContain("postgres://");
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => parseServerEnv({ BETTER_AUTH_SECRET: "x".repeat(32) })).toThrow();
  });
});
