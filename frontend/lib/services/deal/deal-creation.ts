// lib/services/deal/deal-creation.ts
//
// THE RECORD EVERY NEW DEAL CARRIES, written once (Phase 6, Stage 9 / §9a).
//
// Two buyer paths create a Deal and §10.7 row D2 records them as a duplication:
//
//   lib/services/deal/select-offer.service.ts                    the auction path, under the lock
//   app/api/buyer/requests/[requestId]/offer/respond/route.ts    the VehicleRequestOffer path
//
// (A third, `POST /api/admin/deals`, is retired by defect 3 — §9 forbids an administrator
// selecting on the buyer's behalf.)
//
// The two paths bind different objects — the auction path has a dealership, a rooftop, a VIN and a
// deposit; the request path has a staff-entered price and no dealer at all — so they cannot share
// a single "create the Deal" function without one of them pretending to lineage it does not have.
// What they DO share is everything that must be true of any new Deal regardless of its origin:
// its first history row, its locked plan snapshot, and the trade packet following it. That is what
// lives here, so the two paths cannot drift on it.
//
// Row L4b retires `VehicleRequestOffer` into the canonical spine at Phase 10. Until then this is
// the seam that keeps both origins honest.

import { DealStatus, type BuyerPlan, type Prisma } from "@prisma/client";
import { recordDealPlanSnapshot } from "@/lib/services/buyer/plan-snapshot.service";
import type { PlanTouchpoint } from "@/lib/services/buyer/plan-snapshot.service";

type Tx = Prisma.TransactionClient;

export interface DealCreationRecordParams {
  dealId: string;
  buyerId: string;
  /** The buyer's plan at the moment of creation — snapshotted, not referenced. */
  plan: BuyerPlan;
  vehicleRequestId?: string | null;
  /** Who acted. `BUYER` on both selection paths; §9 admits no other actor. */
  actorRole?: string;
  /** Why, in the timeline's own words. */
  reason: string;
  entryStatus?: DealStatus;
  touchpoint?: PlanTouchpoint;
  now?: Date;
}

/**
 * Write the creation record for a Deal that already exists in this transaction.
 *
 * MUST run inside the caller's transaction. The plan snapshot is not optional decoration: the
 * composite FK `deals.(id, current_plan_snapshot_id) -> plan_snapshots.(deal_id, id)` means a Deal
 * committed without it has incomplete lineage that nothing later can reconstruct, because the plan
 * in force is a fact about a moment that has passed.
 *
 * Order is forced by that FK — Deal, then snapshot naming the Deal, then Deal re-pointed at the
 * snapshot. `recordDealPlanSnapshot` owns those last two steps.
 */
export async function writeDealCreationRecord(
  tx: Tx,
  params: DealCreationRecordParams,
): Promise<void> {
  const entryStatus = params.entryStatus ?? DealStatus.DEALER_CONFIRMATION;

  // The transition INTO the first state. Every later transition writes history through
  // `advanceDealStatus`; creation had no writer at all, so a Deal's own beginning was the one
  // event missing from its timeline. `fromStatus` is the sentinel "NONE" rather than a real
  // DealStatus, because there was no prior state and inventing one would misread as a transition.
  await tx.dealStatusHistory.create({
    data: {
      dealId: params.dealId,
      fromStatus: "NONE",
      toStatus: entryStatus,
      actorId: params.buyerId,
      actorRole: params.actorRole ?? "BUYER",
      reason: params.reason,
    },
  });

  // §9a's thirteenth lineage item; §11.6 ruling 8's Phase 6 half.
  await recordDealPlanSnapshot(
    {
      dealId: params.dealId,
      buyerId: params.buyerId,
      plan: params.plan,
      vehicleRequestId: params.vehicleRequestId ?? null,
      actor: "buyer",
      touchpoint: params.touchpoint ?? "deal_created",
      reason: "Plan in force when the Deal was created (§9a).",
      effectiveAt: params.now,
    },
    tx,
  );

  // The trade packet follows the Deal (§9a lineage). Scoped to this buyer's own request, and only
  // to submissions not already bound, so a replay cannot steal another Deal's trade.
  if (params.vehicleRequestId) {
    await tx.tradeInSubmission.updateMany({
      where: { vehicleRequestId: params.vehicleRequestId, dealId: null },
      data: { dealId: params.dealId },
    });
  }
}
