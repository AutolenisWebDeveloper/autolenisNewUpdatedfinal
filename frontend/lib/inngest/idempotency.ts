// Shared Inngest idempotency + dead-letter helpers.
//
// These are the SAME primitives the messaging workers use inline in
// lib/inngest/functions.ts (acquireIdempotencyGuard / updateIdempotencyState /
// moveJobToDeadLetter / isFinalAttempt). They are extracted here so the NEW
// content Inngest functions can reuse them without touching the existing
// messaging functions (which are inside the DO-NOT-MODIFY perimeter).
//
// They read/write the existing `idempotency_keys` and `jobs_dead_letter` tables
// from migrations/01 — no forked idempotency table, no second dead-letter table.

import crypto from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// Insert a `processing` row keyed on the sha256 of the content identity. Returns
// false if another worker already owns the key (23505 unique_violation), so a
// retried/duplicate job converges instead of producing a duplicate article.
export async function acquireIdempotencyGuard(
  supabase: SupabaseClient,
  key: string,
): Promise<boolean> {
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const { error } = await supabase
    .from("idempotency_keys")
    .insert({ key_hash: hash, execution_status: "processing" });
  if (error && (error as { code?: string }).code === "23505") return false;
  if (error) throw error;
  return true;
}

export async function updateIdempotencyState(
  supabase: SupabaseClient,
  key: string,
  status: "completed" | "failed",
  payload: Record<string, unknown> = {},
): Promise<void> {
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  await supabase
    .from("idempotency_keys")
    .update({ execution_status: status, response_payload: payload })
    .eq("key_hash", hash);
}

// Release a guard so the identity can be retried cleanly (e.g. when a job item
// is explicitly retried by an admin after a non-final failure).
export async function releaseIdempotencyGuard(
  supabase: SupabaseClient,
  key: string,
): Promise<void> {
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  await supabase.from("idempotency_keys").delete().eq("key_hash", hash);
}

export async function moveJobToDeadLetter(
  supabase: SupabaseClient,
  jobId: string,
  eventName: string,
  payload: unknown,
  errorMessage: string,
): Promise<void> {
  await supabase.from("jobs_dead_letter").insert({
    job_id: jobId,
    event_name: eventName,
    payload: payload as Record<string, unknown>,
    error_message: errorMessage,
  });
}

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
