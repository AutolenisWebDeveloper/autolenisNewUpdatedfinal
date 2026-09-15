// lib/services/deal/dealer-execution.service.ts
//
// Stage 13/14d — the dealership executes the contract and returns the fully executed copy.
//
//   "The dealership executes the contract on its side and returns the fully executed copy
//    to AutoLenis. AutoLenis VERIFIES that the executed copy corresponds to the approved
//    transaction, stores it, records its hash, generates the completion evidence, and
//    grants access to the buyer, the dealership, and authorized administrators.
//
//    The transaction is not contract-executed merely because the buyer signed. Release
//    remains blocked until the dealership's fully executed copy is stored."
//
// §13-D29 RULED (2026-09-15): UPLOAD PLUS HASH VERIFICATION, not an in-app countersign
// ceremony. The specification says "returns the fully executed copy" and "AutoLenis
// verifies that the executed copy corresponds", and an in-app dealer signature would put a
// dealership inside a consent regime scoped today to the buyer — a dealer-side ESIGN/UETA
// position §13-D4's compliance review has not covered. That is not a thing to build as a
// side effect of a mechanism choice.
//
// §13-D29 ALSO RULED WHERE THIS IS RECORDED, against the decision register's own wording.
// The register proposed adding `deals.dealer_executed_at`. Phase 1 did not add it; it added
// `deals.dealer_executed_contract_id`, a foreign key to the ContractVersion — which is
// strictly more: a timestamp says WHEN, the pointer says WHICH DOCUMENT. Stage 14's
// "Recorded" list names `financing_completed_at` and `funding_cleared_at` and NOT
// `dealer_executed_at`, and `DealStatusHistory` already records the instant of the
// transition into DEALER_EXECUTED. A second store for a fact the history already carries is
// the duplication rule applied to data, so no column was added.
//
// WHAT "VERIFIES THAT IT CORRESPONDS" MEANS HERE, AND WHAT IT HONESTLY CANNOT. An executed
// copy is the approved contract with signatures added, so its bytes NECESSARILY differ from
// the approved version's — a hash equality check would reject every genuine executed copy
// and is the wrong tool. What is verified is: an approved version exists, its hash is on
// record, every required signature is in, and the executed copy is stored with its OWN hash
// so the artefact is tamper-evident from this moment on. The correspondence check that
// remains is a human one, and the upload is recorded for a reviewer rather than described as
// machine-verified. Claiming more than that would be the worst kind of failure here.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { DealStatus } from "@prisma/client";
import { advanceDealStatus } from "./deal.service";
import { computeDocumentHash } from "@/lib/services/esign/buyer-signing.service";
import { signatureProgress } from "@/lib/services/esign/required-signers";
import { fulfilDocumentRequest } from "@/lib/services/documents/document.service";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_8_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import {
  renderDealerExecutionRequested,
  renderExecutedContractStored,
} from "@/lib/services/comms/phase8-email-content";

export class DealerExecutionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DealerExecutionError";
  }
}

/**
 * §27.1 "Buyer signatures completed → Dealership → Dealer execution request".
 *
 * Called when the deal reaches SIGNED — which, after §13-D30, means every required signer
 * has completed, not that a signature arrived.
 */
export async function requestDealerExecution(dealId: string): Promise<void> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      vehicleYear: true, vehicleMake: true, vehicleModel: true,
      offer: {
        select: {
          dealerId: true,
          externalDealerName: true,
          externalDealerEmail: true,
          dealer: { select: { dealershipName: true, isSystemPlaceholder: true, user: { select: { email: true } } } },
        },
      },
    },
  });
  if (!deal) return;

  const to = deal.offer?.dealer?.isSystemPlaceholder
    ? deal.offer.externalDealerEmail
    : deal.offer?.dealer?.user?.email ?? null;
  const dealershipName = deal.offer?.dealer?.isSystemPlaceholder
    ? deal.offer.externalDealerName ?? "your dealership"
    : deal.offer?.dealer?.dealershipName ?? "your dealership";
  const vehicle = [deal.vehicleYear, deal.vehicleMake, deal.vehicleModel].filter(Boolean).join(" ") || "the vehicle";

  if (!to) {
    await raiseException({
      code: "DEALER_DOES_NOT_EXECUTE",
      dealId,
      detail:
        "Every required signature is in, but the winning dealership has no email address, so the " +
        "execution request could not be sent. Release is blocked until the executed copy is stored.",
    }).catch((err) => logger.error("dealer execution: exception could not be raised", err));
    return;
  }

  const content = renderDealerExecutionRequested({ dealershipName, vehicle, dealId });
  await enqueueTransactional({
    triggerEvent: "buyer_signatures_completed",
    templateKey: PHASE_8_TEMPLATES.DEALER_EXECUTION_REQUESTED,
    channel: "email",
    recipientKind: "dealer",
    recipientId: deal.offer?.dealerId ?? null,
    to,
    payload: { email: to, subject: content.subject, html: content.html, text: content.text },
    dealId,
    idempotencyKey: `${PHASE_8_TEMPLATES.DEALER_EXECUTION_REQUESTED}:${dealId}`,
  });
}

export interface RecordExecutionResult {
  contractVersionId: string;
  executedDocumentHash: string;
}

/**
 * Store the dealership's fully executed copy and move the deal to DEALER_EXECUTED.
 *
 * REFUSES, in this order, because each refusal is a different problem:
 *   1. no APPROVED contract version — there is nothing this copy could be an execution OF;
 *   2. a required signature outstanding — §14d's own rule is that the buyer's signature
 *      alone is not execution, and its converse holds too: a dealership cannot counter-execute
 *      a contract the required signers have not all signed;
 *   3. the copy cannot be hashed — an artefact whose bytes AutoLenis never read is not
 *      stored evidence, and recording it as such would be the fabrication this phase must
 *      not commit.
 */
export async function recordDealerExecution(params: {
  dealId: string;
  executedDocumentUrl: string;
  actorId: string;
  actorRole?: string;
  now?: Date;
}): Promise<RecordExecutionResult> {
  const now = params.now ?? new Date();

  const approved = await prisma.contractVersion.findFirst({
    where: { dealId: params.dealId, status: "APPROVED" },
    orderBy: { version: "desc" },
    select: { id: true, documentHash: true, version: true },
  });
  if (!approved) {
    throw new DealerExecutionError(
      "NO_APPROVED_VERSION",
      "There is no Contract-Shield-approved contract version on this deal, so there is nothing an " +
        "executed copy could be an execution of. Upload the contract package first.",
    );
  }

  const progress = await signatureProgress(params.dealId);
  if (!progress.allSigned) {
    throw new DealerExecutionError(
      "SIGNATURES_OUTSTANDING",
      `Every required signature must be recorded before the executed copy is stored. Outstanding: ${
        progress.outstanding.join(", ") || "unknown"
      }.`,
    );
  }

  const executedDocumentHash = await computeDocumentHash(params.executedDocumentUrl).catch((err) => {
    logger.error("dealer execution: could not hash the executed copy", {
      dealId: params.dealId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  if (!executedDocumentHash) {
    throw new DealerExecutionError(
      "UNREADABLE_DOCUMENT",
      "The executed copy could not be read from storage, so its hash could not be recorded. An " +
        "artefact AutoLenis has not read is not stored evidence. Re-upload it.",
    );
  }

  // Recorded on the APPROVED version — the same row the buyer's signature is bound to — so
  // the approved document, the signatures and the executed copy are one chain rather than
  // three facts that have to be joined by hand later.
  await prisma.contractVersion.updateMany({
    where: { id: approved.id, executedDocumentHash: null },
    data: {
      executedAt: now,
      executedDocumentHash,
      // WHERE THE DOCUMENT IS, not just what it hashed to. The hash was being recorded and
      // the location discarded, so §14d's "stores it ... and grants access to the buyer, the
      // dealership, and authorized administrators" had nothing to serve — while the
      // `executed_contract_stored` notice was already telling all three parties they could
      // retrieve it. A fingerprint of a document nobody can produce is not stored evidence.
      executedDocumentKey: params.executedDocumentUrl,
      isDealerExecuted: true,
    },
  });

  await prisma.deal.updateMany({
    where: { id: params.dealId, dealerExecutedContractId: null },
    data: { dealerExecutedContractId: approved.id },
  });

  // Close the Stage 13 document request: an answered request left PENDING produces an
  // overdue escalation against a dealership that already complied.
  await fulfilDocumentRequest(params.dealId, "SALES_CONTRACT", "VERIFIED").catch((err) =>
    logger.error("dealer execution: could not close the document request", err),
  );

  // THE RETURN VALUE IS CHECKED, and that is the fix rather than a nicety. `expectedFrom`
  // makes this a silent no-op when the deal is not at SIGNED — so a deal whose envelopes were
  // all COMPLETED but whose status had been forced elsewhere got its contract version stamped
  // executed, got `dealerExecutedContractId` set, and kept a status saying execution never
  // happened. The route then answered 201 {executed: true}. Half-written and reported as
  // success is the worst of the three possible outcomes; `clearFunding`'s own
  // `expectedFrom: DEALER_EXECUTED` would then never fire either.
  const advanced = await advanceDealStatus(params.dealId, DealStatus.DEALER_EXECUTED, {
    actorId: params.actorId,
    actorRole: params.actorRole ?? "DEALER",
    reason: `Fully executed copy stored against contract version ${approved.version} (hash ${executedDocumentHash.slice(0, 12)}…)`,
    expectedFrom: DealStatus.SIGNED,
  });
  if (!advanced) {
    throw new DealerExecutionError(
      "STATE_MOVED",
      "The executed copy was recorded against the approved contract version, but the deal was " +
        "no longer awaiting execution when the status was written — so it has NOT been advanced " +
        "to dealer-executed. Operations must reconcile this deal before funding can clear.",
    );
  }

  await notifyExecutedStored(params.dealId).catch((err) =>
    logger.error("dealer execution: notification failed (non-fatal)", err),
  );

  return { contractVersionId: approved.id, executedDocumentHash };
}

/** §27.1 "Fully executed contract stored → Buyer + dealership → Executed-document access notice". */
async function notifyExecutedStored(dealId: string): Promise<void> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      buyerId: true,
      vehicleYear: true, vehicleMake: true, vehicleModel: true,
      buyer: { select: { user: { select: { email: true } } } },
      offer: {
        select: {
          dealerId: true,
          externalDealerEmail: true,
          dealer: { select: { isSystemPlaceholder: true, user: { select: { email: true } } } },
        },
      },
    },
  });
  if (!deal) return;
  const vehicle = [deal.vehicleYear, deal.vehicleMake, deal.vehicleModel].filter(Boolean).join(" ") || "your vehicle";

  const buyerEmail = deal.buyer?.user?.email ?? null;
  if (buyerEmail) {
    const content = renderExecutedContractStored({ audience: "buyer", vehicle, dealId });
    await enqueueTransactional({
      triggerEvent: "executed_contract_stored",
      templateKey: PHASE_8_TEMPLATES.EXECUTED_CONTRACT_STORED,
      channel: "email",
      recipientKind: "buyer",
      recipientId: deal.buyerId,
      to: buyerEmail,
      payload: { email: buyerEmail, subject: content.subject, html: content.html, text: content.text },
      dealId,
      idempotencyKey: `${PHASE_8_TEMPLATES.EXECUTED_CONTRACT_STORED}:buyer:${dealId}`,
    });
  }

  const dealerEmail = deal.offer?.dealer?.isSystemPlaceholder
    ? deal.offer.externalDealerEmail
    : deal.offer?.dealer?.user?.email ?? null;
  if (dealerEmail) {
    const content = renderExecutedContractStored({ audience: "dealer", vehicle, dealId });
    await enqueueTransactional({
      triggerEvent: "executed_contract_stored",
      templateKey: PHASE_8_TEMPLATES.EXECUTED_CONTRACT_STORED,
      channel: "email",
      recipientKind: "dealer",
      recipientId: deal.offer?.dealerId ?? null,
      to: dealerEmail,
      payload: { email: dealerEmail, subject: content.subject, html: content.html, text: content.text },
      dealId,
      idempotencyKey: `${PHASE_8_TEMPLATES.EXECUTED_CONTRACT_STORED}:dealer:${dealId}`,
    });
  }
}
