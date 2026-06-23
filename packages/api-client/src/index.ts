import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@campbrain/api/src/trpc/router";

export type { AppRouter };

export type ApiClient = ReturnType<typeof createTRPCClient<AppRouter>>;

export function createApiClient(apiUrl: string, headers?: Record<string, string>): ApiClient {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${apiUrl}/trpc`, headers, fetch: (u, o) => fetch(u, { ...o, credentials: "include" }) })],
  });
}
