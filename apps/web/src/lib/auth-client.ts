import { createAuthClient } from "better-auth/react";
import { apiUrl } from "./env";

export const authClient = createAuthClient({ baseURL: apiUrl, basePath: "/api/auth" });

const devStubUserId = import.meta.env.VITE_DEV_STUB_SESSION as string | undefined;

// Dev-only: when VITE_DEV_STUB_SESSION is set (local .env.local only), short-circuit
// useSession to a stub so gated UI is verifiable without Google OAuth. Stripped from prod
// builds (env.ts throws if prod config is incomplete; the var is never set in CI/prod).
export const useSession = devStubUserId
  ? () => ({ data: { user: { id: devStubUserId } }, isPending: false } as const)
  : authClient.useSession;

export const { signIn, signOut } = authClient;
