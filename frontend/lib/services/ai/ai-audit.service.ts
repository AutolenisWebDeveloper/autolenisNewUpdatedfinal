// lib/services/ai/ai-audit.service.ts
//
// The unified AI audit trail. One row per AI turn, on every one of the six Zura
// surfaces — replacing a state where exactly one surface (admin) audited at all.
//
// TARGET TABLE: `audit_logs` (`model AuditLog`), NOT `admin_audit_logs`.
//
// `AdminAuditLog.adminId` and `.adminEmail` are both NON-NULLABLE, and five of
// the six surfaces have no admin principal. Writing them there would require
// inventing an admin identity for a buyer's chat turn, and a FALSIFIED ACTOR IN
// AN AUDIT RECORD IS WORSE THAN NO RECORD. `AuditLog` models both principals
// natively (`adminId String?` / `userId String?`).
//
// This also EXTENDS an existing AI trail rather than forking one: `store.ts`'s
// `auditLogRecorder` already writes every ActionIntent lifecycle transition to
// this table under an `actorAction` metadata marker. Same table, same
// convention, one trail.
//
// The admin trail is untouched. An admin AI turn produces TWO rows — its
// existing `ADMIN_AI_CHAT` row in `admin_audit_logs`, plus the AI row here. That
// double-write is deliberate: routing admin AI events only to the admin trail
// would leave the AI trail with a hole exactly where the highest-privilege actor
// is, which is the wrong hole to have.
//
// SCHEMA NOTE — `audit_logs.action` is a Postgres enum (`AdminActionType`) with
// no AI members. Adding one needs `ALTER TYPE ... ADD VALUE`, which cannot run
// inside a transaction block on older Postgres and is not cleanly reversible, so
// it is Stage 3B work behind the migration-ledger gate. Until then this writes
// the general member `STATUS_CHANGE` and carries the real action in `metadata` —
// the identical convention `auditLogRecorder` and `writeDealerAudit` already use.
// Nothing here depends on the enum widening; 3B only makes the rows easier to
// filter.

import { logger } from "@/lib/logger";
import type { ActorType, AuthenticatedRole, RiskClass } from "@/lib/services/ai/action-intent";
import type { ZuraSurface } from "@/lib/ai/context-builder";

/** The metadata marker that identifies a Zura turn row in `audit_logs`. */
export const AI_TURN_ACTOR_ACTION = "AI_TURN";

/** The `entityType` every Zura turn row carries. */
export const AI_TURN_ENTITY_TYPE = "ZuraChatTurn";

export type AiTurnOutcome =
  | "ANSWERED"
  | "PROPOSED"
  | "PROPOSAL_SUPPRESSED"
  | "REFUSED"
  | "RATE_LIMITED"
  | "AI_DISABLED"
  | "ERROR";

export interface AiEvent {
  /** Server-resolved. Never taken from a request body. */
  actor: {
    actorType: ActorType;
    actorId: string;
    authenticatedRole: AuthenticatedRole | null;
  };
  surface: ZuraSurface;
  /** Matches `CompletionRequest.purpose`. */
  purpose: string;
  /** The model that actually answered, including a fallback. Absent on a refusal. */
  model?: string;
  outcome: AiTurnOutcome;
  /**
   * The LENGTH of the user's message, never its body. The transcript store is
   * the body of record and has its own retention policy; the audit trail must
   * not become a second, uncontrolled copy of the same PII.
   */
  messageLength: number;
  /** Correlates the row with the conversation it belongs to. */
  chatSessionId?: string;
  proposalIntentType?: string;
  proposalRiskClass?: RiskClass;
  rejectionCode?: string;
  errorCode?: string;
}

/**
 * Write one AI-turn row.
 *
 * FAIL-LOUD by design (Phase 2 matrix row 37): an audit write failure is logged
 * at error level and the exception is swallowed so the buyer still gets their
 * reply — but it is never silent. Compare the transcript seam, which is
 * fail-open and only logs at warn: losing a transcript degrades support, losing
 * an audit row degrades accountability.
 */
export async function recordAiEvent(event: AiEvent): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const { AdminActionType } = await import("@prisma/client");
    const isAdmin = event.actor.actorType === "ADMIN";

    await prisma.auditLog.create({
      data: {
        // `AuditLog` distinguishes the two principals natively; this is the
        // whole reason the AI trail targets this table.
        adminId: isAdmin ? event.actor.actorId : null,
        userId: isAdmin ? null : event.actor.actorId,
        action: AdminActionType.STATUS_CHANGE,
        entityType: AI_TURN_ENTITY_TYPE,
        entityId: event.chatSessionId ?? event.actor.actorId,
        reason: null,
        metadata: {
          actorAction: AI_TURN_ACTOR_ACTION,
          actorType: event.actor.actorType,
          actorId: event.actor.actorId,
          authenticatedRole: event.actor.authenticatedRole,
          surface: event.surface,
          purpose: event.purpose,
          outcome: event.outcome,
          messageLength: event.messageLength,
          ...(event.model ? { model: event.model } : {}),
          ...(event.chatSessionId ? { chatSessionId: event.chatSessionId } : {}),
          ...(event.proposalIntentType ? { proposalIntentType: event.proposalIntentType } : {}),
          ...(event.proposalRiskClass ? { proposalRiskClass: event.proposalRiskClass } : {}),
          ...(event.rejectionCode ? { rejectionCode: event.rejectionCode } : {}),
          ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        } as unknown as import("@prisma/client").Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Fail-loud: an unaudited AI turn is an accountability gap, so it is logged
    // at error level even though it must not break the user-visible reply.
    logger.error("[ai-audit] AI turn audit write FAILED — turn is unaudited", {
      surface: event.surface,
      purpose: event.purpose,
      outcome: event.outcome,
      err,
    });
  }
}
