// Transport-agnostic job idempotency + dead-letter primitives.
//
// These are DB-backed (Supabase, service role) and have NO dependency on Inngest,
// QStash, or any other runtime — they read/write the existing `idempotency_keys`
// and `jobs_dead_letter` tables (migrations/01). They were previously defined in
// `lib/inngest/idempotency.ts`; they now live here so an internal Vercel-Cron /
// Postgres execution path (e.g. buyer-intake) can reuse them without importing
// anything under `lib/inngest`. `lib/inngest/idempotency.ts` re-exports them so
// every existing caller keeps working unchanged.
//
// No forked idempotency table, no second dead-letter table, no new runtime.

import crypto from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// Insert a `processing` row keyed on the sha256 of the identity. Returns false if
// another worker already owns the key (23505 unique_violation), so a
// retried/duplicate job converges instead of double-executing.
export async function acquireIdempotencyGuard(
  supabase: SupabaseClient,
  key: string,
): Promise<boolean> {
  const hash = hashKey(key);
  const { error } = await supabase
    .from("idempotency_keys")
    .insert({ key_hash: hash, execution_status: "processing" });
  if (error && (error as { code?: string }).code === "23505") return false;
  if (error) throw error;
  return true;
}

// Crash-safe claim for a poll/cron-driven executor.
//
// Unlike acquireIdempotencyGuard, this reclaims a stranded claim so a run killed
// mid-flight (Vercel maxDuration kill, deployment restart, process crash) can be
// re-driven by a later tick instead of blocking the identity forever. The caller
// is responsible for a durable completion marker (e.g. a stamped column) checked
// BEFORE claiming — this guard only serializes concurrent execution.
//
// Rules on a key_hash collision:
//   • existing 'processing' newer than staleMs  -> a live run holds it -> BLOCKED.
//   • existing 'processing' older than staleMs   -> the holder died     -> reclaim.
//   • existing 'failed'                          -> a prior run failed  -> reclaim.
//   • existing 'completed'                       -> a prior run finished -> BLOCKED
//        (the durable completion marker is the source of truth; a completed guard
//        for a not-yet-complete identity cannot occur because callers stamp the
//        marker before marking the guard completed).
//
// Reclaim is a compare-and-set on created_at so two concurrent reclaimers cannot
// both win. Returns true iff THIS caller now owns the claim.
export async function claimJob(
  supabase: SupabaseClient,
  key: string,
  opts: { staleMs: number },
): Promise<boolean> {
  const hash = hashKey(key);

  // Fast path — a fresh claim.
  const { error: insertErr } = await supabase
    .from("idempotency_keys")
    .insert({ key_hash: hash, execution_status: "processing" });
  if (!insertErr) return true;
  if ((insertErr as { code?: string }).code !== "23505") throw insertErr;

  // Collision — inspect the incumbent row to decide whether it is reclaimable.
  const { data: row, error: selErr } = await supabase
    .from("idempotency_keys")
    .select("execution_status, created_at")
    .eq("key_hash", hash)
    .single();
  if (selErr || !row) return false; // vanished/unreadable — let a later tick retry

  const status = (row as { execution_status: string }).execution_status;
  const createdAtRaw = (row as { created_at: string }).created_at;

  if (status === "completed") return false; // authoritatively done

  if (status === "processing") {
    const ageMs = Date.now() - new Date(createdAtRaw).getTime();
    if (ageMs < opts.staleMs) return false; // a live run still holds it
  }
  // status === 'failed' OR a stale 'processing' -> reclaim via CAS on created_at.
  const { data: reclaimed, error: updErr } = await supabase
    .from("idempotency_keys")
    .update({ execution_status: "processing", created_at: new Date().toISOString() })
    .eq("key_hash", hash)
    .eq("created_at", createdAtRaw)
    .select("key_hash");
  if (updErr) return false;
  return Array.isArray(reclaimed) && reclaimed.length > 0;
}

export async function updateIdempotencyState(
  supabase: SupabaseClient,
  key: string,
  status: "completed" | "failed",
  payload: Record<string, unknown> = {},
): Promise<void> {
  const hash = hashKey(key);
  await supabase
    .from("idempotency_keys")
    .update({ execution_status: status, response_payload: payload })
    .eq("key_hash", hash);
}

// Release a guard so the identity can be retried cleanly.
export async function releaseIdempotencyGuard(
  supabase: SupabaseClient,
  key: string,
): Promise<void> {
  const hash = hashKey(key);
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
