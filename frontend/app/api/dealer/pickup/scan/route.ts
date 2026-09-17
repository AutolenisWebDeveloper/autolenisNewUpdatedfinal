// POST /api/dealer/pickup/scan — the dealership scans the buyer's release code to record HANDOVER.
// Body: { qrToken: string, identityVerified: boolean, odometerAtRelease?, conditionAtRelease?,
//          fundsCollectedMethod?, tradeReceived? } — qrToken is the RAW release token as scanned.
// On success: the token is consumed, pickup.status=RELEASED, deal.status=HANDOVER_PENDING, the
// §Stage 18 release evidence is recorded, and the buyer's possession-confirmation request is
// queued in comms_outbox inside the same transaction. THE DEAL IS NOT COMPLETED HERE.
//
// WHAT CHANGED, 2026-09-16. This route used to resolve the scanned string by equality against
// `pickups.qr_code_data` — a plaintext credential, seeded from `Math.random()`, that a database
// read handed straight back. It now resolves through `release-token.service.resolveReleaseToken`:
// SHA-256 lookup, expiry bound to the appointment rather than to the minting moment, and a
// compare-and-swap consume that makes the code single-use under genuine concurrency rather than
// only in sequence. `pickups.qr_expires_at` is no longer consulted — the token carries its own
// expiry and two expiries that can disagree is one too many.

import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import {
  INSURANCE_SATISFIED,
  InsuranceRequiredError,
  ReleaseNotClearedError,
} from "@/lib/services/deal/deal.service";
import { recordDealerRelease } from "@/lib/services/pickup/pickup-completion.service";
import {
  resolveReleaseToken,
  type ReleaseTokenReason,
} from "@/lib/services/pickup/release-token.service";

/**
 * What a scanner is told about a code that resolved to nothing usable.
 *
 * These answers are given BEFORE ownership is known, so each one has to be safe in the hands of
 * whoever presented the token. They are, because a release token is now 256 bits of CSPRNG
 * output: reaching any of these branches is proof the caller HOLDS a real credential, and telling
 * the holder of a credential about that credential discloses nothing they did not already have.
 * That was not true of the Math.random payload this replaces, which is exactly why the old code
 * collapsed everything into one opaque answer.
 *
 * The concierge / wrong-dealer collapse below is a DIFFERENT question and is untouched: it is
 * about a deal the caller does not own, and no token grants that.
 */
const TOKEN_REJECTIONS: Record<ReleaseTokenReason, { code: string; message: string; status: number }> = {
  not_found: { code: "INVALID_TOKEN", message: "This pickup code is not valid.", status: 422 },
  consumed: { code: "ALREADY_SCANNED", message: "This pickup code has already been scanned.", status: 409 },
  revoked: {
    code: "INVALID_TOKEN",
    message: "This pickup code was cancelled — the buyer can show a new one from their pickup page.",
    status: 422,
  },
  expired: {
    code: "INVALID_TOKEN",
    message: "This pickup code has expired — the buyer can show a new one from their pickup page.",
    status: 422,
  },
  pickup_not_releasable: {
    code: "NOT_READY_FOR_PICKUP",
    message: "This pickup is not in a state where the vehicle can be released.",
    status: 409,
  },
};

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = (await request.json().catch(() => ({}))) as {
    qrToken?: string;
    identityVerified?: boolean;
    odometerAtRelease?: number;
    conditionAtRelease?: string;
    fundsCollectedMethod?: string;
    tradeReceived?: boolean;
  };
  const qrToken = body.qrToken?.trim();
  if (!qrToken) return errorResponse("VALIDATION_ERROR", "qrToken is required", 400);

  // READ-ONLY. A scanner that reads a code twice must not spend it by looking; the consume is a
  // separate compare-and-swap, below, after the deal has actually advanced.
  const resolved = await resolveReleaseToken(qrToken);
  if (!resolved.ok) {
    const r = TOKEN_REJECTIONS[resolved.reason];
    return errorResponse(r.code, r.message, r.status);
  }

  const pickup = await prisma.pickup.findUnique({
    where: { id: resolved.view.pickupId },
    select: {
      id: true,
      dealId: true,
      status: true,
      deal: {
        select: {
          status: true,
          buyerId: true,
          insuranceStatus: true,
          offer: { select: { dealerId: true } },
          buyer: { select: { firstName: true, user: { select: { email: true } } } },
        },
      },
    },
  });
  // The token resolved a moment ago, so this is a row deleted mid-request rather than a bad code.
  if (!pickup) return errorResponse("INVALID_TOKEN", "This pickup code is not valid.", 422);

  // Authorization: the token must belong to THIS dealer's deal. A concierge
  // (vehicle-request) deal has no Offer, and VehicleRequestOffer carries no dealer
  // identity — so it has no dealer at all and can never be scanned by anyone; it is
  // completed by AutoLenis staff via the admin pickup-completion route.
  //
  // Both cases still return the SAME response, and the reason has outlived the one the original
  // comment gave (that the QR nonce was guessable). Possession of a token proves possession of a
  // token; it proves nothing about entitlement to the DEAL behind it. A dealer holding a code
  // that is not theirs — photographed at another lot, forwarded, mis-scanned — must not learn
  // from us whether the deal it belongs to has a dealership at all. The distinction is logged
  // server-side instead, where support can actually use it.
  const dealDealerId = pickup.deal.offer?.dealerId ?? null;
  if (dealDealerId !== dealer.id) {
    if (dealDealerId === null) {
      logger.warn(
        `[pickup/scan] dealer ${dealer.id} scanned concierge deal ${pickup.dealId} — no dealer on deal; completed by AutoLenis staff`,
      );
    }
    return errorResponse("INVALID_TOKEN", "QR code is not valid for this dealer.", 422);
  }

  if (pickup.status === "COMPLETED" || pickup.deal.status === "COMPLETED") {
    return errorResponse("ALREADY_SCANNED", "This QR code has already been scanned.", 409);
  }

  // Insurance hard gate — a vehicle cannot be released/completed without proof of
  // insurance on file (a bound platform policy, verified, or the buyer's own-policy
  // upload). This is the final-release gate; earlier stages are not blocked.
  if (!INSURANCE_SATISFIED.includes(pickup.deal.insuranceStatus)) {
    return errorResponse(
      "INSURANCE_REQUIRED",
      "Insurance proof is required before this pickup can be completed.",
      409,
    );
  }

  const releasedAt = new Date();

  // THE CODE IS SPENT INSIDE THE RELEASE TRANSACTION, not here.
  //
  // Consuming before the gates run burns the buyer's credential on a handover that is still
  // blocked — funding not cleared, executed contract missing, insurance withdrawn are all
  // conditions the DEALERSHIP or AutoLenis has to fix while the buyer stands there. Consuming
  // after would let a second scan record a second release before the first spent the code.
  // `recordDealerRelease` takes the raw token and spends it in the same transaction that writes
  // the handover, so a refused release rolls the spend back and a concurrent scan loses cleanly.

  // RECORD THE HANDOVER. NOT THE COMPLETION.
  //
  // §8.2 defect (3): this route used to advance the Deal straight to COMPLETED as a `DEALER`
  // actor. §Stage 19 forbids it in as many words — "the Deal never completes automatically on
  // the dealer's word alone" — so the scan records the release and the BUYER's possession
  // confirmation completes. The transition map no longer offers the old edge either, so this is
  // closed structurally and not only by this route's good behaviour.
  let outcome;
  try {
    outcome = await recordDealerRelease({
      dealId: pickup.dealId,
      dealerId: dealer.id,
      pickupId: pickup.id,
      rawToken: qrToken,
      identityVerified: body.identityVerified === true,
      odometerAtRelease: typeof body.odometerAtRelease === "number" ? body.odometerAtRelease : null,
      conditionAtRelease: typeof body.conditionAtRelease === "string" ? body.conditionAtRelease : null,
      fundsCollectedMethod: typeof body.fundsCollectedMethod === "string" ? body.fundsCollectedMethod : null,
      tradeReceived: body.tradeReceived === true,
      now: releasedAt,
    });
  } catch (err) {
    // The three release gates run again INSIDE the release transaction, against the row as read.
    // Proof can be withdrawn between the pre-check above and the write.
    if (err instanceof InsuranceRequiredError) {
      return errorResponse("INSURANCE_REQUIRED", "Insurance proof is required before this vehicle can be released.", 409);
    }
    if (err instanceof ReleaseNotClearedError) {
      return errorResponse("RELEASE_NOT_CLEARED", err.message, 409);
    }
    throw err;
  }

  if (!outcome.ok) {
    if (outcome.reason === "identity_unverified") {
      // §Stage 18's first named failure. The exception is already raised with an owner; the
      // dealer is told plainly rather than being handed a generic refusal.
      return errorResponse(
        "IDENTITY_NOT_VERIFIED",
        "Confirm the buyer's identity against the contract before releasing the vehicle. Operations has been notified.",
        409,
      );
    }
    if (outcome.reason === "not_scheduled") {
      return errorResponse("NOT_READY_FOR_PICKUP", "This deal is not ready for handover.", 409);
    }
    if (outcome.reason === "code_already_spent") {
      // Another scan won the compare-and-swap inside the transaction. Nothing was written by
      // this request — the rollback is the whole point of spending the code in there.
      return errorResponse("ALREADY_SCANNED", "This pickup code has already been used.", 409);
    }
    return errorResponse("INVALID_TOKEN", "This pickup code is not valid.", 422);
  }

  // NO EMAIL IS SENT FROM HERE — §8.2 defect (7). The completion mail used to go out inline
  // through Resend with no idempotency key and, worse, un-awaited: `resend?.emails.send(...)`
  // without `await` can be dropped entirely when the serverless function returns. The buyer's
  // possession-confirmation request is queued in `comms_outbox` inside the release transaction,
  // so it survives a crash and retries on its own.

  return successResponse({
    success: true,
    dealId: pickup.dealId,
    status: "HANDOVER_PENDING",
    releasedAt: outcome.releasedAt.toISOString(),
    alreadyReleased: outcome.alreadyReleased,
    awaitingBuyerConfirmation: true,
  });
}
