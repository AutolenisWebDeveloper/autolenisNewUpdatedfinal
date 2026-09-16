// POST /api/dealer/pickup/scan — dealer scans the buyer's release code to mark the deal COMPLETED.
// Body: { qrToken: string }  — the RAW release token, exactly as scanned.
// On success: the token is consumed, pickup.status=COMPLETED, deal.status=COMPLETED,
// BuyerActivityEvent emitted, Resend completion email fired (best-effort).
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
  advanceDealStatus,
  DealTransitionError,
  InsuranceRequiredError,
  ReleaseNotClearedError,
} from "@/lib/services/deal/deal.service";
import {
  resolveReleaseToken,
  consumeReleaseToken,
  type ReleaseTokenReason,
} from "@/lib/services/pickup/release-token.service";
import { Resend } from "resend";

// Lazy Resend client — constructed on first use. Prevents Next.js build-time
// page data collection from throwing when RESEND_API_KEY isn't set.
let resendInstance: Resend | null = null;
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) return null;
  if (!resendInstance) resendInstance = new Resend(apiKey);
  return resendInstance;
}

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

  const body = await request.json().catch(() => ({}));
  const qrToken = (body as { qrToken?: string }).qrToken?.trim();
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

  const completedAt = new Date();

  // Route the lifecycle transition through the guarded seam (enforces canTransition
  // + the insurance gate; records DealStatusHistory). The pickup record + completion
  // activity event are written after the deal has advanced.
  try {
    await advanceDealStatus(pickup.dealId, "COMPLETED", { actorRole: "DEALER", reason: "Dealer QR pickup scan" });
  } catch (err) {
    if (err instanceof DealTransitionError) {
      return errorResponse("NOT_READY_FOR_PICKUP", "This deal is not ready for pickup completion.", 409);
    }
    // The seam re-checks the insurance hard gate at write time. Proof can be
    // withdrawn between our pre-check above and the advance, so map that rejection
    // to the same truthful 409 rather than letting it surface as a 500.
    if (err instanceof InsuranceRequiredError) {
      return errorResponse(
        "INSURANCE_REQUIRED",
        "Insurance proof is required before this pickup can be completed.",
        409,
      );
    }
    // Phase 8's release gate — the dealership's executed contract, and funding clearance.
    // Unmapped until 2026-09-15, so it fell through to the rethrow below and reached a dealer
    // standing at the vehicle as an unhandled 500. Its own code rather than INSURANCE_REQUIRED
    // because the two are owed by different people: an insurance gap is the buyer's to close,
    // this one is AutoLenis's and the dealership's. `err.message` carries which of the two.
    if (err instanceof ReleaseNotClearedError) {
      return errorResponse("RELEASE_NOT_CLEARED", err.message, 409);
    }
    throw err;
  }

  // SPEND THE CODE — and only now.
  //
  // Consuming BEFORE the advance would be the tidier concurrency story and the wrong one for the
  // people involved: every rejection above (funding not cleared, executed contract missing,
  // insurance withdrawn) is a condition the DEALERSHIP or AutoLenis has to fix while the buyer
  // stands there, and burning their code on the way past would leave them re-revealing one for a
  // handover that is still blocked. `funding_cleared_at` makes RELEASE_NOT_CLEARED the common
  // answer today, not a rare one.
  //
  // Consuming after keeps single use intact: the CAS picks exactly one winner among simultaneous
  // scans, and the loser is told the truth. Its advance was idempotent — the deal was already
  // COMPLETED by the winner — so nothing is double-applied.
  const consumed = await consumeReleaseToken(pickup.id, completedAt);
  if (!consumed) {
    return errorResponse("ALREADY_SCANNED", "This QR code has already been scanned.", 409);
  }

  await prisma.$transaction([
    prisma.pickup.update({
      where: { id: pickup.id },
      data: { status: "COMPLETED", completedAt },
    }),
    prisma.buyerActivityEvent.create({
      data: {
        buyerId: pickup.deal.buyerId,
        eventType: "DEAL_COMPLETED",
        title: "Pickup confirmed — your deal is complete",
        metadata: { dealId: pickup.dealId, completedAt: completedAt.toISOString() },
      },
    }),
  ]);

  // Best-effort completion email via Resend
  const buyerEmail = pickup.deal.buyer.user.email;
  const resend = getResend();
  resend?.emails.send({
    from: `${process.env.FROM_NAME ?? "AutoLenis"} <noreply@autolenis.com>`,
    to: buyerEmail,
    subject: "Congratulations — your AutoLenis deal is complete",
    html: `<p>Hi ${pickup.deal.buyer.firstName},</p>
           <p>Your vehicle pickup has been confirmed by the dealer. The deal is now marked as <strong>COMPLETED</strong> in your AutoLenis account.</p>
           <p>You can view your final receipt and contract at <a href="${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/buyer/deal/${pickup.dealId}/receipt">your dashboard</a>.</p>
           <p>Thank you for choosing AutoLenis.</p>`,
  }).catch(() => { /* non-fatal */ });

  // The canonical `purchase_completed` domain event is emitted EXACTLY ONCE by
  // the deal state-machine seam (advanceDealStatus → COMPLETED, above), so this
  // route no longer emits it — that keeps the completion signal single-sourced
  // and replay-safe regardless of which path completes the deal.

  return successResponse({
    success: true,
    dealId: pickup.dealId,
    completedAt: completedAt.toISOString(),
  });
}
