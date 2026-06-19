import { createAuthClient } from "better-auth/react";
import { apiUrl } from "./env";

export const authClient = createAuthClient({
  baseURL: apiUrl,
  basePath: "/api/auth",
});

export const { signIn, signOut, useSession } = authClient;
