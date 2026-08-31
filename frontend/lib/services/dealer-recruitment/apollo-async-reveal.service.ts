// Phase 1.6 — async reveal polling with distinct persisted terminal states.
//
// Apollo can answer a reveal asynchronously: the call returns a request_id and
// the answer arrives later. Four non-ready outcomes are genuinely different and
// are deliberately NOT collapsed:
//
//   pending          the answer may still arrive; the request is not dead
//   expired          Apollo discarded the request; a NEW one is needed
//   unknown_request  Apollo has no record of this id; retrying it is futile
//   failed           transport or server error, with the cause recorded
//
// Collapsing them into a generic failure produces a queue nobody can drain: an
// operator reading "failed" cannot tell whether to wait, re-request, or
// investigate. A credit may already have been spent on any of them, so keeping
// them distinct is also what makes spend auditable after the fact.
//
// Polling is bounded by MAX_REVEAL_POLLS. An unbounded poll against a paid API
// is never acceptable, and a request still pending at the ceiling is persisted
// as PENDING_REVEAL — resumable by a later drain, not lost.

import { logger } from "@/lib/logger";

/**
 * Poll ceiling per drain. Low deliberately: a reveal that has not resolved after
 * a few short waits is better parked as PENDING_REVEAL for a later drain than
 * held open in a request.
 */
export const MAX_REVEAL_POLLS = 5;

/** Backoff between polls, in ms. Injected in tests so the suite does not sleep. */
export const REVEAL_POLL_BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;

export type RevealPollOutcome =
  | { kind: "ready"; email: string | null; phone: string | null; dncStatus: string | null; phoneType: string | null }
  | { kind: "pending" }
  | { kind: "expired" }
  | { kind: "unknown_request" }
  | { kind: "failed"; error: string };

/**
 * The candidate status each outcome maps to. One entry per outcome, declared
 * once, so a future edit cannot quietly merge two of them.
 */
export const OUTCOME_STATUS = {
  expired: "EXPIRED",
  unknown_request: "UNKNOWN_REQUEST",
  failed: "FAILED",
  pending: "PENDING_REVEAL",
} as const;

export interface DrainRevealInput {
  candidateId: string;
  apolloPersonId: string;
  rooftopId: string | null;
  revealRequestId: string;
}

export interface DrainRevealResult {
  /** False only for `pending` — the one outcome where the answer may still come. */
  terminal: boolean;
  status: string;
  pollCount: number;
}

export interface DrainRevealDeps {
  now: Date;
  poll: (revealRequestId: string) => Promise<RevealPollOutcome>;
  sleep: (ms: number) => Promise<void>;
  updateCandidate: (id: string, data: Record<string, unknown>) => Promise<void>;
  persistContact: (contact: {
    rooftopId: string;
    apolloPersonId: string;
    email: string | null;
    phone: string | null;
    dncStatus: string | null;
    dncCheckedAt: Date | null;
    phoneType: string | null;
    apolloLastSyncedAt: Date;
  }) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll one async reveal to a terminal state, or to the poll ceiling.
 *
 * Never throws: a poll that errors is itself a recorded terminal FAILED, because
 * an exception escaping here would leave the candidate in whatever state it was
 * already in with no record of why.
 */
export async function drainReveal(
  input: DrainRevealInput,
  deps?: Partial<DrainRevealDeps>,
): Promise<DrainRevealResult> {
  const now = deps?.now ?? new Date();
  const sleep = deps?.sleep ?? defaultSleep;
  const poll = deps?.poll;
  const updateCandidate = deps?.updateCandidate ?? (async () => {});
  const persistContact = deps?.persistContact ?? (async () => {});

  if (!poll) {
    await updateCandidate(input.candidateId, {
      enrichmentStatus: OUTCOME_STATUS.failed,
      enrichmentError: "no poll implementation supplied",
      lastSyncedAt: now,
      revealPollCount: 0,
    });
    return { terminal: true, status: OUTCOME_STATUS.failed, pollCount: 0 };
  }

  let pollCount = 0;

  for (let attempt = 0; attempt < MAX_REVEAL_POLLS; attempt++) {
    let outcome: RevealPollOutcome;
    try {
      outcome = await poll(input.revealRequestId);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      pollCount += 1;
      logger.warn(`[apollo-reveal-poll] ${input.revealRequestId} threw: ${error}`);
      await updateCandidate(input.candidateId, {
        enrichmentStatus: OUTCOME_STATUS.failed,
        enrichmentError: error,
        lastSyncedAt: now,
        revealPollCount: pollCount,
      });
      return { terminal: true, status: OUTCOME_STATUS.failed, pollCount };
    }
    pollCount += 1;

    if (outcome.kind === "pending") {
      // Not terminal. Back off and try again, up to the ceiling.
      if (attempt < MAX_REVEAL_POLLS - 1) {
        await sleep(REVEAL_POLL_BACKOFF_MS[Math.min(attempt, REVEAL_POLL_BACKOFF_MS.length - 1)]);
      }
      continue;
    }

    if (outcome.kind === "ready") {
      const reachable = !!(outcome.email || outcome.phone);
      if (input.rooftopId) {
        await persistContact({
          rooftopId: input.rooftopId,
          apolloPersonId: input.apolloPersonId,
          email: outcome.email,
          phone: outcome.phone,
          // Verbatim. Only "not_found" clears the phone channel; "pending" is
          // NOT a clearance and must never be rewritten into one here.
          dncStatus: outcome.dncStatus,
          dncCheckedAt: outcome.dncStatus ? now : null,
          phoneType: outcome.phoneType,
          apolloLastSyncedAt: now,
        });
      }
      // Apollo answered with nothing usable. Record it; never invent a contact.
      const status = reachable ? "ENRICHED" : "UNREACHABLE";
      await updateCandidate(input.candidateId, {
        enrichmentStatus: status,
        enrichmentError: null,
        lastSyncedAt: now,
        revealPollCount: pollCount,
      });
      return { terminal: true, status, pollCount };
    }

    // expired | unknown_request | failed — each keeps its own status.
    const status = OUTCOME_STATUS[outcome.kind];
    await updateCandidate(input.candidateId, {
      enrichmentStatus: status,
      enrichmentError: outcome.kind === "failed" ? outcome.error : null,
      lastSyncedAt: now,
      revealPollCount: pollCount,
    });
    logger.info(`[apollo-reveal-poll] ${input.revealRequestId} -> ${status}`);
    return { terminal: true, status, pollCount };
  }

  // Still pending at the ceiling. Park it — resumable, not lost.
  await updateCandidate(input.candidateId, {
    enrichmentStatus: OUTCOME_STATUS.pending,
    enrichmentError: null,
    revealPollCount: pollCount,
  });
  logger.info(
    `[apollo-reveal-poll] ${input.revealRequestId} still pending after ${pollCount} poll(s) — parked as PENDING_REVEAL`,
  );
  return { terminal: false, status: OUTCOME_STATUS.pending, pollCount };
}
