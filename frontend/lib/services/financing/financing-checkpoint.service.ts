// lib/services/financing/financing-checkpoint.service.ts
// §Stage 12 — financing terms locked, or cash confirmed. THE SINGLE WRITER of `financing.status`.
//
// "All financing happens outside AutoLenis. Whether the dealership arranges it, the buyer brings
// it, or AutoLenis assists in finding it, the loan is obtained and completed with an external
// lender. AutoLenis refers, coordinates, follows up, and verifies — and does nothing else."
//
// §12b IS MARKED [BUILT — EXTEND], AND THIS EXTENDS RATHER THAN REPLACES. `Financing` keeps its
// identity, its `@unique` on `deal_id`, and every column it had; the Phase 1 wave added the nine
// this checkpoint writes (`terms_locked_at`, `verified_by`, `expires_at`, `failure_reason` and the
// rest). What changes is that ONE function may now write `status`, and it refuses the four legacy
// values.
//
// THE FULL STATE MACHINE — §12b, not §8.2's shorthand. §8.2 Phase 7 abbreviates this to
// "NOT_STARTED → IN_PROGRESS → TERMS_LOCKED | NOT_REQUIRED_CASH", omitting three states. §12b and
// HTML FIN_PANELS both carry the complete form and the Markdown governs:
//
//   NOT_STARTED → IN_PROGRESS → TERMS_LOCKED → COMPLETED | FAILED | EXPIRED | NOT_REQUIRED_CASH
//
// FAILED and EXPIRED are exits from TERMS_LOCKED, and both are implemented here. COMPLETED is NOT:
// it is checkpoint two, "after signing, before vehicle release", and `deal-early/D3` assigns it to
// PHASE 8. This service refuses to write it, and says so rather than silently ignoring it — a
// checkpoint that quietly declined to complete a deal would be indistinguishable from one that
// completed it wrongly.
//
// §13-D18, RULED. The four legacy values (`PENDING`, `SELECTED`, `APPROVED`, `DECLINED`) stay in
// the Postgres enum because values cannot be dropped without a type rebuild, and CODE REFUSES TO
// WRITE THEM — `assertNotLegacy` below is that refusal. There is no automatic backfill: production
// holds zero `financing` rows, so this is a forward guard rather than a migration, and saying so
// plainly matters because a future reader would otherwise think rows were left untouched by
// choice when there were none. Migration 112 moves the column DEFAULT off `PENDING` for the same
// reason: a default is not code, and an INSERT omitting `status` would have made this refusal
// untrue by construction.
//
// §12c — WHO MAY RECORD, AND WHAT IS WRITTEN. "The buyer can never mark financing completed. Only
// an authorized Finance or Operations administrator records completion, and only against external
// dealership or lender evidence." §13-D21, ruled: the permission is the existing
// `finance.preapproval.decide` at MONEY tier with the ≥10-character reason the external-approval
// route already requires. No new permission — separating Finance from Operations is a decision to
// make when there are people in both roles. The routes enforce it; this service refuses a
// recording with no actor, so a caller that forgot cannot get past it either.
//
// §13-D19, RULED — the audit trail is the existing tamper-evident `financing_audit_events` hash
// chain with its event enum extended, not `AdminAuditLog`. BOTH are written and the chain is
// authoritative. The chain holds ZERO rows, so this phase writes its first entries; the caution
// Phase 6's review surfaced for a column gaining its first writer applies, and `financingId` is
// added to the hash canonical form here (see `financing-audit.service.ts`) while it is still free
// to do so.

import { prisma } from "@/lib/prisma";
import { DealStatus, FinancingPath, FinancingStatus, Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { appendFinancingAuditEvent } from "./financing-audit.service";
import { enqueueOrRaise } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_7_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import {
  renderFinancingPathSelected,
  renderFinancingInProgress,
  renderFinancingTermsLocked,
  renderFinancingFailedOrExpired,
} from "@/lib/services/comms/phase7-email-content";

type Db = typeof prisma | Prisma.TransactionClient;

/** §13-D18 — the four values the code refuses to write. They stay in the enum; nothing writes them. */
export const LEGACY_FINANCING_STATUSES: readonly FinancingStatus[] = [
  FinancingStatus.PENDING,
  FinancingStatus.SELECTED,
  FinancingStatus.APPROVED,
  FinancingStatus.DECLINED,
] as const;

/**
 * The states the CHECKPOINT WRITER may write.
 *
 * PHASE 8 ADDED `COMPLETED` (2026-09-15). Phase 7 reserved it deliberately — "checkpoint two,
 * after signing, before vehicle release (§12a), owned by Phase 8 together with funding
 * clearance" — and `assertPhase7Writable` refused it by name so the reservation was mechanical
 * rather than remembered. Phase 8 now owns it, so the gate opens rather than being bypassed:
 * `recordFinancingCompletion` in funding-clearance.service.ts goes through THIS writer, which
 * is what keeps the §12b transition map, the ≥10-character reason, the actor requirement and
 * the tamper-evident audit chain on the second checkpoint as well as the first.
 *
 * The name is kept. Renaming it would rewrite the history of why it existed, and the array
 * says which states the writer accepts, not which phase wrote them.
 */
export const PHASE_7_WRITABLE: readonly FinancingStatus[] = [
  FinancingStatus.NOT_STARTED,
  FinancingStatus.IN_PROGRESS,
  FinancingStatus.TERMS_LOCKED,
  FinancingStatus.FAILED,
  FinancingStatus.EXPIRED,
  FinancingStatus.NOT_REQUIRED_CASH,
  // Phase 8 — §Stage 14's "financing.status = COMPLETED".
  FinancingStatus.COMPLETED,
] as const;

/** §12b's legal edges. Read as: from → the states it may reach. */
const FINANCING_TRANSITIONS: Record<FinancingStatus, FinancingStatus[]> = {
  NOT_STARTED: [FinancingStatus.IN_PROGRESS, FinancingStatus.NOT_REQUIRED_CASH],
  IN_PROGRESS: [
    FinancingStatus.TERMS_LOCKED,
    FinancingStatus.FAILED,
    FinancingStatus.EXPIRED,
    FinancingStatus.NOT_REQUIRED_CASH,
  ],
  // §12b: COMPLETED, FAILED and EXPIRED are all exits from TERMS_LOCKED. COMPLETED is Phase 8's
  // and is refused by `assertPhase7Writable` before the map is consulted, but the EDGE belongs
  // here so Phase 8 extends the writer rather than redefining the machine.
  TERMS_LOCKED: [FinancingStatus.COMPLETED, FinancingStatus.FAILED, FinancingStatus.EXPIRED],
  // §Stage 12's failure clause: "It does not automatically cancel the Deal." A failed or expired
  // approval returns to another external path, which is IN_PROGRESS again — or cash.
  FAILED: [FinancingStatus.IN_PROGRESS, FinancingStatus.NOT_REQUIRED_CASH],
  EXPIRED: [FinancingStatus.IN_PROGRESS, FinancingStatus.NOT_REQUIRED_CASH],
  COMPLETED: [],
  NOT_REQUIRED_CASH: [],
  // The four legacy values. A row still carrying one may be re-recorded forward by an admin —
  // §13-D18's "left untouched until an admin re-records evidence" — but nothing may write INTO
  // them, which `assertNotLegacy` enforces on the target rather than the source.
  PENDING: [FinancingStatus.NOT_STARTED, FinancingStatus.IN_PROGRESS, FinancingStatus.NOT_REQUIRED_CASH],
  SELECTED: [FinancingStatus.IN_PROGRESS, FinancingStatus.NOT_REQUIRED_CASH],
  APPROVED: [FinancingStatus.IN_PROGRESS, FinancingStatus.TERMS_LOCKED, FinancingStatus.NOT_REQUIRED_CASH],
  DECLINED: [FinancingStatus.IN_PROGRESS, FinancingStatus.NOT_REQUIRED_CASH],
};

export class FinancingCheckpointError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "FinancingCheckpointError";
  }
}

function assertNotLegacy(status: FinancingStatus): void {
  if (LEGACY_FINANCING_STATUSES.includes(status)) {
    throw new FinancingCheckpointError(
      "LEGACY_STATUS_REFUSED",
      `§13-D18: "${status}" is a legacy FinancingStatus. It remains in the Postgres enum for the ` +
        `rows that already carry it, and no code path may write it. Use one of ` +
        `${PHASE_7_WRITABLE.join(", ")}.`,
    );
  }
}

/**
 * §Stage 12 — THE DEAL STATES THAT TAKE NO FINANCING CHECKPOINT.
 *
 * This did not exist. `recordFinancingCheckpoint` SELECTED `deal.status` and never consulted it,
 * and `recordBuyerFinancingPath` did the same, so a cancelled deal — one already stood down by
 * `returnToRemainingOffers`, with its firewall revoked and its buyer emailed — still accepted a
 * recorded lender approval, a `financing_terms_locked_at` on the Deal and an entry in the
 * tamper-evident chain. The money was real and the deal was dead.
 *
 * A DENYLIST, DELIBERATELY, and not an allowlist pinned to `FINANCING_PENDING`. §12a has TWO
 * checkpoints and `deal-early/D3` gives the second to Phase 8 — "after signing, before vehicle
 * release" — which happens at SIGNED or FUNDING_PENDING. An allowlist would refuse it, and a guard
 * that blocks a later phase's legitimate write is the same class of defect as one that allows a
 * dead deal's. §12b's own transition map is what constrains the FINANCING state; this constrains
 * only the DEAL, and only at its three end states.
 */
export const FINANCING_CLOSED_DEAL_STATUSES: readonly DealStatus[] = [
  DealStatus.CANCELLED,
  DealStatus.REFUNDED,
  DealStatus.COMPLETED,
] as const;

export function assertDealAcceptsFinancing(status: DealStatus): void {
  if (FINANCING_CLOSED_DEAL_STATUSES.includes(status)) {
    throw new FinancingCheckpointError(
      "DEAL_CLOSED",
      `This deal is ${status}. §Stage 12's checkpoint records money against a live deal; a ` +
        `recording here would put a lender approval, a terms-locked timestamp and an audit-chain ` +
        `entry on one that has already ended.`,
    );
  }
}

function assertPhase7Writable(status: FinancingStatus): void {
  assertNotLegacy(status);
  if (!PHASE_7_WRITABLE.includes(status)) {
    throw new FinancingCheckpointError(
      "NOT_THIS_PHASE",
      `"${status}" is not a state this writer accepts. Use one of ${PHASE_7_WRITABLE.join(", ")}.`,
    );
  }
}

export interface CheckpointEvidence {
  /** The external lender or dealership the evidence came from. §12c's "source". */
  source: string;
  externalReference?: string | null;
  approvedAmountCents?: number | null;
  downPaymentCents?: number | null;
  aprRate?: number | null;
  termMonths?: number | null;
  monthlyPaymentCents?: number | null;
  expiresAt?: Date | null;
  /** `documents.id` — the stored artefact. §12c's evidence document. */
  evidenceDocumentId?: string | null;
  /** The `external_pre_approvals` row this recording is against, once §12c's D9 store is wired. */
  externalPreApprovalId?: string | null;
  vin?: string | null;
}

export interface RecordCheckpointParams {
  dealId: string;
  status: FinancingStatus;
  path?: FinancingPath;
  /** The Finance/Operations admin. §12c: the buyer can never be the actor here. */
  actorId: string;
  /** The admin's email — `admin_audit_logs.admin_email` is NOT NULL and is how a human reads the row. */
  actorEmail?: string | null;
  actorType: "ADMIN" | "SYSTEM";
  /** §13-D21 — the ≥10-character reason the external-approval route already requires. */
  reason: string;
  evidence?: CheckpointEvidence;
  failureReason?: string | null;
  now?: Date;
}

/**
 * The one function that writes `financing.status`.
 *
 * Everything commits together — the financing row, the Deal's checkpoint timestamps and the audit
 * chain entry — because §28.3 requires atomicity and because a locked term with no audit entry is
 * exactly the state §12c's evidence rule exists to make impossible.
 */
export async function recordFinancingCheckpoint(
  params: RecordCheckpointParams,
): Promise<{
  status: FinancingStatus;
  from: FinancingStatus | null;
  /** §13-D19 — false when the AUTHORITATIVE chain entry could not be written. See the catch below. */
  auditRecorded: boolean;
}> {
  const now = params.now ?? new Date();
  assertPhase7Writable(params.status);

  if (!params.actorId) {
    throw new FinancingCheckpointError(
      "ACTOR_REQUIRED",
      "§12c: every financing recording names its verifier. A recording with no actor cannot be audited.",
    );
  }
  if (params.actorType === "ADMIN" && params.reason.trim().length < 10) {
    throw new FinancingCheckpointError(
      "REASON_TOO_SHORT",
      "§13-D21: a financing recording carries the same ≥10-character reason as an external pre-approval decision.",
    );
  }

  // §12c — "only against external dealership or lender evidence". TERMS_LOCKED without it is the
  // recording this rule exists to prevent. Cash needs none: there is no lender to evidence.
  if (params.status === FinancingStatus.TERMS_LOCKED) {
    const e = params.evidence;
    if (!e?.source || (e.approvedAmountCents == null && e.externalReference == null)) {
      throw new FinancingCheckpointError(
        "EVIDENCE_REQUIRED",
        "§12c: locking terms requires external evidence — at minimum the source and either the approved amount or the lender's reference.",
      );
    }
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: { id: true, status: true, financingPath: true, buyerId: true, vin: true },
  });
  if (!deal) throw new FinancingCheckpointError("NOT_FOUND", "Deal not found.");
  // The status was SELECTED above and never read. See `assertDealAcceptsFinancing`.
  assertDealAcceptsFinancing(deal.status);

  const e = params.evidence;

  // EVERYTHING FROM THE READ TO THE WRITE IS ONE TRANSACTION, and it was not.
  //
  // The §12b transition was validated against a `findUnique` taken out here and then applied with
  // a blind `upsert` inside. Two Finance admins recording different lender terms in the same
  // second both read IN_PROGRESS, both found IN_PROGRESS → TERMS_LOCKED legal, and both wrote —
  // the later one silently replacing the other's APR, term and approved amount on a row whose
  // audit chain then carried two TERMS_LOCKED entries disagreeing about the same loan.
  //
  // So the status is re-read inside, the transition is checked against THAT read, and the write
  // pins it: `updateMany ... where status = existing.status` applies to zero rows if anyone moved
  // it in between, and zero rows is refused rather than retried — a second admin's terms are not
  // this caller's to overwrite.
  const { financingId, from, path } = await prisma.$transaction(async (tx) => {
    const existing = await tx.financing.findUnique({
      where: { dealId: params.dealId },
      select: { id: true, status: true, path: true },
    });

    const from = existing?.status ?? null;
    if (from && from !== params.status) {
      const legal = FINANCING_TRANSITIONS[from] ?? [];
      if (!legal.includes(params.status)) {
        throw new FinancingCheckpointError(
          "INVALID_TRANSITION",
          `§12b does not allow ${from} → ${params.status}. Legal from ${from}: ${legal.join(", ") || "none"}.`,
        );
      }
    }

    const path =
      params.path ??
      existing?.path ??
      (deal.financingPath as FinancingPath | null) ??
      (params.status === FinancingStatus.NOT_REQUIRED_CASH ? FinancingPath.CASH : FinancingPath.EXTERNAL);

    const financingWrite = {
      path,
      status: params.status,
      lenderName: e?.source ?? undefined,
      externalReference: e?.externalReference ?? undefined,
      approvedAmountCents: e?.approvedAmountCents ?? undefined,
      downPaymentCents: e?.downPaymentCents ?? undefined,
      aprRate: e?.aprRate ?? undefined,
      termMonths: e?.termMonths ?? undefined,
      monthlyPaymentCents: e?.monthlyPaymentCents ?? undefined,
      expiresAt: e?.expiresAt ?? undefined,
      evidenceDocumentId: e?.evidenceDocumentId ?? undefined,
      failureReason: params.failureReason ?? undefined,
      verifiedBy: params.actorId,
      verifiedAt: now,
      ...(params.status === FinancingStatus.TERMS_LOCKED ? { termsLockedAt: now } : {}),
    };

    let financingId: string;
    if (existing) {
      const claimed = await tx.financing.updateMany({
        where: { dealId: params.dealId, status: existing.status },
        data: financingWrite,
      });
      if (claimed.count !== 1) {
        throw new FinancingCheckpointError(
          "CONCURRENT_MODIFICATION",
          "Another financing recording for this deal committed while this one was being prepared. " +
            "Re-read the current terms before recording again — replacing them blind would lose a " +
            "verifier's evidence.",
        );
      }
      financingId = existing.id;
    } else {
      try {
        const row = await tx.financing.create({
          data: { dealId: params.dealId, ...financingWrite },
          select: { id: true },
        });
        financingId = row.id;
      } catch (err) {
        // `financing.deal_id` is @unique, so a concurrent first recording lands here rather than
        // creating a second row. Same answer as a lost compare-and-swap.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new FinancingCheckpointError(
            "CONCURRENT_MODIFICATION",
            "Another financing recording for this deal committed first. Re-read it before recording again.",
          );
        }
        throw err;
      }
    }

    // The Deal's own checkpoint timestamps. `financing_completed_at` is Phase 8's and is NOT
    // written here — see the header.
    if (params.status === FinancingStatus.TERMS_LOCKED || params.status === FinancingStatus.NOT_REQUIRED_CASH) {
      await tx.deal.update({
        where: { id: params.dealId },
        data: { financingTermsLockedAt: now, financingPath: path },
      });
    } else {
      await tx.deal.update({ where: { id: params.dealId }, data: { financingPath: path } });
    }

    // §12c — the evidence record attaches to the DEAL. `external_pre_approvals.deal_id` exists
    // (Phase 1 wave) and this is its writer.
    //
    // SCOPED TO THIS DEAL'S BUYER, AND THE COUNT IS READ. It was `{ id, dealId: null }` with the
    // result discarded: naming ANOTHER buyer's unattached pre-approval attached their lender
    // evidence — name, approved amount, APR, term — to this deal, and naming one that did not
    // exist, or was already attached elsewhere, updated nothing while the checkpoint still
    // reported §12c evidence recorded. `dealId: params.dealId` is in the OR so a re-record of the
    // same checkpoint is idempotent rather than a spurious refusal.
    if (e?.externalPreApprovalId) {
      const attached = await tx.externalPreApproval.updateMany({
        where: {
          id: e.externalPreApprovalId,
          buyerId: deal.buyerId,
          OR: [{ dealId: null }, { dealId: params.dealId }],
        },
        data: { dealId: params.dealId },
      });
      if (attached.count !== 1) {
        throw new FinancingCheckpointError(
          "EVIDENCE_NOT_ATTACHABLE",
          "That external pre-approval does not belong to this buyer, or is already attached to a " +
            "different deal. §12c records evidence against the deal it was verified for.",
        );
      }
    }

    return { financingId, from, path };
  });

  // §13-D19 — the tamper-evident chain, written OUTSIDE the transaction deliberately. The chain
  // append is itself a Serializable transaction with a bounded retry (`financing-audit.service`),
  // and nesting it inside this one would make an audit-write conflict roll back a committed
  // financing decision. The chain is authoritative for what was recorded; the financing row is the
  // state. A chain write that fails is a reportable defect, not a reason to unwind the checkpoint.
  const auditRecorded = await appendFinancingAuditEvent({
    eventType: AUDIT_EVENT[params.status],
    actorType: params.actorType === "ADMIN" ? "ADMIN" : "SYSTEM",
    actorId: params.actorId,
    dealId: params.dealId,
    buyerId: deal.buyerId,
    financingId,
    payload: {
      // §12c's full list: source, external reference, approved amount, down payment, APR, term,
      // payment, expiration, VIN, verifier identity and verification time.
      from,
      to: params.status,
      path,
      source: e?.source ?? null,
      externalReference: e?.externalReference ?? null,
      approvedAmountCents: e?.approvedAmountCents ?? null,
      downPaymentCents: e?.downPaymentCents ?? null,
      aprRate: e?.aprRate ?? null,
      termMonths: e?.termMonths ?? null,
      monthlyPaymentCents: e?.monthlyPaymentCents ?? null,
      expiresAt: e?.expiresAt?.toISOString() ?? null,
      vin: e?.vin ?? deal.vin ?? null,
      evidenceDocumentId: e?.evidenceDocumentId ?? null,
      verifiedBy: params.actorId,
      verifiedAt: now.toISOString(),
      reason: params.reason,
      failureReason: params.failureReason ?? null,
    },
  })
    .then(() => true)
    .catch(async (err) => {
      // A LOST CHAIN APPEND IS NOT A SUCCESSFUL CHECKPOINT, and this used to read as one: the
      // caller got the same `{ status, from }` whether or not §13-D19's AUTHORITATIVE record was
      // written, with a log line the only trace. The checkpoint still stands — unwinding a
      // committed financing decision because its record failed is the header's ruling and it holds
      // — but it stops being indistinguishable from one that was recorded properly.
      //
      // The durable half goes to `AdminAuditLog`, which this function already writes and an
      // Operations surface already reads. §26's register has NO code for a broken audit chain; one
      // is not invented here, because adding a row to that register is an owner decision and a
      // fabricated code would be a queue item nobody's runbook describes. Reported instead.
      logger.error("financing checkpoint: audit chain append failed — the checkpoint is committed", {
        dealId: params.dealId,
        status: params.status,
        error: err instanceof Error ? err.message : String(err),
      });
      await prisma.adminAuditLog
        .create({
          data: {
            adminId: params.actorId,
            adminEmail: params.actorEmail ?? "",
            action: "FINANCING_AUDIT_APPEND_FAILED",
            entityType: "Deal",
            entityId: params.dealId,
            reason:
              `The §13-D19 chain entry for ${params.status} could not be written. The checkpoint is ` +
              `committed and the chain does not record it.`,
            metadata: {
              status: params.status,
              financingId,
              error: err instanceof Error ? err.message : String(err),
            } as Prisma.InputJsonValue,
          },
        })
        .catch((mirrorErr) => {
          // The last durable writer available here. It must not throw — the checkpoint is
          // committed — and it must not be silent either.
          logger.error("financing checkpoint: the audit-failure record itself could not be written", {
            dealId: params.dealId,
            error: mirrorErr instanceof Error ? mirrorErr.message : String(mirrorErr),
          });
        });
      return false;
    });

  // §13-D19 — "Both written, the chain authoritative." The AdminAuditLog mirror is for the admin
  // surfaces that already read it; it is never consulted to establish what happened.
  if (params.actorType === "ADMIN") {
    await prisma.adminAuditLog
      .create({
        data: {
          adminId: params.actorId,
          adminEmail: params.actorEmail ?? "",
          action: `FINANCING_${params.status}`,
          entityType: "Deal",
          entityId: params.dealId,
          reason: params.reason,
          metadata: { from, to: params.status } as Prisma.InputJsonValue,
        },
      })
      .catch((err) => {
        // The MIRROR, not the record. §13-D19 makes `financing_audit_events` authoritative, so a
        // lost mirror row does not lose the checkpoint — but it does leave an admin surface that
        // reads AdminAuditLog showing a gap, and a gap nobody logged is a gap nobody can explain.
        logger.error("financing checkpoint: AdminAuditLog mirror failed — the chain entry stands", {
          dealId: params.dealId,
          status: params.status,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  await notifyCheckpoint(params.dealId, params.status, from, params.failureReason ?? null);

  // §Stage 12's failure clause — an exception, and explicitly NOT an auto-cancel.
  if (params.status === FinancingStatus.FAILED || params.status === FinancingStatus.EXPIRED) {
    await raiseException({
      code: "FINANCING_FAILED_OR_EXPIRED",
      dealId: params.dealId,
      buyerId: deal.buyerId,
      detail:
        `Financing ${params.status.toLowerCase()}${params.failureReason ? `: ${params.failureReason}` : ""}. ` +
        `Return the buyer to another external path — a different lender, a different structure, a ` +
        `larger down payment, or cash. Do NOT cancel the deal. Re-evaluate the vehicle hold and ` +
        `have it extended or released.`,
    }).catch((err) => {
      // The queue writer is the last resort; if it fails there is nothing further to escalate to,
      // so this must not throw. It must not be SILENT either — `.catch(() => undefined)` left a
      // buyer whose financing had just failed with no exception raised and no line saying so.
      logger.error("financing checkpoint: the §26 exception could not be raised", {
        dealId: params.dealId,
        status: params.status,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return { status: params.status, from, auditRecorded };
}

/** §13-D19's extended event enum, mapped one-to-one so no status writes an unrelated event. */
const AUDIT_EVENT: Record<FinancingStatus, "TERMS_LOCKED" | "FINANCING_COMPLETED" | "FINANCING_FAILED" | "FINANCING_EXPIRED" | "CASH_CONFIRMED" | "EVIDENCE_ATTACHED" | "STATE_TRANSITION"> = {
  TERMS_LOCKED: "TERMS_LOCKED",
  COMPLETED: "FINANCING_COMPLETED",
  FAILED: "FINANCING_FAILED",
  EXPIRED: "FINANCING_EXPIRED",
  NOT_REQUIRED_CASH: "CASH_CONFIRMED",
  IN_PROGRESS: "EVIDENCE_ATTACHED",
  NOT_STARTED: "STATE_TRANSITION",
  PENDING: "STATE_TRANSITION",
  SELECTED: "STATE_TRANSITION",
  APPROVED: "STATE_TRANSITION",
  DECLINED: "STATE_TRANSITION",
};

/**
 * §Stage 12 — the buyer records their PATH and nothing else.
 *
 * This is what remains of the two buyer routes Phase 7 closed. `POST /api/buyer/financing` used to
 * write `Financing` with `status: SELECTED` (a legacy value) and an `approvedAmountCents` taken
 * from a BUYER-SUPPLIED figure, then advance the deal; `PATCH /api/buyer/deal/financing` advanced
 * it with no financing record at all. A buyer self-certifying their own approved amount and then
 * advancing past the checkpoint is §12c inverted — "the buyer can never mark financing completed"
 * is not a rule about one status, it is a rule about who the verifier is.
 *
 * So the buyer's action writes `path` and `IN_PROGRESS`, carries no amount, and advances nothing.
 */
export async function recordBuyerFinancingPath(params: {
  dealId: string;
  buyerId: string;
  path: FinancingPath;
  now?: Date;
}): Promise<{ status: FinancingStatus }> {
  const now = params.now ?? new Date();
  const deal = await prisma.deal.findFirst({
    where: { id: params.dealId, buyerId: params.buyerId },
    select: { id: true, status: true },
  });
  if (!deal) throw new FinancingCheckpointError("NOT_FOUND", "Deal not found.");
  // Selected here and ignored, exactly as in the writer below it. The delegation would now refuse
  // a closed deal anyway; checking here refuses it BEFORE the cash branch decides a status, so the
  // buyer is told their deal has ended rather than told an election was recorded on it.
  assertDealAcceptsFinancing(deal.status);

  // Cash is the one path the buyer's own election settles: §12d says a cash purchase "sets
  // NOT_REQUIRED_CASH at this stage and is confirmed as received by the dealership at funding
  // clearance". There is no lender to verify, so there is no verifier to insist on — the
  // confirmation that matters happens in Phase 8.
  const status = params.path === FinancingPath.CASH ? FinancingStatus.NOT_REQUIRED_CASH : FinancingStatus.IN_PROGRESS;

  await recordFinancingCheckpoint({
    dealId: params.dealId,
    status,
    path: params.path,
    actorId: "system",
    actorType: "SYSTEM",
    reason: `Buyer elected the ${params.path} financing path at Stage 12.`,
    now,
  });

  await notifyPathSelected(params.dealId, params.path);
  return { status };
}

async function notifyPathSelected(dealId: string, path: FinancingPath): Promise<void> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { buyerId: true, buyer: { select: { firstName: true, user: { select: { email: true } } } } },
  });
  if (!deal?.buyer?.user?.email) return;
  const content = renderFinancingPathSelected({ firstName: deal.buyer.firstName, path, dealId });
  await enqueueOrRaise({
    triggerEvent: "financing_path_selected",
    templateKey: PHASE_7_TEMPLATES.FINANCING_PATH_SELECTED,
    channel: "email",
    recipientKind: "buyer",
    recipientId: deal.buyerId,
    to: deal.buyer.user.email,
    payload: {
      email: deal.buyer.user.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
    },
    dealId,
    idempotencyKey: `${PHASE_7_TEMPLATES.FINANCING_PATH_SELECTED}:${dealId}:${path}`,
  }, {
    buyerId: deal.buyerId,
    idempotencyKey: `FINANCING_PATH_NOTICE_ENQUEUE_FAILED:${dealId}:${path}`,
    detail:
      `This buyer's financing path was set to ${path} and the notice explaining what happens next ` +
      "could not be enqueued. They are waiting on an instruction they were never sent.",
  });
}

async function notifyCheckpoint(
  dealId: string,
  status: FinancingStatus,
  from: FinancingStatus | null,
  failureReason: string | null,
): Promise<void> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      buyerId: true,
      buyer: { select: { firstName: true, user: { select: { email: true } } } },
      financing: { select: { approvedAmountCents: true, aprRate: true, termMonths: true } },
    },
  });
  if (!deal?.buyer?.user?.email) return;
  const to = deal.buyer.user.email;
  const base = { email: to } as const;

  if (status === FinancingStatus.TERMS_LOCKED || status === FinancingStatus.NOT_REQUIRED_CASH) {
    const content = renderFinancingTermsLocked({
      recipientName: deal.buyer.firstName,
      cash: status === FinancingStatus.NOT_REQUIRED_CASH,
      approvedAmountCents: deal.financing?.approvedAmountCents ?? null,
      aprRate: deal.financing?.aprRate ?? null,
      termMonths: deal.financing?.termMonths ?? null,
      dealId,
      forDealer: false,
    });
    await enqueueOrRaise({
      triggerEvent: "financing_terms_locked",
      templateKey: PHASE_7_TEMPLATES.FINANCING_TERMS_LOCKED,
      channel: "email",
      recipientKind: "buyer",
      recipientId: deal.buyerId,
      to,
      payload: { ...base, subject: content.subject, html: content.html, text: content.text },
      dealId,
      idempotencyKey: `${PHASE_7_TEMPLATES.FINANCING_TERMS_LOCKED}:${dealId}`,
    }, {
      buyerId: deal.buyerId,
      idempotencyKey: `TERMS_LOCKED_NOTICE_ENQUEUE_FAILED:${dealId}`,
      detail:
        "This deal's financing terms are locked and the notice could not be enqueued. The buyer " +
        "has not been told the terms, and §12a's second misunderstanding — 'approved means funded' " +
        "— is exactly what that message exists to prevent.",
    });
    return;
  }

  if (status === FinancingStatus.FAILED || status === FinancingStatus.EXPIRED) {
    const content = renderFinancingFailedOrExpired({
      firstName: deal.buyer.firstName,
      expired: status === FinancingStatus.EXPIRED,
      failureReason,
      dealId,
    });
    await enqueueOrRaise({
      triggerEvent: "financing_failed_or_expired",
      templateKey: PHASE_7_TEMPLATES.FINANCING_FAILED_OR_EXPIRED,
      channel: "email",
      recipientKind: "buyer",
      recipientId: deal.buyerId,
      to,
      // Keyed on the TRANSITION rather than the deal: a second failure after a retry is a second
      // thing the buyer needs to hear, and one key per deal would silence it.
      payload: { ...base, subject: content.subject, html: content.html, text: content.text },
      // THE `dealId` IS LOAD-BEARING, and it was missing. `skipIfFinancingStatusChanged` opens with
      // `if (!ctx.dealId) return { proceed: false }`, so a row enqueued without one is skipped at
      // drain with `STATE_RECHECK_SKIP` — not failed, not retried, just never sent. §Stage 12's
      // failure clause ("the buyer is told plainly what is being tried and by when") would have
      // been unreachable for EVERY failure and every expiry, and nothing would have thrown.
      dealId,
      idempotencyKey: `${PHASE_7_TEMPLATES.FINANCING_FAILED_OR_EXPIRED}:${dealId}:${from ?? "none"}:${status}`,
    }, {
      buyerId: deal.buyerId,
      idempotencyKey: `FINANCING_FAILED_NOTICE_ENQUEUE_FAILED:${dealId}:${from ?? "none"}:${status}`,
      detail:
        `This buyer's financing is ${status} and the notice could not be enqueued. They are waiting ` +
        "on a deal that has stopped moving and have been told nothing about why.",
    });
    return;
  }

  if (status === FinancingStatus.IN_PROGRESS) {
    const content = renderFinancingInProgress({ firstName: deal.buyer.firstName, missingEvidence: true, dealId });
    await enqueueOrRaise({
      triggerEvent: "financing_in_progress",
      templateKey: PHASE_7_TEMPLATES.FINANCING_IN_PROGRESS,
      channel: "email",
      recipientKind: "buyer",
      recipientId: deal.buyerId,
      to,
      payload: { ...base, subject: content.subject, html: content.html, text: content.text },
      dealId,
      idempotencyKey: `${PHASE_7_TEMPLATES.FINANCING_IN_PROGRESS}:${dealId}`,
    }, {
      buyerId: deal.buyerId,
      idempotencyKey: `FINANCING_IN_PROGRESS_NOTICE_ENQUEUE_FAILED:${dealId}`,
      detail:
        "This buyer's financing moved to IN_PROGRESS and the notice naming the evidence still " +
        "outstanding could not be enqueued. They do not know what is being asked of them.",
    });
  }
}

/**
 * §Stage 12's exit: "TERMS_LOCKED or NOT_REQUIRED_CASH, and the recap reflects the locked terms."
 * Read by Phase 8's contract-request gate (`deal-early/D2a`, "terms locked before contract
 * request"), exported here so that gate reads one predicate rather than re-deriving it.
 */
export async function financingTermsLocked(dealId: string, db: Db = prisma): Promise<boolean> {
  const row = await db.financing.findUnique({ where: { dealId }, select: { status: true } });
  if (!row) return false;
  return row.status === FinancingStatus.TERMS_LOCKED || row.status === FinancingStatus.NOT_REQUIRED_CASH;
}
