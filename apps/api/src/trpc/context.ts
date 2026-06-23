import type { Db } from "@campbrain/db";
import type { Auth } from "../auth";

export type TrpcContext = {
  db: Db;
  auth: Auth;
  session: Awaited<ReturnType<Auth["api"]["getSession"]>> | null;
  [key: string]: unknown;
};

export async function createContext(opts: {
  db: Db;
  auth: Auth;
  headers: Headers;
}): Promise<TrpcContext> {
  // SECURITY: dev-only auth bypass. ALLOW_DEV_SESSION must NEVER be set in production
  // (not in wrangler.toml [vars], never via `wrangler secret put`) — it disables real auth.
  // It is set only by the local throwaway dev server / vitest; process.env is unset on the
  // deployed Worker, so this path is dead in prod.
  const devUser = process.env["ALLOW_DEV_SESSION"] === "true" ? opts.headers.get("x-dev-user") : null;
  const session = devUser
    ? ({ user: { id: devUser } } as Awaited<ReturnType<Auth["api"]["getSession"]>>)
    : await opts.auth.api.getSession({ headers: opts.headers });
  return { db: opts.db, auth: opts.auth, session };
}
