import { createApiClient } from "@campbrain/api-client";

export const api = createApiClient(import.meta.env.VITE_API_URL);
