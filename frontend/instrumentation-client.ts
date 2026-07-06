// Next.js client instrumentation — initializes Sentry in the browser.
// No-op unless NEXT_PUBLIC_SENTRY_DSN is set (see instrumentation.ts).
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: 0,
    // Session replay is intentionally off — fintech surfaces show PII/financial
    // data; do not enable without a masking review.
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
