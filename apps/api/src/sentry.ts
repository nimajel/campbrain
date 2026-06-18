import * as Sentry from "@sentry/cloudflare";

export function sentryOptions(env: { SENTRY_DSN?: string }) {
  return { dsn: env.SENTRY_DSN, tracesSampleRate: 0.1 };
}
export { Sentry };
