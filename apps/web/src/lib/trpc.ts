import { createApiClient } from "@campbrain/api-client";
import { apiUrl } from "./env";

const devUser = import.meta.env.VITE_DEV_STUB_SESSION as string | undefined;
export const api = createApiClient(apiUrl, devUser ? { "x-dev-user": devUser } : undefined);
