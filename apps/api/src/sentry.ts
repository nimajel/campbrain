// TODO(observability): wire this into the Worker via Sentry.withSentry() when error
// tracking is turned on. Phase-0 baseline — intentionally not imported anywhere yet.
import * as Sentry from "@sentry/cloudflare";

export function sentryOptions(env: { SENTRY_DSN?: string }) {
  return { dsn: env.SENTRY_DSN, tracesSampleRate: 0.1 };
}
export { Sentry };
