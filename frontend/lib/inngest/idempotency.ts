// Inngest-facing idempotency + dead-letter helpers.
//
// The DB-backed primitives (guard acquire/update/release, dead-letter insert) are
// transport-agnostic and now live in `@/lib/jobs/idempotency`. They are re-exported
// here so every existing importer keeps working unchanged, while an internal
// Vercel-Cron / Postgres path can depend on the neutral module directly (no
// `lib/inngest` import). The two pieces that ARE Inngest/content-specific
// (`isFinalAttempt`, `contentIdentityKey`) stay here.
//
// They read/write the existing `idempotency_keys` and `jobs_dead_letter` tables
// from migrations/01 — no forked idempotency table, no second dead-letter table.

export {
  getSupabase,
  hashKey,
  acquireIdempotencyGuard,
  claimJob,
  updateIdempotencyState,
  releaseIdempotencyGuard,
  moveJobToDeadLetter,
} from "@/lib/jobs/idempotency";

// Inngest exposes a ZERO-INDEXED `attempt` (first attempt = 0) and, on v3,
// `maxAttempts` (the total allowed attempts) on the function context. The final
// attempt is therefore `maxAttempts - 1`. We probe a couple of legacy shapes
// defensively, but the primary keys are `attempt` + `maxAttempts`.
export function isFinalAttempt(ctx: Record<string, unknown>): boolean {
  const attempt = (ctx.attempt ?? ctx.currentRetry) as number | undefined;
  if (typeof attempt !== "number") return false;

  const maxAttempts = (ctx.maxAttempts ?? ctx.maxAttempt) as number | undefined;
  if (typeof maxAttempts === "number") {
    // attempt is zero-indexed → the last attempt is maxAttempts - 1.
    return attempt >= maxAttempts - 1;
  }

  // Fallback: a retries-remaining style counter (retries after the first).
  const maxRetries = ctx.maxRetries as number | undefined;
  if (typeof maxRetries === "number") return attempt >= maxRetries;

  return false;
}

// Stable content identity → idempotency key. Keyed on the slug, which is itself
// derived from cluster+city+state+make+model+wave, so a retried generation job
// converges to the one article.
export function contentIdentityKey(slug: string, op: string): string {
  return `content:${op}:${slug}`;
}
