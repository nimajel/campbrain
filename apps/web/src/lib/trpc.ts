import { createApiClient } from "@campbrain/api-client";
import { apiUrl } from "./env";

export const api = createApiClient(apiUrl);
