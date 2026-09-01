import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { getStripe } from "@/lib/stripe";
import { scheduleLifecycleWorkload } from "@/lib/services/crm/lifecycle-scheduler";
import { limitPaymentIntent, clientIpKey } from "@/lib/security/rate-limit";
import { isPrequalValid } from "@/lib/services/prequal/prequal.service";
import { cancelPreCheckoutTouches } from "@/lib/services/crm/lifecycle-touch-drain.service";

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Card-testing guard: throttle intent creation per buyer and per source IP.
  // Fails CLOSED on limiter-store outage (see lib/security/rate-limit.ts).
  for (const key of [`deposit:buyer:${buyer.id}`, `deposit:ip:${clientIpKey(request.headers)}`]) {
    const rl = await limitPaymentIntent(key);
    if (!rl.ok) return errorResponse("RATE_LIMITED", rl.message, rl.status);
  }

  // Concierge convergence path: when a reviewToken is supplied, this deposit
  // unlocks an admin-curated set of dealer offers (System B) rather than
  // launching a live reverse auction. The concierge buyer has a VehicleOffer,
  // not a prequal + shortlist — so those gates are replaced by a strict
  // buyer↔offer binding (the authenticated buyer's email must match the review
  // the admin sent). A settled concierge deposit is converted to a CLOSED
  // auction with canonical Offers by the Stripe webhook.
  let conciergeVehicleOfferId: string | null = null;
  let conciergeReviewToken: string | null = null;
  {
    let body: { reviewToken?: unknown } = {};
    try { body = (await request.json()) as { reviewToken?: unknown }; } catch { /* no body — standard path */ }
    const reviewToken = typeof body?.reviewToken === "string" ? body.reviewToken.trim() : "";
    if (reviewToken) {
      const review = await prisma.buyerOfferReview.findUnique({
        where: { reviewToken },
        select: { buyerEmail: true, expiresAt: true, vehicleOfferId: true },
      });
      if (!review) return errorResponse("REVIEW_NOT_FOUND", "Offer review link not found", 404);
      if (review.expiresAt && review.expiresAt < new Date()) {
        return errorResponse("REVIEW_EXPIRED", "This offer review link has expired", 410);
      }
      const buyerRow = await prisma.buyer.findUnique({
        where: { id: buyer.id },
        select: { user: { select: { email: true } } },
      });
      const buyerEmail = buyerRow?.user?.email?.trim().toLowerCase() ?? "";
      if (!buyerEmail || buyerEmail !== review.buyerEmail.trim().toLowerCase()) {
        // The signed-in account must be the buyer the offers were sent to.
        return errorResponse("REVIEW_FORBIDDEN", "This offer was sent to a different account. Sign in with the email the offers were sent to.", 403);
      }
      conciergeVehicleOfferId = review.vehicleOfferId;
      conciergeReviewToken = reviewToken;
    }
  }

  if (!conciergeReviewToken) {
    // D1: Verify prequal is valid before allowing deposit. Uses the platform
    // single-source-of-truth (decision === APPROVED AND not expired) rather than
    // an expiry-only check — a future-dated DECLINED/PENDING/MANUAL_REVIEW record
    // must not pass this gate (defense-in-depth behind the layout gate).
    const prequal = buyer.preQualification;
    if (!isPrequalValid(prequal ?? null)) {
      return errorResponse("PREQUAL_REQUIRED", "Valid prequalification required before deposit", 400);
    }

    // Auction activation precondition: the buyer must have at least one vehicle on
    // their shortlist — there must be something for dealers to compete over. Paying
    // the deposit launches the auction, so this gate belongs before payment.
    const shortlistCount = await prisma.shortlistItem.count({
      where: { shortlist: { buyerId: buyer.id } },
    });
    if (shortlistCount === 0) {
      return errorResponse(
        "SHORTLIST_REQUIRED",
        "Add at least one vehicle to your shortlist before activating your auction.",
        400,
      );
    }
  }

  // Check for existing active deposit
  const existingDeposit = await prisma.deposit.findFirst({
    where: { buyerId: buyer.id, status: { in: ["PENDING", "PAID"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existingDeposit?.status === "PAID") {
    return errorResponse("ALREADY_PAID", "Deposit already paid for this buyer", 400);
  }

  // Sandbox short-circuit: if a live Stripe key is configured outside production,
  // return a mock client secret so the UI can proceed without exposing real Stripe.
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  const isLiveKey = stripeKey.startsWith("sk_live_");
  const isSandboxRuntime = process.env.NODE_ENV !== "production";
  if (isLiveKey && isSandboxRuntime) {
    logger.warn("WARNING: Using live Stripe key in sandbox mode — returning mock intent.");
    // Reuse an existing mock so the buyer doesn't accumulate orphan PENDING rows.
    if (existingDeposit?.stripePaymentIntentId?.startsWith("pi_sandbox_mock_")) {
      return successResponse({ clientSecret: "pi_sandbox_mock_secret", mock: true });
    }
    const mockIntentId = `pi_sandbox_mock_${Date.now()}`;
    await prisma.deposit.create({
      data: {
        buyerId: buyer.id,
        amountCents: DEPOSIT_AMOUNT_CENTS,
        status: "PENDING",
        stripePaymentIntentId: mockIntentId,
      },
    });
    return successResponse({
      clientSecret: "pi_sandbox_mock_secret",
      mock: true,
    });
  }

  try {
    // If a PENDING deposit row already has a live Stripe PI attached, reuse
    // that intent rather than creating a parallel one. Stripe idempotency
    // keys live for 24h, so on a same-day retry create() would return the
    // same PI anyway — but the original `client_secret` is not echoed back
    // by Stripe on a key hit, so we have to retrieve it explicitly here to
    // avoid the unique-index P2002 on Deposit.stripePaymentIntentId.
    if (existingDeposit?.stripePaymentIntentId) {
      const existingPi = await getStripe().paymentIntents.retrieve(
        existingDeposit.stripePaymentIntentId,
      );
      const isReusable =
        existingPi.status === "requires_payment_method" ||
        existingPi.status === "requires_confirmation" ||
        existingPi.status === "requires_action";
      // Only reuse a PENDING intent whose type matches the path being requested —
      // a lingering standard-deposit PI must not be served to a concierge request
      // (its webhook branch, metadata, and downstream auction differ), and vice
      // versa. For the concierge path we additionally require the PI to be bound
      // to the SAME review: the buyer↔offer binding is strict, and reusing a PI
      // stamped with a different reviewToken would make the webhook convert the
      // wrong review on payment. A mismatched PI falls through to a fresh create
      // below (whose idempotency key is scoped by reviewToken).
      const pathType = conciergeReviewToken ? "concierge_deposit" : "deposit";
      const typeMatches = (existingPi.metadata?.type ?? "deposit") === pathType;
      const reviewMatches =
        !conciergeReviewToken || existingPi.metadata?.reviewToken === conciergeReviewToken;
      if (isReusable && existingPi.client_secret && typeMatches && reviewMatches) {
        return successResponse({ clientSecret: existingPi.client_secret });
      }
      // PI is in a terminal state (canceled/failed) — mark deposit failed
      // and fall through to create a fresh one below.
      if (existingPi.status === "canceled" || existingDeposit.status !== "PENDING") {
        await prisma.deposit.update({
          where: { id: existingDeposit.id },
          data: { status: "FAILED" },
        });
      }
    }

    // Amount is hardcoded server-side — NEVER accept from frontend (price manipulation prevention).
    // Idempotency key is bucketed by UTC day so that two near-simultaneous clicks
    // share a PI, but a buyer returning the next day gets a fresh intent (the
    // previous day's PI may already be canceled by Stripe's automatic timeout).
    const dayKey = new Date().toISOString().slice(0, 10);
    // Concierge deposits carry type "concierge_deposit" + the source vehicleOfferId
    // so the webhook converts them to a CLOSED auction with canonical offers,
    // rather than launching a live reverse auction. Distinct idempotency bucket so
    // a concierge intent never collides with a standard one for the same buyer.
    const metadata: Record<string, string> = conciergeReviewToken
      ? {
          buyerId: buyer.id,
          type: "concierge_deposit",
          reviewToken: conciergeReviewToken,
          ...(conciergeVehicleOfferId ? { vehicleOfferId: conciergeVehicleOfferId } : {}),
        }
      : { buyerId: buyer.id, type: "deposit" };
    // Scope the concierge idempotency bucket by the specific review so two
    // different reviews for the same buyer never collapse onto one PI/auction.
    const idempotencyKey = conciergeReviewToken
      ? `concierge-deposit-buyer-${buyer.id}-${conciergeReviewToken}-${dayKey}`
      : `deposit-buyer-${buyer.id}-${dayKey}`;
    const paymentIntent = await getStripe().paymentIntents.create(
      {
        amount: DEPOSIT_AMOUNT_CENTS, // $99 hardcoded
        currency: "usd",
        metadata,
      },
      { idempotencyKey },
    );

    // upsert protects against the race where a concurrent retry already
    // wrote a Deposit row for this PI (unique on stripePaymentIntentId).
    await prisma.deposit.upsert({
      where: { stripePaymentIntentId: paymentIntent.id },
      create: {
        buyerId: buyer.id,
        amountCents: DEPOSIT_AMOUNT_CENTS,
        status: "PENDING",
        stripePaymentIntentId: paymentIntent.id,
      },
      update: {},
    });

    // CONCIERGE EXCLUSION (Section 2): concierge deposits (reviewToken present)
    // have their own review-link CTA and must NEVER also receive the generic
    // "$99 deposit" reminder sequence or the abandoned-deposit nurture. Only the
    // normal competitive path enrolls — everything below is gated on !concierge.
    if (!conciergeReviewToken) {
      // Start the $99 deposit-conversion reminder via the lifecycle scheduler.
      // THIS IS THE SINGLE ENROLLMENT OWNER for the chain — onboarding/complete
      // used to enroll too and claimed the touch-1 row before any deposit existed.
      // Routing is the internal lifecycle_touch plane, unconditionally (no flag).
      // Self-stops once the deposit is PAID (send-time guard), so re-creating an
      // intent is safe.
      const buyerContact = await prisma.buyer.findUnique({
        where: { id: buyer.id },
        select: { firstName: true, lastName: true, phone: true, user: { select: { email: true } } },
      });
      if (buyerContact?.user?.email) {
        // Best-effort tail — never affects the payment response.
        scheduleLifecycleWorkload({
          workload: "deposit_reminder",
          buyerId: buyer.id,
          firstName: buyerContact.firstName,
          email: buyerContact.user.email,
          phone: buyerContact.phone,
        }).catch((err) => logger.error("[deposit/create-intent] reminder enrollment failed:", err));
      }

      // HANDOFF: a competitive PENDING deposit now exists → the pre-checkout stage
      // hands off to deposit_reminder. Cancel any remaining pre-checkout touches so
      // the two stages never run against the same buyer at once (the send-time
      // preCheckoutResolved guard is the authoritative backstop). Best-effort.
      cancelPreCheckoutTouches(buyer.id).catch((err) =>
        logger.error("[deposit/create-intent] pre-checkout cancel failed:", err),
      );

      // F-037 — emit the deposit_pending domain event. It was defined in the
      // WorkflowTriggerType union but never fired, so the prebuilt 1h→24h→72h
      // abandoned-deposit nurture (workflow.prebuilt.ts) was dead. Emitting it
      // here (deposit intent created, not yet paid) revives that recovery
      // sequence. Tail call: never throws, never affects the payment response.
      if (buyerContact) {
        try {
          const { emitDomainEvent } = await import("@/lib/events/emit");
          await emitDomainEvent("deposit_pending", {
            domainEntityId: buyer.id,
            contact: {
              email: buyerContact.user?.email ?? null,
              phone: buyerContact.phone,
              firstName: buyerContact.firstName,
              lastName: buyerContact.lastName,
              source: "buyer_signup",
            },
            data: {
              buyer_id: buyer.id,
              amount_cents: DEPOSIT_AMOUNT_CENTS,
              deposit_url: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/buyer/deposit`,
            },
          });
        } catch (err) {
          logger.error("[deposit/create-intent] deposit_pending emit failed:", err);
        }
      }
    }

    return successResponse({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    logger.error("[deposit/create-intent] Stripe error:", err);
    return errorResponse("STRIPE_ERROR", "Payment service unavailable. Please try again.", 503);
  }
}
