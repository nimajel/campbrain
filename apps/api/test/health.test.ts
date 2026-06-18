import { describe, it, expect } from "vitest";
import app from "../src/index";

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health", undefined, { WEB_ORIGIN: "http://localhost:5173" } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
