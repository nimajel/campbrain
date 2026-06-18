import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@campbrain/api/src/trpc/router";

export type { AppRouter };

export type ApiClient = ReturnType<typeof createTRPCClient<AppRouter>>;

export function createApiClient(apiUrl: string): ApiClient {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${apiUrl}/trpc`, fetch: (u, o) => fetch(u, { ...o, credentials: "include" }) })],
  });
}
