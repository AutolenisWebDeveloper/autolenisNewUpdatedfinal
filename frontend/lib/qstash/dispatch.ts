import { logger } from "@/lib/logger";
import { getQstash, QSTASH_BASE_URL } from "./client";
import { recordLegacyPathWrite } from "@/lib/services/comms/legacy-path-write";

interface DispatchOptions {
  path: string;
  body: Record<string, unknown>;
  delaySeconds?: number;
  retries?: number;
}

// Fire-and-forget job dispatch. Failures are logged but never thrown so a
// dispatch problem can't break the platform action that triggered it.
export async function dispatch({
  path,
  body,
  delaySeconds = 0,
  retries = 3,
}: DispatchOptions): Promise<void> {
  // PHASE 2: THE VENDOR IS DEAD AND THIS PATH IS COUNTED, NOT DELETED. The
  // repository's own history declares QStash removed, yet the dependency, this
  // module and 16 `app/api/jobs/*` consumers are still in the tree — so every
  // producer that still reaches here dispatches into nothing and terminalises in
  // `jobs_dead_letter` as "TERMINAL — no internal owner". §8.4 keeps the code
  // until Phase 10 and requires the uses be COUNTED meanwhile; §13-D23 confirms
  // the decommission. Every call writes a LEGACY_PATH_WRITE row naming its
  // caller, so "has anything still gone through the dead vendor?" is a query
  // rather than an inspection.
  void recordLegacyPathWrite({
    kind: "QSTASH_PRODUCER",
    detail: path,
    entityType: "QStashJob",
    entityId: path,
    removalPhase: 10,
  });
  try {
    await getQstash().publishJSON({
      url: `${QSTASH_BASE_URL}${path}`,
      body,
      delay: delaySeconds,
      retries,
    });
  } catch (err) {
    logger.error(`QStash dispatch failed for ${path}:`, err);
    // F-035 — capture the failed enqueue in the dead-letter queue so the
    // automated drainer (cron/dlq-drain) can re-publish it, instead of the job
    // vanishing silently. Best-effort: never throw from fire-and-forget dispatch.
    try {
      const { getServiceSupabase } = await import("@/lib/supabase-service");
      await getServiceSupabase().from("jobs_dead_letter").insert({
        job_id: `qstash:${path}:${Date.now()}`,
        event_name: `qstash:${path}`,
        payload: { path, body, delaySeconds, retries },
        error_message: err instanceof Error ? err.message : String(err),
      });
    } catch (dlqErr) {
      logger.error(`QStash dispatch DLQ capture failed for ${path}:`, dlqErr);
    }
  }
}
