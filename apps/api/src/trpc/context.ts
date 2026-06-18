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
  const session = await opts.auth.api.getSession({ headers: opts.headers });
  return { db: opts.db, auth: opts.auth, session };
}
