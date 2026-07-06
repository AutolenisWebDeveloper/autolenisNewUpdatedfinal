// Next.js server instrumentation — initializes Sentry for the Node.js and Edge
// runtimes. Activation is env-driven: with no SENTRY_DSN set, Sentry.init is a
// no-op and the app behaves exactly as before, so preview/CI environments
// without the secret are unaffected.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // Error monitoring is the launch blocker; keep performance sampling
    // conservative so quota is spent on exceptions, not traces.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05),
    // Payment/webhook paths log through lib/logger, which forwards error-level
    // entries to Sentry (see lib/logger.ts) — no per-route wiring needed.
  });
}

// Captures errors from React Server Components, route handlers, and middleware.
export const onRequestError = Sentry.captureRequestError;
