import { logger } from "@/lib/logger";
import { applySettlementEffects } from "@/lib/services/payment/settlement-effects.service";
import { recordLegacyPathWrite } from "@/lib/services/comms/legacy-path-write";
import { applyFulfillmentHold, releaseFulfillmentHold, recordDisputeLost } from "@/lib/services/payment/fulfillment-hold.service";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";
import {
  sendDepositConfirmationEmail,
  sendAuctionActivatedEmail,
  sendConciergeFeeConfirmationEmail,
  sendRefundConfirmationEmail,
} from "@/lib/services/email/resend.service";
import { processFeeCommission, reverseCommissionsForPaymentIntent } from "@/lib/services/affiliate/commission.service";
import { launchAuction } from "@/lib/services/auction/auction.service";
import { inviteDealersToAuction } from "@/lib/services/auction/dealer-invitation.service";
import { getOrCreateOutsideDealerId } from "@/lib/services/offer/outside-dealer";
import { convertConciergeOfferToClosedAuction } from "@/lib/services/concierge/concierge-conversion.service";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import { writeServiceFeePayment } from "@/lib/services/deal/service-fee.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";
import { scheduleLifecycleWorkload } from "@/lib/services/crm/lifecycle-scheduler";
import { markContentConversion } from "@/lib/analytics/content-attribution.server";
import {
  SETTLE_FROM,
  DEAD_INTENT_FROM,
  REFUND_FROM,
} from "@/lib/payments/deposit-state";
import { recordWebhookRejection } from "@/lib/services/monitoring/webhook-delivery-log.service";
import { raiseException } from "@/lib/services/operations/queue-item.service";

// PaymentIntent metadata types this endpoint can actually fulfil. A
// signature-valid payment whose type is not in this set is a real charge the
// platform cannot route — acknowledged (retrying cannot fix bad metadata) but
// never silently, because "200 OK and nothing happened" is exactly how a broken
// money path stays invisible.
const ROUTABLE_PI_TYPES = new Set(["deposit", "concierge_deposit", "concierge_fee", "service_fee"]);

// The payment half of §3's orphan rule, and §26's "Payment unroutable to an
// obligation — Finance — Immediate exception; never absorbed".
//
// MIGRATED ONTO THE SINGLE EXCEPTION WRITER (Phase 2). Three defects went with the
// old implementation, and each mattered:
//
//   1. Dedup was a read-then-write on an exact TITLE string — two concurrent
//      webhook deliveries for the same intent both read "not found" and both
//      inserted. `raiseException` dedups on a real unique index instead, and the
//      key here is the PaymentIntent id, so a Stripe redelivery collapses.
//   2. It wrote a `Notification` with `actionUrl: "/admin/operations"` — a page
//      that renders NO notifications (verified: zero references in
//      `app/admin/operations/page.tsx`). The alert was reachable only through the
//      `/admin/queues` "system" tab, so the instruction pointed at a dead end.
//      A `queue_items` row is read by the operations queue by construction.
//   3. It carried no owner. §26 assigns this exception to FINANCE, and
//      `Notification` has no column to say so. `queue_items.owner_role` does.
//
// Still best-effort at the CALL SITE, deliberately: alerting must never fail an
// already-acknowledged webhook, or Stripe retries a delivery that did have an
// effect. The writer itself throws — the swallow is here, where the trade-off is
// visible, rather than hidden inside the writer.
async function raiseUnroutablePaymentException(pi: Stripe.PaymentIntent, reason: string) {
  try {
    await raiseException({
      code: "PAYMENT_UNROUTABLE",
      // Located by stored reference, never by name/email/phone (§3). The deposit
      // this intent should have belonged to is exactly what could not be found, so
      // the buyer reference is resolved from the intent's own metadata when Stripe
      // carried one, and the exception is keyed on the intent either way.
      buyerId: typeof pi.metadata?.buyerId === "string" ? pi.metadata.buyerId : null,
      depositId: typeof pi.metadata?.depositId === "string" ? pi.metadata.depositId : null,
      idempotencyKey: `PAYMENT_UNROUTABLE:${pi.id}`,
      detail:
        `Stripe reported payment_intent.succeeded for ${pi.id} (${pi.amount ?? "unknown"} minor units), but ${reason}. ` +
        `NOTHING ran: no deposit was flipped, no auction created, no deal advanced. Money moved at Stripe with no ` +
        `corresponding platform state. Identify the intent in the Stripe Dashboard, then converge it by hand through ` +
        `the owning admin path — do NOT fabricate a provider event.`,
    });
  } catch (err) {
    logger.error(`[stripe/webhook] unroutable-payment exception failed for ${pi.id} (best-effort):`, err);
  }
}

export async function POST(request: NextRequest) {
  // getStripe() throws hard when STRIPE_SECRET_KEY is unset. Uncaught, that
  // surfaces as an opaque framework 500 with nothing in the app log naming the
  // cause — the endpoint looks "broken" from Stripe's delivery log and silent
  // from ours. Catch it here so the misconfiguration is as legible as the
  // missing-webhook-secret case below.
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    logger.error("[stripe/webhook] STRIPE_SECRET_KEY is not set — cannot verify webhooks:", err);
    // Persist the condition: the app log is not queryable from the platform, and
    // this state is otherwise indistinguishable from "Stripe never delivered".
    await recordWebhookRejection({
      source: "stripe",
      reason: "provider_client_unavailable",
      bodyBytes: 0,
      hasSignatureHeader: request.headers.get("stripe-signature") !== null,
    });
    return new NextResponse("Webhook not configured", { status: 500 });
  }
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Fail loudly instead of silently verifying against "" — a missing secret
    // is a deployment error, not a bad request. 500 keeps Stripe retrying so
    // no events are lost while ops fixes the env.
    logger.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET is not set — rejecting webhook");
    await recordWebhookRejection({
      source: "stripe",
      reason: "webhook_secret_missing",
      bodyBytes: body.length,
      hasSignatureHeader: sig !== null,
    });
    return new NextResponse("Webhook not configured", { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig ?? "", webhookSecret);
  } catch {
    // This branch used to be entirely silent — no log, no row. A signing-secret
    // mismatch therefore looked exactly like Stripe never calling us at all,
    // which is the ambiguity that let a dead money path go unnoticed. The body
    // is unverified and possibly hostile, so only its SIZE is recorded.
    logger.error(
      `[stripe/webhook] signature verification FAILED (body ${body.length} bytes, ` +
        `signature header ${sig ? "present" : "absent"}) — if Stripe is delivering, ` +
        `the endpoint's signing secret does not match STRIPE_WEBHOOK_SECRET`,
    );
    await recordWebhookRejection({
      source: "stripe",
      reason: "signature_invalid",
      bodyBytes: body.length,
      hasSignatureHeader: sig !== null,
    });
    return new NextResponse("Webhook signature invalid", { status: 400 });
  }

  // D3: Idempotency — the event row (unique on eventId) is the claim record.
  // Ensure the row exists; the unique index arbitrates concurrent creates.
  // Fast-path duplicate ack when the event was already fully processed.
  const existing = await prisma.paymentProviderEvent.findUnique({
    where: { eventId: event.id },
    select: { processed: true },
  });
  if (existing?.processed) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (!existing) {
    try {
      await prisma.paymentProviderEvent.create({
        data: { eventId: event.id, eventType: event.type, payload: JSON.parse(JSON.stringify(event)), processed: false },
      });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "P2002") throw err;
      // Another delivery created the row concurrently — fall through; the
      // transactional claim below decides a single winner.
    }
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        // `buyerId` is deliberately NOT destructured here. Every branch below resolves
        // the buyer from the DEPOSIT row it acted on (`deposit.buyerId`) rather than from
        // provider metadata, because the admin send-link path mints a Checkout Session
        // whose PaymentIntent carries no `buyerId` at all — reading it from metadata
        // would be null for exactly the payments an admin took by hand. The concierge-fee
        // branch reads `pi.metadata.buyerId` explicitly, under its own name, where that
        // is the correct source.
        const { type } = pi.metadata;
        // Set true only by a branch that matched this payment's type AND resolved
        // the row it is meant to act on. Left false, this is a real charge that
        // changed nothing — the failure mode a bare 200 hides best.
        let routed = false;

        if (type === "deposit") {
          // Phase 0.5-3: the deposit money-cluster (PI link → deposit PAID →
          // auction create → in-app notification) runs INSIDE one interactive
          // transaction together with the idempotency claim (processed=true).
          // Consequences:
          //   • Replay-safe: once committed, a redelivery loses the claim
          //     (updateMany count 0) and acks as duplicate.
          //   • Concurrency-safe: a second in-flight delivery blocks on the
          //     row lock, then sees processed=true and acks — no double run.
          //   • Crash-safe: a failure anywhere in the cluster rolls back the
          //     claim too, so Stripe's retry re-runs everything cleanly.
          const outcome = await prisma.$transaction(async (tx) => {
            const claimed = await tx.paymentProviderEvent.updateMany({
              where: { eventId: event.id, processed: false },
              data: { processed: true, processedAt: new Date() },
            });
            if (claimed.count === 0) return null; // another delivery won

            // BUG2 FIX: Admin send-link creates Checkout Session — PI metadata is empty unless
            // payment_intent_data.metadata is set. Support both paths:
            // 1. Buyer-initiated: pi.metadata.buyerId present, deposit already has stripePaymentIntentId
            // 2. Admin send-link: pi.metadata.depositId present, deposit has no PI ID yet — link it first
            const depositIdFromMeta = pi.metadata?.depositId;
            if (depositIdFromMeta) {
              await tx.deposit.updateMany({
                where: { id: depositIdFromMeta, stripePaymentIntentId: null },
                data: { stripePaymentIntentId: pi.id },
              });
            }

            // Transition matrix (deposit-state.ts): advance to PAID only from a
            // state this EVENT may act from — `SETTLE_FROM`, which is PENDING or
            // FAILED. FAILED is in the set because production holds rows the
            // pre-Phase-3 behaviour pushed there on a card decline while their
            // PaymentIntent stayed live at Stripe; a successful retry on that same
            // intent must be able to land (money-path defect 1).
            //
            // It is `SETTLE_FROM` rather than `allowedPredecessors("PAID")`
            // deliberately: the matrix also allows DISPUTED → PAID, and that edge
            // belongs to `charge.dispute.closed` alone. A redelivered success event
            // must never clear a live dispute.
            //
            // REFUNDED and already-PAID rows are untouched, and the WHERE clause
            // enforces the edge at the DB level, so a late/out-of-order success can
            // never resurrect a settled deposit.
            await tx.deposit.updateMany({
              where: { stripePaymentIntentId: pi.id, status: { in: [...SETTLE_FROM] } },
              data: { status: "PAID" },
            });

            const deposit = await tx.deposit.findFirst({
              where: { stripePaymentIntentId: pi.id },
              include: {
                buyer: {
                  include: { user: { select: { email: true } } },
                },
              },
            });
            if (!deposit) {
              return { deposit: null, createdAuction: null, isNewAuction: false, effects: null };
            }

            // §5d, the settlement side effect: attach the payment to the Vehicle
            // Request, unlock it, and open the sourcing case with its due-diligence
            // checkpoints — all inside THIS transaction, with the PAID flip above.
            // A sourcing case that outlived a failed settlement would show a request
            // being sourced for money that never arrived.
            const effects = await applySettlementEffects(
              {
                depositId: deposit.id,
                buyerId: deposit.buyerId,
                vehicleRequestId: deposit.vehicleRequestId,
                settledDepositCents: deposit.amountCents,
              },
              tx,
            );

            // THE LEGACY PATH. Phase 3 stops settlement creating an auction — but it
            // also removes the only thing that invites dealers, and the replacement is
            // Phase 5's. So with SOURCING_CASE_REPLACES_AUCTION_LAUNCH off (the
            // default) the auction is still created here, exactly as before, and the
            // fact is COUNTED. §8.4's thirty-days-of-zero removal clock starts when
            // Phase 5 flips the flag, not at Phase 3 acceptance (§13-D52).
            if (!effects.runLegacyAuctionPath) {
              return { deposit, createdAuction: null, isNewAuction: false, effects };
            }

            // Auction.depositId is unique — re-use if a prior partial run created it.
            const existingAuction = await tx.auction.findUnique({
              where: { depositId: deposit.id },
              select: { id: true },
            });
            const createdAuction = existingAuction
              ? existingAuction
              : await tx.auction.create({
                  data: {
                    buyerId: deposit.buyerId,
                    depositId: deposit.id,
                    status: "PENDING",
                  },
                });
            if (!existingAuction) {
              await tx.notification.create({
                data: { buyerId: deposit.buyerId, title: "Auction activated!", body: "Your $99 deposit was received. Your private auction is being prepared.", type: "AUCTION_STARTED" },
              });
            }
            return { deposit, createdAuction, isNewAuction: !existingAuction, effects };
          }, {
            // Bound the row-lock hold and connection acquisition so a burst of
            // concurrent Stripe redeliveries on the same deposit can't exhaust
            // the serverless connection pool: a contended delivery gives up
            // fast (→ 500) and Stripe retries, rather than pinning a connection.
            // The body is a handful of local queries, so these are generous.
            maxWait: 2000,
            timeout: 5000,
          });

          if (outcome === null) {
            return NextResponse.json({ received: true, duplicate: true });
          }

          const { deposit, createdAuction, isNewAuction, effects } = outcome;
          routed = deposit !== null;
          const existingAuction = isNewAuction ? null : createdAuction;
          if (deposit) {
            // Post-commit effects: idempotent or best-effort; failures are
            // alerted via logger.error → Sentry rather than retried by Stripe
            // (the money state above has already committed).

            // Section 6 — suppress/cancel any remaining $99 deposit-conversion
            // reminders now that the deposit is authoritatively PAID. This is
            // belt-and-suspenders with the send-time guard (which is
            // authoritative on its own): a paid buyer must NEVER receive another
            // "$99 payment required" message. Best-effort; DORMANT-safe.
            try {
              const { cancelDepositReminderTouches } = await import(
                "@/lib/services/crm/lifecycle-touch-drain.service"
              );
              await cancelDepositReminderTouches(deposit.buyerId, { reason: "deposit_paid" });
            } catch (err) {
              logger.error("[stripe/webhook] deposit reminder cancel failed:", err);
            }
            // BOTH RAILS. Phase 3 moved the series to `comms_outbox`, keyed to the
            // request; the call above still cancels rows in flight on the rail it
            // replaced. Cancelling only one of them is how a paid buyer keeps being
            // asked to pay — the send-time recheck would refuse each one, but a
            // cancelled row is the cheaper and more honest silence.
            if (effects.vehicleRequestId) {
              try {
                const { cancelByKey } = await import(
                  "@/lib/services/comms/transactional-dispatcher.service"
                );
                const { depositReminderCancelKey } = await import(
                  "@/lib/services/payment/deposit-reminder.service"
                );
                await cancelByKey(
                  depositReminderCancelKey(effects.vehicleRequestId),
                  "deposit_paid",
                );
              } catch (err) {
                logger.error("[stripe/webhook] deposit outbox cancel failed:", err);
              }
            }

            // BUG1 FIX: Launch auction and invite dealers (was missing — dealers were
            // never notified). Phase 3: this is now the LEGACY path, reached only while
            // SOURCING_CASE_REPLACES_AUCTION_LAUNCH is off, and every trip through it is
            // recorded. Post-commit and best-effort by design — a dealer-invitation call
            // inside the money transaction would hold a row lock on the deposit for the
            // length of a third-party round trip.
            if (createdAuction && !existingAuction) {
              await recordLegacyPathWrite({
                kind: "SETTLEMENT_AUCTION_LAUNCH",
                detail:
                  `settlement created auction ${createdAuction.id} for deposit ${deposit.id} ` +
                  `instead of leaving sourcing to the case` +
                  (effects?.sourcingCaseId ? ` (case ${effects.sourcingCaseId} was opened too)` : ""),
                entityType: "Deposit",
                entityId: deposit.id,
                removalPhase: 5,
              });
              await launchAuction(createdAuction.id).catch((err: unknown) =>
                logger.error("[stripe/webhook] launchAuction failed:", err)
              );
              await inviteDealersToAuction(createdAuction.id, deposit.buyerId).catch((err: unknown) =>
                logger.error("[stripe/webhook] inviteDealersToAuction failed:", err)
              );
            }

            // Send deposit confirmation and auction activated emails — only
            // the first time we process this deposit's success event. Webhook
            // retries (e.g. transient 5xx downstream of email send) must not
            // re-trigger transactional emails.
            const buyerEmail = deposit.buyer?.user?.email;
            const buyerName = deposit.buyer?.firstName?.trim() || "valued customer";

            // Phase C-Attribution — credit any content-engine lead carrying this
            // buyer's email to the conversion. Idempotent (only flips rows still
            // marked not-converted) and self-contained (never throws), so webhook
            // retries are safe and a miss here can't break payment processing.
            if (buyerEmail) {
              await markContentConversion({
                email: buyerEmail,
                conversionValueCents: deposit.amountCents,
              });
            }

            if (buyerEmail && !existingAuction) {
              try {
                await sendDepositConfirmationEmail(buyerEmail, buyerName, deposit.id);
              } catch (e) {
                logger.error("[stripe/webhook] deposit confirmation email failed:", e);
              }
              try {
                if (createdAuction) {
                  await sendAuctionActivatedEmail(buyerEmail, buyerName, createdAuction.id);
                }
              } catch (e) {
                logger.error("[stripe/webhook] auction activated email failed:", e);
              }
              syncGhlTag(buyerEmail, "deposit-paid");

              // Lifecycle — auction-live sequence (immediate + midpoint/closing
              // checks). Only the STANDARD deposit branch reaches here; the
              // concierge branch never launches a live auction, so it never
              // schedules this sequence (Program 2 §10). Internal vs QStash is
              // chosen per the auction activation flag (default QStash).
              if (createdAuction) {
                scheduleLifecycleWorkload({
                  workload: "auction_active",
                  buyerId: deposit.buyerId,
                  firstName: deposit.buyer?.firstName ?? "there",
                  email: buyerEmail,
                  auctionId: createdAuction.id,
                }).catch(() => {});
              }
            }

            // CRM event spine — emit deposit_paid for the buyer after the
            // deposit has been confirmed PAID. Appended tail call only: nothing
            // in the Stripe handling above changes, and a failure here can never
            // affect payment processing (the deposit write has already
            // committed).
            try {
              const { emitDomainEvent } = await import("@/lib/events/emit");
              await emitDomainEvent("deposit_paid", {
                domainEntityId: deposit.id,
                contact: {
                  email: deposit.buyer?.user?.email ?? null,
                  phone: deposit.buyer?.phone ?? null,
                  firstName: deposit.buyer?.firstName,
                  lastName: deposit.buyer?.lastName,
                  source: "buyer_signup",
                },
                data: {
                  deposit_id: deposit.id,
                  buyer_id: deposit.buyerId,
                  amount_cents: deposit.amountCents,
                  payment_intent_id: pi.id,
                },
              });
            } catch (err) {
              logger.error("[stripe/webhook] deposit_paid emit failed:", err);
            }
          }
        }

        if (type === "concierge_deposit") {
          // System B convergence: a settled $99 concierge deposit mints a
          // deposit-gated CLOSED auction with canonical Offers converted from the
          // source VehicleOffer's dealer submissions. Kept SEPARATE from the
          // standard "deposit" branch (which launches a LIVE auction + invites
          // dealers) — a concierge auction is created CLOSED with its offers
          // already present, so no launch/invite happens.
          //
          // The whole money-cluster (event claim → deposit PAID → CLOSED auction
          // + offer conversion) runs in ONE transaction, so a PAID concierge
          // deposit ALWAYS has its auction: the deposit-activation reconciler can
          // never see a PAID+no-auction concierge deposit and mis-activate it.
          // The reviewToken binds this deposit to the SPECIFIC curated review the
          // buyer acted on — conversion uses that review's items (not every
          // submission on the VehicleOffer).
          const reviewToken = pi.metadata?.reviewToken;

          // Resolve the Outside Dealer placeholder OUTSIDE the transaction — that
          // helper runs its own transaction and must not nest.
          const outsideDealerId = await getOrCreateOutsideDealerId();

          const outcome = await prisma.$transaction(async (tx) => {
            const claimed = await tx.paymentProviderEvent.updateMany({
              where: { eventId: event.id, processed: false },
              data: { processed: true, processedAt: new Date() },
            });
            if (claimed.count === 0) return null; // another delivery won

            // Guarded PAID flip (transition matrix): only from a state this event
            // may act from, so a late/out-of-order success can't resurrect a
            // settled deposit or clear a live dispute. Same `SETTLE_FROM` set as
            // the standard branch, including FAILED for the rows defect 1
            // stranded — a concierge deposit declines and retries identically.
            await tx.deposit.updateMany({
              where: { stripePaymentIntentId: pi.id, status: { in: [...SETTLE_FROM] } },
              data: { status: "PAID" },
            });

            const deposit = await tx.deposit.findFirst({
              where: { stripePaymentIntentId: pi.id },
              include: { buyer: { include: { user: { select: { email: true } } } } },
            });
            if (!deposit) return { deposit: null, auctionId: null, offerCount: 0, reused: false };

            if (!reviewToken) {
              // Should never happen — create-intent always stamps reviewToken on
              // a concierge deposit PI. Record PAID (already done) but do not
              // fabricate an auction with no source review.
              logger.error(
                `[stripe/webhook] concierge_deposit ${deposit.id} missing pi.metadata.reviewToken — deposit marked PAID, no auction created`,
              );
              return { deposit, auctionId: null, offerCount: 0, reused: false };
            }

            const conv = await convertConciergeOfferToClosedAuction(tx, {
              buyerId: deposit.buyerId,
              depositId: deposit.id,
              reviewToken,
              outsideDealerId,
            });

            if (!conv.reused) {
              await tx.notification.create({
                data: {
                  buyerId: deposit.buyerId,
                  title: "Your offers are ready",
                  body: "Your $99 deposit was received. Review your vehicle offers and choose the best one to start your deal.",
                  type: "AUCTION_STARTED",
                },
              });
            }
            return { deposit, auctionId: conv.auctionId, offerCount: conv.offerIds.length, reused: conv.reused };
          }, {
            // Bound the lock hold like the standard deposit cluster. The
            // conversion is a handful of local inserts, so this is generous.
            maxWait: 2000,
            timeout: 8000,
          });

          if (outcome === null) {
            return NextResponse.json({ received: true, duplicate: true });
          }

          const { deposit, auctionId, reused } = outcome;
          routed = deposit !== null;
          if (deposit && auctionId && !reused) {
            // Post-commit, best-effort effects (money already committed).
            const buyerEmail = deposit.buyer?.user?.email;
            const buyerName = deposit.buyer?.firstName?.trim() || "valued customer";

            if (buyerEmail) {
              await markContentConversion({
                email: buyerEmail,
                conversionValueCents: deposit.amountCents,
              });
              try {
                await sendDepositConfirmationEmail(buyerEmail, buyerName, deposit.id);
              } catch (e) {
                logger.error("[stripe/webhook] concierge deposit confirmation email failed:", e);
              }
              syncGhlTag(buyerEmail, "deposit-paid");
            }

            try {
              const { emitDomainEvent } = await import("@/lib/events/emit");
              await emitDomainEvent("deposit_paid", {
                domainEntityId: deposit.id,
                contact: {
                  email: deposit.buyer?.user?.email ?? null,
                  phone: deposit.buyer?.phone ?? null,
                  firstName: deposit.buyer?.firstName,
                  lastName: deposit.buyer?.lastName,
                  source: "buyer_signup",
                },
                data: {
                  deposit_id: deposit.id,
                  buyer_id: deposit.buyerId,
                  amount_cents: deposit.amountCents,
                  payment_intent_id: pi.id,
                  auction_id: auctionId,
                  concierge: true,
                },
              });
            } catch (err) {
              logger.error("[stripe/webhook] concierge deposit_paid emit failed:", err);
            }
          }
        }

        // "concierge_fee" is the canonical type for admin-initiated payment intents.
        // "service_fee" is the legacy type used by the buyer self-service path — kept for
        // backward compatibility with payment intents already in flight.
        if (type === "concierge_fee" || type === "service_fee") {
          // BUG3+4 FIX: Checkout Sessions don't auto-copy session metadata to the PI.
          // We now set payment_intent_data.metadata on session creation, so pi.metadata
          // has dealId. Use it to locate the deal AND set stripeFeePIId in one update.
          const { dealId: metaDealId, buyerId: metaBuyerId } = pi.metadata ?? {};

          // Update by dealId from metadata (primary path — from admin checkout send-link)
          // or fall back to stripeFeePIId match (legacy buyer self-service path)
          const whereClause = metaDealId
            ? { id: metaDealId }
            : { stripeFeePIId: pi.id };

          // Source-checked advance (Gap 8): only move the deal forward when it is
          // actually awaiting fee payment. A deal already past insurance is NOT
          // regressed — we still record the fee fields for dedup. Fee receipt is an
          // authoritative payment fact, so the forward transition is forced and the
          // change is recorded in DealStatusHistory.
          const feeDeal = await prisma.deal.findFirst({ where: whereClause });
          routed = feeDeal !== null;
          if (feeDeal) {
            // Net of the $99 deposit credit — the amount actually captured.
            const feeData = { feePaidAt: new Date(), feeAmountCents: PREMIUM_FEE_REMAINING_CENTS, stripeFeePIId: pi.id };
            // Recording the fee is enough: advanceDealStatus settles the rest of
            // the ladder on arrival (FEE_PAID → INSURANCE_PENDING, and on into the
            // insurance gate when proof is already on file). Re-issuing an explicit
            // forced INSURANCE_PENDING here used to drag a deal that had already
            // cascaded to CONTRACT_PENDING back a stage, writing bogus history and
            // duplicate customer notifications.
            if (feeDeal.status === "FEE_PENDING" || feeDeal.status === "FEE_PAID") {
              await advanceDealStatus(feeDeal.id, "FEE_PAID", { actorRole: "SYSTEM", force: true, data: feeData });
            } else {
              // Before the fee stage, or already past insurance — record the fee
              // fields without touching status. The ladder settles it when the deal
              // arrives at FEE_PENDING (see settleFeeLadderIfPaid).
              await prisma.deal.update({ where: { id: feeDeal.id }, data: feeData });
            }

            // Ledger completeness: write the ServiceFeePayment row (the only
            // writer — recordFeePayment was dead, so service_fee_payments never
            // populated even after a real fee). Idempotent on dealId; best-effort
            // so a ledger-row failure never rolls back the already-committed fee
            // receipt / status advance above.
            await writeServiceFeePayment(feeDeal.id, pi.id).catch((err) =>
              logger.error("[stripe-webhook] service fee payment record failed:", err),
            );
          }

          // Send the buyer a confirmation that their service fee was received.
          // Routed through the idempotent send rail so webhook retries cannot
          // produce a duplicate receipt for the same payment intent.
          try {
            const updatedDeal = metaDealId
              ? await prisma.deal.findUnique({ where: { id: metaDealId } })
              : await prisma.deal.findFirst({ where: { stripeFeePIId: pi.id } });
            if (updatedDeal) {
              const buyerForEmail = await prisma.buyer.findUnique({
                where: { id: updatedDeal.buyerId },
                include: { user: { select: { email: true } } },
              });
              const buyerEmail = buyerForEmail?.user?.email;
              const buyerName = buyerForEmail?.firstName ?? "there";
              if (buyerEmail) {
                await sendConciergeFeeConfirmationEmail({
                  to: buyerEmail,
                  firstName: buyerName,
                  dealId: updatedDeal.id,
                  paymentIntentId: pi.id,
                });
              }
            }
          } catch (err) {
            logger.error("[stripe/webhook] service fee email failed:", err);
          }

          // Trigger affiliate commissions — idempotent (commission service checks
          // qualifyingEventId before creating). A commission failure must never roll
          // back the deal status update above, but it must ALSO never be silently
          // lost: this branch marks the Stripe event processed at the end, so Stripe
          // will not retry. On failure we hand the walk to the durable dead-letter
          // queue keyed on the fee PaymentIntent; the DLQ drainer replays
          // processFeeCommission (idempotent) until it succeeds or is surfaced for
          // review — closing the one path where a paid-fee commission could vanish.
          // M3 — the walk runs for BOTH resolution paths: metadata ids
          // (primary) or the deal matched via stripeFeePIId (legacy buyer
          // self-service). Before, the legacy path recorded the fee and
          // advanced the deal but silently skipped commissions.
          const commissionDealId = metaDealId ?? feeDeal?.id;
          const commissionBuyerId = metaBuyerId ?? feeDeal?.buyerId;
          if (commissionDealId && commissionBuyerId) {
            // F-004 — base commissions on the actual fee paid (this PI), not a
            // hardcoded constant. amount_received is the captured amount in cents;
            // fall back to amount if unset.
            const feeBasisCents = pi.amount_received || pi.amount || 0;
            try {
              await processFeeCommission({
                dealId: commissionDealId,
                buyerId: commissionBuyerId,
                qualifyingEventId: pi.id,
                feeBasisCents,
              });
            } catch (commissionErr) {
              logger.error("[stripe/webhook] commission walk failed — dead-lettering for durable recovery:", commissionErr);
              try {
                const { moveJobToDeadLetter } = await import("@/lib/jobs/idempotency");
                const { getServiceSupabase } = await import("@/lib/supabase-service");
                await moveJobToDeadLetter(
                  getServiceSupabase(),
                  `commission:${commissionDealId}:${pi.id}`,
                  "autolenis/affiliate.commission_walk",
                  { dealId: commissionDealId, buyerId: commissionBuyerId, qualifyingEventId: pi.id, feeBasisCents },
                  commissionErr instanceof Error ? commissionErr.message : String(commissionErr),
                );
              } catch (dlqErr) {
                logger.error("[stripe/webhook] commission dead-letter capture failed:", dlqErr);
              }
            }
          }
        }

        // Nothing above claimed this payment. Two ways to get here, both of
        // which used to end in a bare 200 with no trace: the metadata type
        // matches no branch at all, or a branch matched but the row it needed
        // (Deposit for this PaymentIntent, Deal for this dealId) does not exist.
        // Stripe is still acknowledged — a retry cannot conjure the missing row
        // or repair metadata — but the charge is surfaced as an operational
        // exception instead of being acked into silence.
        if (!routed) {
          const reason = ROUTABLE_PI_TYPES.has(type ?? "")
            ? `metadata.type="${type}" matched a fulfillment branch, but no matching record was found for this payment`
            : `metadata.type="${type ?? "absent"}" matched no fulfillment branch`;
          logger.error(
            `[stripe/webhook] unroutable payment_intent.succeeded ${pi.id} — ${reason}; no platform state changed`,
          );
          await raiseUnroutablePaymentException(pi, reason);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;

        if (pi.metadata.type === "deposit" || pi.metadata.type === "concierge_deposit") {
          // MONEY-PATH DEFECT 1, fixed at the cause. This branch used to write
          // FAILED here. It must not, and the reason is not a matrix detail — it is
          // what the event means.
          //
          // `payment_intent.payment_failed` is a DECLINED ATTEMPT, not a dead
          // intent. Stripe Elements retries on the same PaymentIntent, so the
          // obligation still stands and the buyer can still pay it. Recording that
          // as FAILED made the row terminal, stranded the retry, and left the
          // reconciler — which swept PENDING only — unable to find it ever again.
          //
          // So the deposit STAYS PENDING and nothing is written. PENDING is the
          // truth: an unpaid obligation with a live intent. The row remains inside
          // the create-intent reuse lookup and inside the reconciler sweep, which
          // is the whole point.
          //
          // What DOES write FAILED is `payment_intent.canceled` and
          // `checkout.session.expired` below — the two events that mean the intent
          // itself is gone.
          //
          // §5c/§27's "Payment failed → truthful failure and retry path" message is
          // NOT sent from here and is not silently dropped: the six-touch series
          // owns buyer-facing $99 messaging and rechecks live payment state at send
          // time, so a decline is already covered by the next due touch. This branch
          // sent the buyer nothing before this change either, so no capability is
          // removed. Recorded rather than assumed, because "we left it as it was" is
          // exactly the kind of gap that reads as deliberate a year later.
          logger.info(
            `[stripe/webhook] deposit payment attempt declined for PI ${pi.id} — deposit left PENDING; ` +
              `the intent is live and the buyer may retry on it`,
          );
        }

        if (pi.metadata.type === "concierge_fee" || pi.metadata.type === "service_fee") {
          const { buyerId } = pi.metadata;
          if (buyerId) {
            await prisma.notification.create({
              data: {
                buyerId,
                type:  "DEAL_STAGE_CHANGED",
                title: "Payment failed",
                body:  "Your concierge fee payment could not be processed. Return to your deal page to retry.",
              },
            }).catch(() => {});
          }
        }
        break;
      }

      // MONEY-PATH DEFECT 1, the other half. Nothing in this webhook handled a dead
      // intent before Phase 3, because `payment_failed` was (wrongly) doing that job.
      // Now that a decline correctly leaves the deposit PENDING, something has to
      // record the case where the intent really is gone — otherwise a cancelled
      // obligation sits PENDING for ever, keeps blocking new intents through the
      // obligation check, and keeps drawing deposit-reminder touches for money the
      // buyer can no longer pay.
      //
      // Stripe emits this when an intent is cancelled explicitly or by its automatic
      // timeout. `DEAD_INTENT_FROM` is PENDING only: a cancellation arriving after a
      // success (they do cross) must never downgrade a PAID row, and the WHERE clause
      // enforces that at the database rather than in a read-then-write.
      case "payment_intent.canceled": {
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata.type === "deposit" || pi.metadata.type === "concierge_deposit") {
          const dead = await prisma.deposit.updateMany({
            where: { stripePaymentIntentId: pi.id, status: { in: [...DEAD_INTENT_FROM] } },
            data: { status: "FAILED" },
          });
          if (dead.count === 1) {
            logger.info(
              `[stripe/webhook] PaymentIntent ${pi.id} cancelled — deposit marked FAILED (dead intent). ` +
                `The buyer may start a new one.`,
            );
          }
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const piId   = typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;

        if (!piId) break;

        const deposit = await prisma.deposit.findFirst({
          where:  { stripePaymentIntentId: piId },
          select: { id: true, status: true, buyerId: true, vehicleRequestId: true },
        });

        // Transition matrix: REFUNDED is reachable from PAID or DISPUTED. The DISPUTED
        // edge is here because a lost dispute leaves the deposit in that state and the
        // money does go back — but the branch that RULES on a lost dispute is
        // `charge.dispute.closed`, not this one. Whether Stripe also emits a refund
        // event for a lost dispute is a claim about provider behaviour this session
        // could not verify against a live account, so neither path depends on the other:
        // both are idempotent, and whichever arrives second finds the row already
        // REFUNDED and changes nothing. The updateMany
        // WHERE enforces the edge atomically (count 1 = we performed the refund,
        // count 0 = disallowed/already-settled → skip side effects). This closes
        // the check-then-write race a findFirst+update leaves open.
        const refundApplied = deposit
          ? (await prisma.deposit.updateMany({
              where: { id: deposit.id, status: { in: [...REFUND_FROM] } },
              data:  { status: "REFUNDED", refundedAt: new Date() },
            })).count === 1
          : false;

        // §5d: a refund places fulfilment on hold and stops all unsent outreach — the
        // same clause as a dispute, and previously honoured for neither. Applied on the
        // refund actually landing, not on the event arriving, so a redelivery does not
        // re-cancel and re-raise.
        if (deposit && refundApplied) {
          await applyFulfillmentHold({
            depositId: deposit.id,
            buyerId: deposit.buyerId,
            vehicleRequestId: deposit.vehicleRequestId,
            trigger: "refund",
            providerRef: charge.id,
            reason: charge.refunds?.data?.[0]?.reason ?? null,
          });
        }

        if (deposit && refundApplied) {
          await prisma.notification.create({
            data: {
              buyerId: deposit.buyerId,
              type:    "DEAL_STAGE_CHANGED",
              title:   "Deposit refunded",
              body:    "Your $99 Auction Access Deposit refund has been processed. Allow 3–5 business days.",
            },
          }).catch(() => {});

          // Email receipt for the refund — idempotency-keyed on the Stripe
          // charge id so retries of the same event never re-send.
          try {
            const buyerForEmail = await prisma.buyer.findUnique({
              where: { id: deposit.buyerId },
              include: { user: { select: { email: true } } },
            });
            if (buyerForEmail?.user?.email) {
              await sendRefundConfirmationEmail({
                to: buyerForEmail.user.email,
                firstName: buyerForEmail.firstName ?? "there",
                amountCents: charge.amount_refunded,
                reason: "Auction Access Deposit refund",
                refundId: charge.id,
              });
            }
          } catch (err) {
            logger.error("[stripe/webhook] deposit refund email failed:", err);
          }
          break;
        }

        const deal = await prisma.deal.findFirst({
          where:  { stripeFeePIId: piId },
          select: { id: true, buyerId: true },
        });
        if (deal) {
          await prisma.adminAuditLog.create({
            data: {
              action:     "CONCIERGE_FEE_REFUNDED_VIA_STRIPE",
              entityType: "Deal",
              entityId:   deal.id,
              adminId:    "system",
              adminEmail: "system@autolenis.com",
              metadata:   { piId, chargeId: charge.id },
            },
          }).catch(() => {});

          // M2 — the fee was refunded, so its commissions must not stay
          // payable: PENDING/APPROVED flip to REVERSED (status-guarded CAS
          // inside the service). PAID commissions are never auto-reversed —
          // pulling paid money back is a human clawback decision — so raise a
          // deduped SYSTEM_ALERT naming them instead. Best-effort: a commission
          // failure never un-acks the refund handling above.
          try {
            const { reversed, paidNeedingReview } = await reverseCommissionsForPaymentIntent(piId);
            if (reversed > 0) {
              logger.info(`[stripe/webhook] reversed ${reversed} commission(s) for refunded fee ${piId}`);
            }
            if (paidNeedingReview.length > 0) {
              const title = `Refunded fee has PAID commissions — manual clawback needed: ${piId}`;
              const existing = await prisma.notification.findFirst({
                where: { title, type: "SYSTEM_ALERT" },
                select: { id: true },
              });
              if (!existing) {
                await prisma.notification.create({
                  data: {
                    title,
                    body: `Stripe reported charge.refunded for fee PaymentIntent ${piId} (deal ${deal.id}), but commission(s) ${paidNeedingReview.join(", ")} were already PAID out. They were NOT auto-reversed. Review and claw back via the admin affiliate command center. /admin/operations`,
                    type: "SYSTEM_ALERT",
                    actionUrl: "/admin/operations",
                  },
                });
              }
            }
          } catch (err) {
            logger.error("[stripe/webhook] commission reversal for refunded fee failed:", err);
          }

          // Receipt to the buyer for the concierge / service fee refund.
          try {
            const buyerForEmail = await prisma.buyer.findUnique({
              where: { id: deal.buyerId },
              include: { user: { select: { email: true } } },
            });
            if (buyerForEmail?.user?.email) {
              await sendRefundConfirmationEmail({
                to: buyerForEmail.user.email,
                firstName: buyerForEmail.firstName ?? "there",
                amountCents: charge.amount_refunded,
                reason: "AutoLenis Service Fee refund",
                refundId: charge.id,
              });
            }
          } catch (err) {
            logger.error("[stripe/webhook] fee refund email failed:", err);
          }
        }
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        const charge  = await getStripe().charges.retrieve(dispute.charge as string);
        const piId    = typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
        const chargeId = typeof dispute.charge === "string"
          ? dispute.charge
          : dispute.charge.id;

        // §26: "Payment disputed or refunded | Finance | Hold fulfillment; stop unsent
        // outreach." Before Phase 3 this branch wrote an audit row and nothing else —
        // best-effort, with a swallowed catch — so a contested charge changed no state,
        // stopped no outreach and told nobody, while sourcing carried on spending money
        // on it. The audit row is kept below; it is no longer the whole response.
        if (piId) {
          const disputed = await prisma.deposit.findFirst({
            where: { stripePaymentIntentId: piId },
            select: { id: true, buyerId: true, vehicleRequestId: true },
          });
          if (disputed) {
            await applyFulfillmentHold({
              depositId: disputed.id,
              buyerId: disputed.buyerId,
              vehicleRequestId: disputed.vehicleRequestId,
              trigger: "dispute",
              providerRef: dispute.id,
              reason: dispute.reason ?? null,
            });
          } else {
            // A dispute against a charge we cannot resolve to a deposit is the §26
            // "never absorbed" case wearing a different hat, and it is the more
            // alarming direction: money is being clawed back from an obligation we
            // cannot name.
            await raiseUnroutablePaymentException(
              { id: piId, metadata: {} } as Stripe.PaymentIntent,
              `a dispute (${dispute.id}) was filed against it but no deposit carries this PaymentIntent`,
            );
          }
        }

        await prisma.adminAuditLog.create({
          data: {
            action:     "STRIPE_DISPUTE_CREATED",
            entityType: "Payment",
            entityId:   dispute.id,
            adminId:    "system",
            adminEmail: "system@autolenis.com",
            metadata: {
              disputeId:       dispute.id,
              chargeId:        chargeId,
              paymentIntentId: piId ?? null,
              amount:          dispute.amount,
              reason:          dispute.reason,
              status:          dispute.status,
              dueBy:           dispute.evidence_details?.due_by,
            },
          },
        }).catch((err: unknown) => logger.error("[stripe/webhook] dispute audit log failed:", err));
        break;
      }

      // The other half of the hold. Without it, `charge.dispute.created` would be a
      // one-way door: every disputed deposit would sit at DISPUTED for ever, its Finance
      // exception open, its buyer told "your payment is under review" indefinitely — even
      // for the disputes the platform WINS, which is most of them.
      //
      // Stripe closes a dispute with one of three outcomes and they are not symmetrical:
      //   • won            — the charge stands. Release the hold, deposit back to PAID.
      //   • lost           — the money is withdrawn. REFUNDED, and the hold STAYS on.
      //   • warning_closed — an early-fraud warning that never became a formal dispute.
      //                      No ruling was made, so nothing here rules either.
      //
      // The `lost` branch is handled HERE rather than left to `charge.refunded`. Whether
      // Stripe also emits a refund event for a lost dispute is a claim about provider
      // behaviour this session cannot verify against a live account, and a money path
      // that depends on an unverified provider assumption is exactly the shape of the
      // defects this phase exists to fix. Both branches are idempotent, so if a refund
      // event does also arrive it finds the row already REFUNDED and changes nothing.
      case "charge.dispute.closed": {
        const dispute = event.data.object as Stripe.Dispute;
        const charge  = await getStripe().charges.retrieve(dispute.charge as string);
        const piId    = typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;

        const deposit = piId
          ? await prisma.deposit.findFirst({
              where: { stripePaymentIntentId: piId },
              select: { id: true, buyerId: true, vehicleRequestId: true },
            })
          : null;

        if (deposit && dispute.status === "won") {
          await releaseFulfillmentHold(deposit.id, dispute.id);
        } else if (deposit && dispute.status === "lost") {
          await recordDisputeLost({
            depositId:        deposit.id,
            buyerId:          deposit.buyerId,
            vehicleRequestId: deposit.vehicleRequestId,
            providerRef:      dispute.id,
          });
        } else if (deposit) {
          // warning_closed, or a status Stripe adds later. The hold stays and the Finance
          // exception stays open, because "we do not recognise this outcome" is a reason
          // to leave a human in the loop, not a reason to guess at one.
          logger.warn(
            `[stripe/webhook] dispute ${dispute.id} closed with status "${dispute.status}" — ` +
              `no ruling applied to deposit ${deposit.id}; the fulfilment hold and its Finance ` +
              `exception both stand`,
          );
        } else if (piId) {
          logger.warn(
            `[stripe/webhook] dispute ${dispute.id} closed ("${dispute.status}") for PaymentIntent ` +
              `${piId}, which no deposit carries — the created event already raised the unroutable ` +
              `exception; nothing to release`,
          );
        }

        await prisma.adminAuditLog.create({
          data: {
            action:     "STRIPE_DISPUTE_CLOSED",
            entityType: "Payment",
            entityId:   dispute.id,
            adminId:    "system",
            adminEmail: "system@autolenis.com",
            metadata: {
              disputeId:       dispute.id,
              paymentIntentId: piId ?? null,
              depositId:       deposit?.id ?? null,
              amount:          dispute.amount,
              reason:          dispute.reason,
              status:          dispute.status,
            },
          },
        }).catch((err: unknown) => logger.error("[stripe/webhook] dispute-closed audit log failed:", err));
        break;
      }
    }

    // Claim-at-end for the non-deposit event types. These handlers are each
    // idempotent (status-guarded deal advance, qualifyingEventId-keyed
    // commissions, PI-keyed email rail), so re-running on retry is safe and a
    // transient failure above (→ 500) keeps Stripe retrying. The deposit path
    // claims transactionally up front and returns before reaching here when
    // it loses the claim.
    await prisma.paymentProviderEvent.updateMany({
      where: { eventId: event.id, processed: false },
      data: { processed: true, processedAt: new Date() },
    });

    return NextResponse.json({ received: true });
  } catch (err) {
    logger.error("Webhook processing error:", err);
    return new NextResponse("Processing error", { status: 500 });
  }
}
