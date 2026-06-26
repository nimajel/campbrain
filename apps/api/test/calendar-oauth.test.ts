import { describe, it, expect } from "vitest";
import { buildConsentUrl, exchangeCode, signState, verifyState } from "../src/calendar-oauth";

describe("buildConsentUrl", () => {
  it("includes required OAuth params", () => {
    const url = buildConsentUrl({
      clientId: "client123",
      redirectUri: "https://example.com/callback",
      state: "somestate",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("client123");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.com/callback");
    expect(parsed.searchParams.get("state")).toBe("somestate");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("scope")).toContain("calendar.events");
  });

  it("targets the Google authorization endpoint", () => {
    const url = buildConsentUrl({ clientId: "id", redirectUri: "https://r.example.com/cb", state: "s" });
    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth")).toBe(true);
  });
});

describe("exchangeCode", () => {
  it("parses a successful token response", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: "acc_tok",
          refresh_token: "ref_tok",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar.events",
        }),
        { status: 200 },
      );

    const result = await exchangeCode(
      {
        clientId: "cid",
        clientSecret: "csec",
        code: "authcode",
        redirectUri: "https://example.com/callback",
      },
      mockFetch,
    );

    expect(result.accessToken).toBe("acc_tok");
    expect(result.refreshToken).toBe("ref_tok");
    expect(result.expiresIn).toBe(3600);
    expect(result.scope).toBe("https://www.googleapis.com/auth/calendar.events");
  });

  it("returns null refreshToken when not present in response", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({ access_token: "acc", expires_in: 3600 }),
        { status: 200 },
      );

    const result = await exchangeCode(
      { clientId: "cid", clientSecret: "csec", code: "code", redirectUri: "https://r.example.com/cb" },
      mockFetch,
    );

    expect(result.refreshToken).toBeNull();
    expect(result.scope).toBeNull();
  });

  it("throws on non-ok response", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response("Bad Request", { status: 400 });

    await expect(
      exchangeCode(
        { clientId: "cid", clientSecret: "csec", code: "bad", redirectUri: "https://r.example.com/cb" },
        mockFetch,
      ),
    ).rejects.toThrow("token exchange failed: 400 Bad Request");
  });
});

describe("signState / verifyState", () => {
  const SECRET = "test-secret-key-at-least-32-bytes!!";

  it("round-trips: verifyState returns the original userId", async () => {
    const userId = "user-abc-123";
    const state = await signState(userId, SECRET);
    const recovered = await verifyState(state, SECRET);
    expect(recovered).toBe(userId);
  });

  it("returns null for tampered payload (different userId in the token)", async () => {
    const state = await signState("user-original", SECRET);
    // Replace the userId portion with a different base64url-encoded value
    const dot = state.indexOf(".");
    const tamperedUserId = btoa("user-evil").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const tampered = `${tamperedUserId}${state.slice(dot)}`;
    expect(await verifyState(tampered, SECRET)).toBeNull();
  });

  it("returns null when the signature portion is tampered", async () => {
    const state = await signState("user-abc", SECRET);
    const dot = state.indexOf(".");
    const tamperedSig = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const tampered = `${state.slice(0, dot + 1)}${tamperedSig}`;
    expect(await verifyState(tampered, SECRET)).toBeNull();
  });

  it("returns null when signed with a different secret", async () => {
    const state = await signState("user-abc", "secret-one-abcdefghijklmnopqrstuvwx");
    expect(await verifyState(state, "secret-two-abcdefghijklmnopqrstuvwx")).toBeNull();
  });

  it("returns null for garbage input", async () => {
    expect(await verifyState("", SECRET)).toBeNull();
    expect(await verifyState("nodothere", SECRET)).toBeNull();
    expect(await verifyState("!!!.***", SECRET)).toBeNull();
  });
});
