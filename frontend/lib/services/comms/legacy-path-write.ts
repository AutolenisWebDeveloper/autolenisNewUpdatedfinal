// lib/services/comms/legacy-path-write.ts
//
// The LEGACY_PATH_WRITE counter. §8.4:
//
//   "Zero production traffic is verified only by the LEGACY_PATH_WRITE counter on
//    production; preview traffic never counts."
//
// Every legacy path this plan neutralises but does not yet delete — the direct
// Resend/Twilio sends, the QStash producers — writes one `audit_logs` row per use,
// so that "is anything still going through the old path?" is answered by a query
// instead of by reading code. Phase 10 deletes each path when its count has been
// zero for 30 days of production traffic.
//
// WHY IT WRAPS THE CHOKE POINTS, NOT THE 98 CALL SITES. The allowlist holds 98
// files. Editing all of them would be 98 chances to miss one, and a counter with a
// hole in it is worse than no counter — it would report zero while traffic
// continued. Instead the recorder sits at the three points every legacy send
// actually passes through: `sendIdempotent` (all 70 direct email senders), the SMS
// entry points, and the QStash dispatcher. `new Error().stack` recovers the real
// caller, so the row still names the file that used the legacy path rather than the
// choke point it flowed through.
//
// IT IS BEST-EFFORT, DELIBERATELY. This is instrumentation. A failure to record a
// legacy send must never fail the send itself — the whole point of the compatibility
// window is that the old paths keep working while the count is watched. A failure
// to record is logged, and a persistently failing counter shows up as a suspicious
// zero rather than as a silent one, because `legacyPathWriteFailures` is logged at
// error level and the Phase 10 exit criterion is 30 days of clean production
// traffic, not one clean query.
//
// The enum label and the partial index it feeds were added by Phase 1:
// `AdminActionType.LEGACY_PATH_WRITE` (schema.prisma:2165) and
// `audit_logs_legacy_path_write_idx` (migration.sql:1118-1119). Until this file
// they had no writer.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/** Which legacy path a write went through. One value per §8.4 table row. */
export type LegacyPathKind =
  /** Direct Resend/Twilio send in transaction code. §8.4 → removed Phase 10. */
  | "DIRECT_TRANSACTIONAL_SEND"
  /** QStash producer dispatching into the dead vendor. §8.4 → removed Phase 10. */
  | "QSTASH_PRODUCER"
  /**
   * Settlement creating and launching an Auction and inviting dealers, instead of
   * opening a sourcing case. §8.4 row 1 → neutralised Phase 3 (the adapter), retired
   * Phase 5 (the flag flip, §13-D52).
   *
   * Unlike the other two, this counter is EXPECTED to be non-zero while the flag is
   * off — that is the sequencing guard working, not a leak. §8.4's thirty-days-of-zero
   * removal clock starts at the flip.
   */
  | "SETTLEMENT_AUCTION_LAUNCH"
  /**
   * A caller still trying to enrol the $99 series on `lifecycle_touch_schedule` after
   * Phase 3 moved it to `comms_outbox`. The adapter STANDS DOWN and records this
   * instead of enrolling, so a forgotten caller surfaces as a row here rather than as
   * a buyer receiving all six touches twice.
   *
   * EXPECTED TO BE ZERO from the day Phase 3 ships — unlike SETTLEMENT_AUCTION_LAUNCH,
   * there is no flag keeping this path alive. A non-zero count names a caller to fix.
   */
  | "LEGACY_LIFECYCLE_ENROLLMENT";

export interface LegacyPathWriteInput {
  kind: LegacyPathKind;
  /** What was attempted — a template id, a job path. */
  detail: string;
  /** The entity the write was about, when one is known. */
  entityType?: string;
  entityId?: string;
  /** The phase that removes this path. §8.4. */
  removalPhase: number;
}

/**
 * The first stack frame outside this module and its immediate wrappers.
 *
 * `new Error().stack` is the only way to attribute a choke-point call back to the
 * file that made it without threading a caller argument through 98 sites. The
 * frames are trimmed to `file:line`, and everything inside `lib/services/comms`,
 * `lib/services/email` and `lib/services/sms` is skipped so the row names the
 * caller rather than the rail.
 */
export function callerFromStack(stack: string | undefined): string {
  if (!stack) return "unknown";
  const SKIP = [
    "legacy-path-write",
    "/lib/services/email/resend.service",
    "/lib/services/sms/",
    "/lib/services/comms/",
    "/lib/qstash/",
    "node:internal",
  ];
  for (const raw of stack.split("\n").slice(1)) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;
    if (SKIP.some((s) => line.includes(s))) continue;
    // "at fn (/abs/path/file.ts:12:34)" or "at /abs/path/file.ts:12:34"
    const m = line.match(/\(?([^()\s]+\.tsx?):(\d+):\d+\)?$/);
    if (!m) continue;
    const path = m[1]!;
    const idx = path.indexOf("/frontend/");
    return `${idx >= 0 ? path.slice(idx + "/frontend/".length) : path}:${m[2]}`;
  }
  return "unknown";
}

/**
 * Record one use of a legacy path. Never throws — instrumentation must not break
 * the thing it measures.
 */
export async function recordLegacyPathWrite(input: LegacyPathWriteInput): Promise<void> {
  const caller = callerFromStack(new Error().stack);
  try {
    await prisma.auditLog.create({
      data: {
        action: "LEGACY_PATH_WRITE",
        entityType: input.entityType ?? "LegacyPath",
        entityId: input.entityId ?? input.kind,
        reason: `${input.kind}: ${input.detail}`,
        metadata: {
          kind: input.kind,
          caller,
          detail: input.detail,
          removalPhase: input.removalPhase,
        },
      },
    });
  } catch (err) {
    // A counter that fails loudly is a counter someone fixes. A counter that fails
    // silently reports zero and gets a legacy path deleted while it is still live.
    logger.error("[legacy-path-write] failed to record a legacy path use", {
      kind: input.kind,
      caller,
      detail: input.detail,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
