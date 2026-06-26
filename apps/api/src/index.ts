import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { createDb, closeDb, type Db, upsertConnection } from "@campbrain/db";
import { createAuth, type Auth } from "./auth";
import { appRouter } from "./trpc/router";
import { createContext } from "./trpc/context";
import { buildConsentUrl, exchangeCode, signState, verifyState } from "./calendar-oauth";

type Bindings = {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  WEB_ORIGIN: string;
  SENTRY_DSN?: string;
  ASSETS: Fetcher;
};

type Variables = { db: Db; auth: Auth };

type Env = { Bindings: Bindings; Variables: Variables };

const app = new Hono<Env>();

app.use("*", (c, next) =>
  cors({ origin: c.env.WEB_ORIGIN, credentials: true })(c, next));

app.get("/health", (c) => c.json({ ok: true }));

// Build a per-request db + auth, share them across the API routes, and close the
// Neon WebSocket pool after the response so connections are not leaked under load.
async function withDbAuth(c: Context<Env>, next: Next) {
  const db = createDb(c.env.DATABASE_URL);
  c.set("db", db);
  c.set("auth", createAuth(db, c.env));
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(closeDb(db));
  }
}

app.use("/api/auth/*", withDbAuth);
app.use("/api/calendar/*", withDbAuth);
app.use("/trpc/*", withDbAuth);

app.on(["GET", "POST"], "/api/auth/*", (c) => c.get("auth").handler(c.req.raw));

app.use("/trpc/*", (c, next) =>
  trpcServer({
    router: appRouter,
    createContext: (opts) =>
      createContext({ db: c.get("db"), auth: c.get("auth"), headers: opts.req.headers }),
  })(c, next));

// Google Calendar OAuth — connect initiates the consent flow; callback exchanges the
// code for tokens and stores the connection. Both routes require an active session
// (handled by withDbAuth above). The CSRF state binds the consent to the userId via
// HMAC-SHA256 so a third party cannot forge a callback for a different user.
app.get("/api/calendar/connect", async (c) => {
  const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.redirect("/");
  const redirectUri = `${c.env.BETTER_AUTH_URL}/api/calendar/callback`;
  const state = await signState(session.user.id, c.env.BETTER_AUTH_SECRET);
  return c.redirect(buildConsentUrl({ clientId: c.env.GOOGLE_CLIENT_ID, redirectUri, state }));
});

app.get("/api/calendar/callback", async (c) => {
  const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!session || !code || !state) return c.redirect("/alerts?calendar=error");

  // CSRF guard: the state must decode to the same userId as the current session.
  const stateUserId = await verifyState(state, c.env.BETTER_AUTH_SECRET);
  if (stateUserId !== session.user.id) return c.redirect("/alerts?calendar=error");

  try {
    const redirectUri = `${c.env.BETTER_AUTH_URL}/api/calendar/callback`;
    const tok = await exchangeCode({
      clientId: c.env.GOOGLE_CLIENT_ID,
      clientSecret: c.env.GOOGLE_CLIENT_SECRET,
      code,
      redirectUri,
    });
    // A missing refresh token means the user denied offline access or already had a
    // live grant. Redirect to error so they can reconnect with prompt=consent.
    if (!tok.refreshToken) return c.redirect("/alerts?calendar=error");
    await upsertConnection(c.get("db"), session.user.id, {
      accessToken: tok.accessToken,
      refreshToken: tok.refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + tok.expiresIn * 1000).toISOString(),
      scope: tok.scope,
    });
    return c.redirect("/alerts?calendar=connected");
  } catch (e) {
    console.error("calendar callback failed", e);
    return c.redirect("/alerts?calendar=error");
  }
});

// Everything else: serve the built SPA from the ASSETS binding. With
// not_found_handling = "single-page-application", unknown paths return index.html
// so client-side routing works.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
