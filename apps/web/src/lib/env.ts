const fallback = "http://localhost:8787";

export const apiUrl: string =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD
    ? (() => {
        throw new Error("VITE_API_URL must be set for production builds");
      })()
    : fallback);
