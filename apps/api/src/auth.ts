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
  // The SPA and this API are served from the SAME origin (the Worker serves the
  // built SPA via [assets]), so cookies are first-party: SameSite=Lax is correct
  // and is sent on the top-level OAuth callback redirect, while avoiding the
  // third-party-cookie blocking that SameSite=None triggers in Chrome/Safari.
  // Secure is required over https (prod) but must be off over http://localhost (dev).
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
        sameSite: "lax",
        secure: secureCookies,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
