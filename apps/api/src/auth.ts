import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { user, session, account, verification, type Db } from "@campbrain/db";

export function createAuth(db: Db, env: {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  WEB_ORIGIN: string;
}) {
  // Staging/prod: web (Pages) and API (Worker) are different origins, so the session
  // cookie must be SameSite=None; Secure. Over http://localhost (wrangler dev) browsers
  // reject Secure cookies, so fall back to a same-origin-friendly Lax cookie there.
  const secureCookies = env.BETTER_AUTH_URL.startsWith("https://");
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_ORIGIN],
    socialProviders: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: secureCookies ? "none" : "lax",
        secure: secureCookies,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
