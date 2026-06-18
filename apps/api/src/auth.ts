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
      // Web (Pages) and API (Worker) are different origins in staging → the session
      // cookie must be SameSite=None; Secure to survive the cross-site round-trip.
      defaultCookieAttributes: { sameSite: "none", secure: true },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
