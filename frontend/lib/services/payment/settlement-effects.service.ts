// lib/services/payment/settlement-effects.service.ts
//
// §5d — what happens, atomically, when the $99 settles.
//
//   "On settlement, atomically: record the payment and Stripe object; attach it to the
//    Vehicle Request; mark the request fulfillment-unlocked; cancel reminders; queue the
//    receipt; open the sourcing case."
//
// This module owns the three that must be in the DATABASE transaction — unlock, open the
// case, seed its checkpoints. Recording the payment is the caller's PAID flip, already
// inside the same transaction. Cancelling reminders and queueing the receipt are
// dispatcher work and are enqueued, not sent, so they join the transaction through the
// outbox rather than as side effects that cannot be rolled back.
//
// "Attach it to the Vehicle Request" is done EARLIER — at intent creation, not at
// settlement — and the reason is §3 rather than convenience. See the note at the attach
// point below: writing a parent id onto an existing row is what §3 calls re-parenting,
// and a build-failing ratchet holds that at zero outside one audited admin action.
//
// WHAT CHANGED, AND WHY IT IS BEHIND A FLAG. Settlement used to create an `Auction`
// inside the money transaction and then launch it and invite dealers. It now opens a
// sourcing case instead — except that Phase 3 removes the only path that invites
// dealers and the replacement does not exist until Phase 5. So the legacy behaviour is
// kept, by default, behind SOURCING_CASE_REPLACES_AUCTION_LAUNCH, and every settlement
// that takes it writes a LEGACY_PATH_WRITE row. See lib/payments/settlement-flags.ts
// for what flipping it on before Phase 5 would do to a paying buyer.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { openSourcingCase } from "@/lib/services/sourcing/sourcing-case.service";
import { sourcingCaseReplacesAuctionLaunch } from "@/lib/payments/settlement-flags";
import { OPEN_REQUEST_STATUSES } from "@/lib/services/vehicle-request/open-request.service";

type Tx = Prisma.TransactionClient;

/**
 * The states a request may be unlocked FROM.
 *
 * `PAYMENT_REQUIRED` is the expected one — it is where the payment gate put it. The
 * three assembling states are included because a buyer can reach checkout, have the
 * request move on in another tab, and still pay; refusing to unlock then would take
 * their money and leave the request looking unpaid.
 *
 * Deliberately NOT the states past sourcing. A settlement arriving for a request that
 * is already at OFFER_SENT is a redelivery or a repair, and dragging it back to
 * ACTIVE_SOURCING would discard real progress.
 */
const UNLOCKABLE_FROM = ["DRAFT", "SUBMITTED", "INTAKE", "PAYMENT_REQUIRED"] as const;

export interface SettlementEffectsInput {
  depositId: string;
  buyerId: string;
  /** From `deposits.vehicle_request_id`, when the intent was created with one. */
  vehicleRequestId: string | null;
}

export interface SettlementEffectsResult {
  vehicleRequestId: string | null;
  sourcingCaseId: string | null;
  /** True when this call moved the request into ACTIVE_SOURCING. */
  unlocked: boolean;
  /**
   * True when the caller must ALSO run the legacy auction create/launch/invite, because
   * the flag is off. The caller does it rather than this module, because launching and
   * inviting are post-commit, best-effort operations and must not sit inside the money
   * transaction — a slow dealer-invitation call holding a row lock on a deposit is how
   * a burst of Stripe redeliveries exhausts the connection pool.
   */
  runLegacyAuctionPath: boolean;
}

/**
 * Resolve which Vehicle Request this settlement belongs to.
 *
 * The link should already be on the deposit — Phase 3 writes it at intent creation. The
 * fallback exists for the rows that predate that: the eight unattached deposits R1b's
 * owner-gated backfill covers, and any admin-minted row. One open request per buyer is
 * a database invariant, so "the buyer's open request" is unambiguous when it exists.
 *
 * Returns null rather than guessing when there is no open request. A settlement with no
 * request is a real condition (a concierge deposit, or a payment for a request since
 * cancelled) and the caller decides what it means; inventing a request here would attach
 * money to something arbitrary.
 */
async function resolveRequestId(input: SettlementEffectsInput, tx: Tx): Promise<string | null> {
  if (input.vehicleRequestId) return input.vehicleRequestId;

  const open = await tx.vehicleRequest.findFirst({
    where: { buyerId: input.buyerId, status: { in: [...OPEN_REQUEST_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (open) {
    logger.info(
      `[settlement] deposit ${input.depositId} carried no vehicle_request_id; resolved to the ` +
        `buyer's open request ${open.id} (pre-Phase-3 row)`,
    );
  }
  return open?.id ?? null;
}

/**
 * Apply the in-transaction half of the settlement side effect.
 *
 * MUST be called with the transaction client that performed the PAID flip. Everything
 * here has to roll back with it: a sourcing case that outlived a failed settlement would
 * show a request being sourced for money that never arrived, and that is precisely the
 * shape of failure §5d's "atomically" exists to prevent.
 */
export async function applySettlementEffects(
  input: SettlementEffectsInput,
  tx: Tx,
): Promise<SettlementEffectsResult> {
  const flagOn = sourcingCaseReplacesAuctionLaunch();
  const requestId = await resolveRequestId(input, tx);

  if (!requestId) {
    // No request to attach to, unlock or source. Not an error here — the caller knows
    // whether that is expected (concierge) or an exception to raise.
    return {
      vehicleRequestId: null,
      sourcingCaseId: null,
      unlocked: false,
      runLegacyAuctionPath: !flagOn,
    };
  }

  // ATTACH — deliberately NOT done here, and the reason is a rule rather than a
  // preference.
  //
  // §3: a record "is never silently re-parented", and the build-failing ratchet in
  // `lib/services/operations/__tests__/no-service-reparent.test.ts` holds that at zero
  // for the six record classes, `deposit.vehicleRequestId` among them. Its one
  // allowlist entry is the audited admin re-parent action — a named admin, a reason, an
  // awaited audit row carrying the previous and new values. A settlement write has none
  // of those, so putting this file on that list would have widened a §3 guard to admit
  // an unaudited system write. The guard caught it, and it was right to.
  //
  // Nothing is lost. Phase 3 writes the link at INTENT CREATION, in the `create` block
  // of the upsert — which the guard explicitly permits, because giving a NEW row its
  // parent is what §3 requires rather than what it forbids. Every deposit minted from
  // here on arrives already attached.
  //
  // What remains unattached is the pre-Phase-3 population: the eight rows R1b names,
  // whose backfill is owner-run and owner-gated. Settlement still resolves which request
  // they belong to (below) so it can unlock it and open the case — it simply does not
  // write that conclusion back onto the row. Reading a link to act on it and stamping it
  // permanently are different acts, and only the second is re-parenting.

  // UNLOCK. S6-38: "Settlement moves the request to ACTIVE_SOURCING and joins deposit ↔
  // request." Before Phase 3 the webhook never touched the VehicleRequest at all, and
  // ACTIVE_SOURCING was set BEFORE payment by the progression service — so the status
  // that §Stage 6 defines as "paid sourcing" was reachable without paying.
  const { count } = await tx.vehicleRequest.updateMany({
    where: { id: requestId, status: { in: [...UNLOCKABLE_FROM] } },
    data: { status: "ACTIVE_SOURCING" },
  });

  // OPEN THE SOURCING CASE, with its due-diligence checkpoints, in the same transaction.
  //
  // This happens whether or not the flag is on, and that is deliberate. The case is the
  // new record of what was bought; with the flag off the legacy auction is ALSO created,
  // so production keeps working while the case accumulates truthfully from day one. If
  // the case were gated too, the flip would be a cutover with no history behind it.
  const { caseId } = await openSourcingCase(requestId, tx);

  return {
    vehicleRequestId: requestId,
    sourcingCaseId: caseId,
    unlocked: count > 0,
    runLegacyAuctionPath: !flagOn,
  };
}
