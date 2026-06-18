import { Hono } from "hono";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { createDb } from "@campbrain/db";
import { createAuth } from "./auth";
import { appRouter } from "./trpc/router";
import { createContext } from "./trpc/context";

type Bindings = {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  WEB_ORIGIN: string;
  SENTRY_DSN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", (c, next) =>
  cors({ origin: c.env.WEB_ORIGIN, credentials: true })(c, next));

app.get("/health", (c) => c.json({ ok: true }));

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const auth = createAuth(db, c.env);
  return auth.handler(c.req.raw);
});

app.use("/trpc/*", async (c, next) => {
  const db = createDb(c.env.DATABASE_URL);
  const auth = createAuth(db, c.env);
  return trpcServer({
    router: appRouter,
    createContext: (opts) =>
      createContext({ db, auth, headers: opts.req.headers }),
  })(c, next);
});

export default app;
