import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { user, session, account, verification, type Db } from "@campbrain/db";
import { isAllowlisted } from "./allowlist";

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
    databaseHooks: {
      session: {
        create: {
          before: async (newSession) => {
            const rows = await db.select().from(user).where(eq(user.id, newSession.userId));
            const email = rows[0]?.email;
            // Returning false cancels session creation (BetterAuth contract) → no session cookie is
            // set, and onAPIError.errorURL bounces the user to /request-access. Fail-closed by design:
            // a thrown DB error here also aborts the session, which is the safe default for an invite-only app.
            if (!email || !(await isAllowlisted(db, email))) {
              return false;
            }
            return;
          },
        },
      },
    },
    onAPIError: { errorURL: "/request-access" },
  });
}

export type Auth = ReturnType<typeof createAuth>;
