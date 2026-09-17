// §Stage 20's FOURTEEN completion preconditions — the checklist the irreversible act is gated on.
//
//   "Completion requires all of the following to be true. If any is false, the Deal is not
//    complete and the website shows the exact missing checkpoint and the responsible party."
//    (MD §Stage 20 L981.)
//
// WHY THIS IS NOT `assertReleaseGates`, AND WHY BOTH EXIST. Phase 8's three release gates —
// insurance, the dealership's executed contract, funding clearance — answer "may this vehicle
// move?". They run at every rung of the ladder, including the two Phase 9 added. These fourteen
// answer a different and stricter question: "is this transaction FINISHED?". Three of the
// fourteen are the release gates; the other eleven are things a vehicle can physically move
// without, and a completed Deal cannot be true without. Collapsing them would either block
// handovers on paperwork that has until completion to land, or complete deals on three checks
// out of fourteen.
//
// THE SHAPE IS `funding-clearance.service.ts`'s, and this time it is the type itself rather than
// a copy. `ClearanceItem` already carries exactly what Stage 20 asks a failure to show — the
// checkpoint (`label`) and the responsible party (`owner`) — so this reuses it unchanged, and
// `FundingClearanceChecklist.tsx` renders this list with no new component. Stage 16's
// `ReadinessItem` extends the same type with a required action and a deadline because Stage 16
// asks for those in as many words; Stage 20 does not, and inventing them here would put a
// deadline on a checkpoint the document gives none.
//
// DERIVED, NEVER STORED — same rule as the readiness list. Every one of the fourteen reads a
// fact an earlier phase already writes. A `completion_ready` column would be a second copy of
// fourteen facts, and it would be wrong the first time any of them changed.
//
// "NOT APPLICABLE" IS LOAD-BEARING HERE. Two deal shapes reach Stage 20 and they do not have the
// same chain. An AUCTION deal runs Deal → Offer → Auction → Sourcing case → Vehicle Request. A
// CONCIERGE deal runs Deal → VehicleRequestOffer → Vehicle Request, with no auction and no
// sourcing case, because none was ever opened. Marking those two links outstanding on a
// concierge deal would make completion unreachable for an entire product line; marking them
// satisfied would claim a check that never ran.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { INSURANCE_SATISFIED } from "./deal.service";
import type { ClearanceItem, ClearanceOwner } from "./funding-clearance.service";
import { signatureProgress } from "@/lib/services/esign/required-signers";

type Db = typeof prisma | Prisma.TransactionClient;

export interface CompletionPreconditionEvaluation {
  items: ClearanceItem[];
  /** The ones that are false and do apply — Stage 20's "exact missing checkpoint". */
  outstanding: ClearanceItem[];
  complete: boolean;
}

/**
 * Stage 20's count, asserted rather than trusted.
 *
 * A checklist that silently loses an item completes more deals than it should, and nothing about
 * its output looks different. `completion-preconditions.test.ts` pins this against the evaluated
 * list and against the document's own fourteen bullets.
 */
export const STAGE_20_PRECONDITION_COUNT = 14;

/**
 * Evaluate all fourteen for one deal.
 *
 * TAKES A TRANSACTION HANDLE, and that is the point. §Stage 20 completes atomically, so the
 * check and the write must see the same snapshot: evaluating on `prisma` and writing on `tx`
 * would let funding be withdrawn, a hold be placed, or an exception be opened in the window
 * between them, and the completion would commit against a checklist that was true a moment ago.
 *
 * FAILS CLOSED, LOUDLY. An unreadable deal is not a complete one.
 */
export async function evaluateCompletionPreconditions(
  dealId: string,
  db: Db = prisma,
): Promise<CompletionPreconditionEvaluation> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      status: true,
      buyerId: true,
      coBuyerId: true,
      vehicleRequestId: true,
      depositId: true,
      auctionId: true,
      offerId: true,
      vehicleRequestOfferId: true,
      dealerId: true,
      vin: true,
      vehicleYear: true,
      vehicleMake: true,
      vehicleModel: true,
      recapConfirmedByBuyerAt: true,
      recapConfirmedByDealerAt: true,
      financingCompletedAt: true,
      fundingClearedAt: true,
      feePaidAt: true,
      feeAmountCents: true,
      insuranceStatus: true,
      dealerExecutedContractId: true,
      holdReason: true,
      frozenAt: true,
      buyer: { select: { id: true } },
      coBuyer: { select: { id: true, isRequiredSigner: true } },
      offer: { select: { id: true, dealerId: true, auctionId: true } },
      vehicleRequestOffer: { select: { id: true, requestId: true } },
      auction: { select: { id: true, sourcingCaseId: true, vehicleRequestId: true } },
      vehicleRequest: { select: { id: true } },
      deposit: { select: { id: true, status: true } },
      dealer: { select: { id: true } },
      dealerReaffirmations: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, confirmedVin: true, decidedAt: true },
      },
      contractVersions: {
        where: { approvedAt: { not: null } },
        orderBy: { version: "desc" },
        take: 1,
        select: { id: true, version: true },
      },
      eSignEnvelopes: { select: { signerKind: true, status: true, documentVersionId: true } },
      pickup: {
        select: {
          dealerReleasedAt: true,
          releasedBy: true,
          identityVerifiedAt: true,
          buyerConfirmedAt: true,
          vinMatch: true,
          odometerAtPossession: true,
          conditionAtPossession: true,
          possessionDiscrepancy: true,
        },
      },
      queueItems: { where: { status: "OPEN" }, select: { id: true, exceptionCode: true } },
    },
  });

  if (!deal) {
    const item: ClearanceItem = {
      key: "DEAL_READABLE",
      label: "The deal record could not be read",
      satisfied: false,
      owner: "OPERATIONS",
      detail: "Completion cannot be evaluated against a deal AutoLenis cannot load.",
    };
    return { items: [item], outstanding: [item], complete: false };
  }

  const mk = (
    key: string,
    label: string,
    owner: ClearanceOwner,
    satisfied: boolean,
    detail: string,
    notApplicable = false,
  ): ClearanceItem => ({
    key,
    label,
    satisfied: satisfied || notApplicable,
    owner,
    detail,
    ...(notApplicable ? { notApplicable: true } : {}),
  });

  // ── 2. The reference chain, hop by hop, so a failure names the LINK rather than the chain ──
  //
  // §3's orphan rule is the same idea from the other end: `lineage.service.ts` refuses to WRITE
  // a child whose parent does not resolve, and sweeps for rows that already are orphans. It is
  // not reused here because it raises a `LINEAGE_ORPHAN` exception and throws — correct for a
  // creation path, wrong for a read that runs on every page view of a buyer's pickup screen, and
  // wrong inside the completion transaction, where raising would write a queue item on every
  // evaluation. Its `CURRENT_PHASE` gate is also irrelevant to this question: lineage defers the
  // Deal class to Phase 6 because nothing wrote those columns yet, whereas a COMPLETED deal must
  // carry the chain whatever phase wrote it.
  const isConcierge = Boolean(deal.vehicleRequestOfferId) && !deal.offerId;
  const chainBreaks: string[] = [];
  if (!deal.buyer) chainBreaks.push("buyer");
  if (!deal.vehicleRequestId || !deal.vehicleRequest) chainBreaks.push("vehicle request");
  if (!deal.depositId || !deal.deposit) chainBreaks.push("payment");
  if (!deal.offerId && !deal.vehicleRequestOfferId) chainBreaks.push("selected offer");
  if (deal.offerId && !deal.offer) chainBreaks.push("selected offer");
  if (deal.vehicleRequestOfferId && !deal.vehicleRequestOffer) chainBreaks.push("selected offer");
  if (!deal.vin) chainBreaks.push("vehicle");
  if (!isConcierge) {
    // Only the auction path has these three links. Their absence on a concierge deal is not a
    // break — §2 puts AutoLenis itself in the coordinator's seat there, which is why
    // `admin/deals/[dealId]/pickup/complete` says "a concierge deal has no dealership".
    //
    // THE DEALERSHIP LINK WAS OUTSIDE THIS BLOCK AND MADE CONCIERGE COMPLETION UNREACHABLE.
    // `Deal.dealerId` is nullable and nothing in this repository ever writes it, and a concierge
    // deal has no `offer`, so both operands were null on every vehicle-request deal: the chain
    // broke on "dealership" permanently, `REFERENCE_CHAIN_INTACT` never became true, and — with
    // the admin stage dropdown's COMPLETED route now closed — the deal had no exit from
    // HANDOVER_PENDING at all. That is the exact failure the header of this file warns about.
    if (!deal.dealerId && !deal.offer?.dealerId) chainBreaks.push("dealership");
    if (!deal.auctionId || !deal.auction) chainBreaks.push("auction");
    else if (!deal.auction.sourcingCaseId) chainBreaks.push("sourcing case");
  }

  // ── 10. The approved contract version, signed by every required signer ──
  const signatures = await signatureProgress(dealId, db);
  const approvedVersion = deal.contractVersions[0] ?? null;
  const signedTheApprovedVersion =
    Boolean(approvedVersion) &&
    signatures.required.length > 0 &&
    signatures.required.every((s) =>
      deal.eSignEnvelopes.some(
        (e) => e.signerKind === s.signerKind && e.status === "COMPLETED" && e.documentVersionId === approvedVersion!.id,
      ),
    );

  const reaffirmation = deal.dealerReaffirmations[0] ?? null;
  const pickup = deal.pickup;
  const releasingDealerId = deal.dealerId ?? deal.offer?.dealerId ?? null;
  const discrepancy = readDiscrepancy(pickup?.possessionDiscrepancy);

  const items: ClearanceItem[] = [
    // 1
    mk("BUYER_IDENTIFIED", "One verified buyer and any required co-buyer identified", "OPERATIONS",
      Boolean(deal.buyer) && (!deal.coBuyerId || Boolean(deal.coBuyer)),
      !deal.buyer
        ? "The deal does not resolve to a buyer record."
        : "A co-buyer is named on this deal but the co-buyer record does not resolve."),

    // 2
    mk("REFERENCE_CHAIN_INTACT",
      "An unbroken reference chain from the Deal to its Vehicle Request, payment, sourcing case, auction, selected offer, buyer, vehicle, and dealership",
      "OPERATIONS",
      chainBreaks.length === 0,
      `The Deal cannot resolve: ${chainBreaks.join(", ")}. §3 forbids re-parenting it — an Operations decision is required.`),

    // 3
    mk("VEHICLE_VIN_BOUND", "One confirmed vehicle and VIN bound to the Deal", "DEALERSHIP",
      Boolean(deal.vin && deal.vehicleYear && deal.vehicleMake && deal.vehicleModel),
      deal.vin
        ? "A VIN is bound but the year, make or model is incomplete."
        : "No VIN is bound to this deal."),

    // 4 — CONFIRMED, and confirming a DIFFERENT VIN is not confirming this vehicle.
    // NOT APPLICABLE ON A CONCIERGE DEAL, and this is the sixth `mk` argument doing the work the
    // header of this file describes. `openReaffirmationWindow` returns `{created:false}` for a
    // deal with no offer — there is no dealership to ask — so a concierge deal can never carry a
    // reaffirmation row. Marking it OUTSTANDING made completion unreachable; marking it
    // SATISFIED would claim a check that never ran. It renders, and it says it does not apply.
    mk("DEALER_REAFFIRMED", "The winning dealership reaffirmed the transaction", "DEALERSHIP",
      reaffirmation?.status === "CONFIRMED" &&
        (!reaffirmation.confirmedVin || !deal.vin || reaffirmation.confirmedVin === deal.vin),
      isConcierge
        ? "A concierge deal has no winning dealership to reaffirm — AutoLenis is the coordinator."
        : !reaffirmation
          ? "The dealership has not been asked to reaffirm, or has not answered."
          : reaffirmation.status !== "CONFIRMED"
            ? `The dealership's reaffirmation is ${reaffirmation.status}.`
            : "The dealership reaffirmed a different VIN from the one bound to this deal.",
      isConcierge),

    // 5 — the owner is whichever party still owes the confirmation.
    mk("RECAP_CONFIRMED_BOTH", "The final recap confirmed by both parties",
      deal.recapConfirmedByBuyerAt ? "DEALERSHIP" : "BUYER",
      Boolean(deal.recapConfirmedByBuyerAt && deal.recapConfirmedByDealerAt),
      !deal.recapConfirmedByBuyerAt && !deal.recapConfirmedByDealerAt
        ? "Neither party has confirmed the final recap."
        : !deal.recapConfirmedByBuyerAt
          ? "The buyer has not confirmed the final recap."
          : "The dealership has not confirmed the final recap."),

    // 6
    mk("FINANCING_OR_CASH", "Financing completed, or cash confirmed", "FINANCE",
      Boolean(deal.financingCompletedAt),
      "Financing has not been recorded as completed, and cash has not been confirmed."),

    // 7
    mk("FUNDING_CLEARED", "Funding cleared", "FINANCE",
      Boolean(deal.fundingClearedAt),
      "Funding clearance has not been recorded."),

    // 8 — RESOLVED, not merely charged. A deal that owes nothing is resolved; a deal that owes
    //     something and has not paid it is not. The $99 plan payment is the DEPOSIT and is
    //     checked by the chain above as "payment" — this is the AutoLenis fee on the deal.
    mk("FEES_RESOLVED", "AutoLenis fees resolved", "FINANCE",
      !deal.feeAmountCents || deal.feeAmountCents === 0 || Boolean(deal.feePaidAt),
      `An AutoLenis fee of ${formatCents(deal.feeAmountCents)} is recorded on this deal and has not been paid.`),

    // 9
    mk("INSURANCE_VERIFIED", "Insurance verified or policy bound", "BUYER",
      INSURANCE_SATISFIED.includes(deal.insuranceStatus),
      "Proof of insurance has not been verified. An upload is not approval."),

    // 10 — THE EXACT version. An envelope completed against a superseded version is a signature
    //      on a document that is not the one being completed.
    mk("CONTRACT_SIGNED_BY_ALL", "The exact approved contract version signed by every required signer", "BUYER",
      signedTheApprovedVersion,
      !approvedVersion
        ? "No contract version on this deal has been approved."
        : signatures.required.length === 0
          ? "The required signers for this deal could not be determined."
          : signatures.blocked.length > 0
            ? `A required signature is ${signatures.blocked.join(", ")} — declined, voided or expired.`
            : signatures.outstanding.length > 0
              ? `Outstanding signatures: ${signatures.outstanding.join(", ")}.`
              : `Every required signer has signed, but not all against approved version ${approvedVersion.version}.`),

    // 11
    mk("EXECUTED_CONTRACT_STORED", "The dealership's fully executed contract stored", "DEALERSHIP",
      Boolean(deal.dealerExecutedContractId),
      "The dealership's fully executed copy is not on file."),

    // 12 — BY THE CORRECT DEALERSHIP. `releasedBy` carries the id of whoever recorded the
    //      release, which on the scan path is the authenticated dealership. A concierge deal has
    //      no dealership, so "the correct dealership" does not apply to it — the release is still
    //      required, and is checked by the first clause.
    mk("RELEASED_BY_DEALERSHIP", "The vehicle released by the correct dealership", "DEALERSHIP",
      Boolean(pickup?.dealerReleasedAt) &&
        (!releasingDealerId || !pickup?.releasedBy || pickup.releasedBy === releasingDealerId),
      !pickup?.dealerReleasedAt
        ? "No dealership release has been recorded for this vehicle."
        : "The release was recorded by a party other than the dealership on this deal."),

    // 13 — all four facts §Stage 19 collects, not just the confirmation timestamp. Mileage and
    //      condition are what make the record evidence rather than an acknowledgement.
    mk("POSSESSION_CONFIRMED", "Buyer possession, VIN, mileage, and condition confirmed", "BUYER",
      Boolean(pickup?.buyerConfirmedAt) &&
        pickup?.vinMatch === true &&
        pickup?.odometerAtPossession !== null &&
        pickup?.odometerAtPossession !== undefined &&
        Boolean(pickup?.conditionAtPossession),
      !pickup?.buyerConfirmedAt
        ? "The buyer has not confirmed possession."
        : pickup.vinMatch !== true
          ? "The buyer did not confirm the VIN on the vehicle matches the contract."
          : pickup.odometerAtPossession === null || pickup.odometerAtPossession === undefined
            ? "The mileage at possession was not recorded."
            : "The condition as delivered was not recorded."),

    // 14
    mk("NO_HOLD_OR_DISCREPANCY", "No blocking hold or unresolved delivery discrepancy", "OPERATIONS",
      !deal.holdReason && !deal.frozenAt && deal.queueItems.length === 0 && !discrepancy?.material,
      deal.frozenAt
        ? "This deal is frozen pending release."
        : deal.holdReason
          ? `A hold is recorded on this deal: ${deal.holdReason}`
          : deal.queueItems.length > 0
            ? `${deal.queueItems.length} open exception(s) must be resolved: ${deal.queueItems.map((q) => q.exceptionCode).join(", ")}.`
            : `A material delivery discrepancy is unresolved: ${discrepancy?.note ?? "reported by the buyer"}.`),
  ];

  const outstanding = items.filter((i) => !i.satisfied && !i.notApplicable);
  return { items, outstanding, complete: outstanding.length === 0 };
}

function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}

/** The buyer's discrepancy report, as `confirmPossession` writes it. Unreadable JSON is not a
 *  reason to complete a deal, so anything unparseable reads as a material discrepancy. */
function readDiscrepancy(value: unknown): { material: boolean; note?: string } | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return { material: true };
  const rec = value as Record<string, unknown>;
  return {
    material: rec.material === true,
    note: typeof rec.note === "string" ? rec.note : undefined,
  };
}
