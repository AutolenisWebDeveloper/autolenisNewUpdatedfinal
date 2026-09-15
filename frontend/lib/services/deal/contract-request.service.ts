// lib/services/deal/contract-request.service.ts
//
// Stage 13/14a — the contract request, and Stage 15's insurance request that rides with it.
//
// WHAT THIS REPLACES. Before Phase 8 the only thing that ever asked a dealership for a
// contract was an administrator typing CONTRACT_PENDING into
// `POST /api/admin/deals/[dealId]/action`, which fired one deadline-free email. Every
// other route into the stage — the fee ladder, the insurance driver, the buyer's own
// upload — told the dealership nothing at all. §14a is explicit that this must not
// depend on a person: the request is "dispatched durably from the central transition
// into contract-pending — not from an administrator's manual action — with reminder and
// escalation attached".
//
// So this runs from `runArrivalHooks` in deal.service.ts, and every path that reaches
// CONTRACT_PENDING gets the same request, the same 24-hour deadline and the same
// escalation — including a `force: true` admin override, which is the path most likely
// to skip a step.
//
// WHY INSURANCE IS HERE AND NOT IN ITS OWN STAGE. Stage 15's entry is "Contract
// requested — insurance is requested at the same moment so the buyer has time to bind".
// Asking at contract request and blocking at release is the whole design: it is what
// lets §13-D28 take insurance off the contract-entry path without shortening the window
// the buyer actually gets. Requesting it anywhere later would make the parallel track a
// serial one again, with the buyer as the bottleneck.
//
// IDEMPOTENCY. `CONTRACT_REVIEW → CONTRACT_PENDING` is a legal edge (contract re-submit),
// so a deal can arrive here repeatedly. `requestDocument` returns the live PENDING row
// rather than opening a second one, and every enqueue carries a deal-scoped idempotency
// key — so a re-arrival neither duplicates a message nor restarts a clock that is
// already running against the dealership.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requestDocument } from "@/lib/services/documents/document.service";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import {
  PHASE_8_TEMPLATES,
  contractRequestCancelKey,
  insuranceReviewCancelKey,
} from "@/lib/services/comms/state-recheck-registry";
import {
  renderContractOverdue,
  renderContractRequested,
  renderInsuranceRequired,
} from "@/lib/services/comms/phase8-email-content";
import { raiseException } from "@/lib/services/operations/queue-item.service";

/** §14a: "a secure upload request with a 24-hour deadline". */
export const CONTRACT_REQUEST_WINDOW_HOURS = 24;

export interface OpenContractRequestResult {
  created: boolean;
  dueAt: Date | null;
  reason?: string;
}

export async function openContractRequest(params: {
  dealId: string;
  actorId?: string;
  actorRole?: string;
  now?: Date;
}): Promise<OpenContractRequestResult> {
  const now = params.now ?? new Date();

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      buyerId: true,
      vin: true,
      vehicleYear: true,
      vehicleMake: true,
      vehicleModel: true,
      otdCentsConfirmed: true,
      offer: {
        select: {
          dealerId: true,
          otdPriceCents: true,
          externalDealerName: true,
          externalDealerEmail: true,
          dealer: {
            select: { dealershipName: true, isSystemPlaceholder: true, user: { select: { email: true } } },
          },
        },
      },
    },
  });
  if (!deal) {
    logger.error("contract request: deal not found", { dealId: params.dealId });
    return { created: false, dueAt: null, reason: "deal_not_found" };
  }

  const dueAt = new Date(now.getTime() + CONTRACT_REQUEST_WINDOW_HOURS * 3600_000);
  const vehicle =
    [deal.vehicleYear, deal.vehicleMake, deal.vehicleModel].filter(Boolean).join(" ") || "your vehicle";

  // ── 1. The record the overdue sweep reads ──────────────────────────────────
  // Opened FIRST and unconditionally. If the dealership turns out to have no email the
  // deadline is still running and still escalatable; a request that exists only as a
  // sent message is a request that disappears when the message cannot be sent.
  const contractRequest = await requestDocument(
    params.dealId,
    "SALES_CONTRACT",
    params.actorId ?? "SYSTEM",
    "Stage 13 contract package — dealership determines and confirms the complete package.",
    { dueAt, buyerId: deal.buyerId },
  );
  const alreadyOpen = contractRequest.createdAt.getTime() < now.getTime() - 1000;

  // ── 2. Insurance, requested at the same moment (Stage 15 entry) ────────────
  // No due date: Stage 15 never puts a deadline on the buyer, it blocks RELEASE. A
  // dueAt here would make the overdue sweep escalate a buyer for not having bought
  // insurance yet, which is not a thing that happens.
  await requestDocument(
    params.dealId,
    "INSURANCE_PROOF",
    params.actorId ?? "SYSTEM",
    "Stage 15 proof of coverage — requested at contract request so the buyer has the full window to bind.",
    { buyerId: deal.buyerId },
  );

  if (alreadyOpen) {
    // A re-arrival. The clock is already running against the dealership and the
    // messages are already queued or delivered; re-sending would reset nothing and
    // would tell a dealership that is mid-upload to start again.
    return { created: false, dueAt: contractRequest.dueAt, reason: "already_open" };
  }

  // ── 3. The dealership's request and its escalation ─────────────────────────
  const dealershipEmail = deal.offer?.dealer?.isSystemPlaceholder
    ? deal.offer.externalDealerEmail
    : deal.offer?.dealer?.user?.email ?? null;
  const dealershipName = deal.offer?.dealer?.isSystemPlaceholder
    ? deal.offer.externalDealerName ?? "your dealership"
    : deal.offer?.dealer?.dealershipName ?? "your dealership";

  if (!dealershipEmail) {
    // A recipient with no channel never produces an outbox row, so there is nothing in
    // the dispatcher to investigate — it is its own exception (Phase 6 ruling 4). The
    // 24-hour window is running regardless, which is exactly why this must be loud.
    await raiseException({
      code: "COMMS_NO_DELIVERABLE_CHANNEL",
      dealId: params.dealId,
      detail:
        "The winning dealership has no email address, so the Stage 13 contract request could not " +
        `be enqueued. The ${CONTRACT_REQUEST_WINDOW_HOURS}-hour deadline is running and the buyer ` +
        "cannot sign until a package arrives.",
    }).catch((err) => {
      logger.error("contract request: exception could not be raised", {
        dealId: params.dealId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return { created: true, dueAt, reason: "no_dealer_channel" };
  }

  const request = renderContractRequested({
    dealershipName,
    vehicle,
    vin: deal.vin,
    otdCents: deal.otdCentsConfirmed ?? deal.offer?.otdPriceCents ?? null,
    dueAt,
    dealId: params.dealId,
  });
  await enqueueTransactional({
    triggerEvent: "contract_pending",
    templateKey: PHASE_8_TEMPLATES.CONTRACT_REQUESTED,
    channel: "email",
    recipientKind: "dealer",
    recipientId: deal.offer?.dealerId ?? null,
    to: dealershipEmail,
    payload: { email: dealershipEmail, subject: request.subject, html: request.html, text: request.text },
    dealId: params.dealId,
    idempotencyKey: `${PHASE_8_TEMPLATES.CONTRACT_REQUESTED}:${params.dealId}`,
    cancelKey: contractRequestCancelKey(params.dealId),
  });

  // The overdue reminder is enqueued NOW with a future runAt rather than discovered by a
  // sweep, for the same reason Phase 7 did it for reaffirmation: a row that already
  // exists cannot be forgotten by a cron that failed to run. The sweep still exists —
  // it raises the Operations exception and handles the case where this row was never
  // written — but the dealership's reminder does not depend on it.
  const overdue = renderContractOverdue({ dealershipName, vehicle, dueAt, dealId: params.dealId });
  await enqueueTransactional({
    triggerEvent: "contract_overdue",
    templateKey: PHASE_8_TEMPLATES.CONTRACT_OVERDUE,
    channel: "email",
    recipientKind: "dealer",
    recipientId: deal.offer?.dealerId ?? null,
    to: dealershipEmail,
    payload: { email: dealershipEmail, subject: overdue.subject, html: overdue.html, text: overdue.text },
    dealId: params.dealId,
    idempotencyKey: `${PHASE_8_TEMPLATES.CONTRACT_OVERDUE}:${params.dealId}`,
    runAt: dueAt,
    cancelKey: contractRequestCancelKey(params.dealId),
  });

  // ── 4. The buyer's insurance request ───────────────────────────────────────
  const buyer = await prisma.buyer.findUnique({
    where: { id: deal.buyerId },
    select: { user: { select: { email: true } } },
  });
  const buyerEmail = buyer?.user?.email ?? null;
  if (buyerEmail) {
    const insurance = renderInsuranceRequired({ vehicle, vin: deal.vin });
    await enqueueTransactional({
      triggerEvent: "contract_pending",
      templateKey: PHASE_8_TEMPLATES.INSURANCE_REQUIRED,
      channel: "email",
      recipientKind: "buyer",
      recipientId: deal.buyerId,
      to: buyerEmail,
      payload: { email: buyerEmail, subject: insurance.subject, html: insurance.html, text: insurance.text },
      dealId: params.dealId,
      idempotencyKey: `${PHASE_8_TEMPLATES.INSURANCE_REQUIRED}:${params.dealId}`,
      cancelKey: insuranceReviewCancelKey(params.dealId),
    });
  } else {
    logger.error("contract request: buyer has no email — insurance request not enqueued", {
      dealId: params.dealId,
    });
  }

  return { created: true, dueAt };
}
