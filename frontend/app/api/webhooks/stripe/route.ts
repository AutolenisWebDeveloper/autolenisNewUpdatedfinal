import { logger } from "@/lib/logger";
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
import { walkCommissionTree } from "@/lib/services/affiliate/commission.service";
import { launchAuction } from "@/lib/services/auction/auction.service";
import { inviteDealersToAuction } from "@/lib/services/auction/dealer-invitation.service";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";
import { dispatch } from "@/lib/qstash/dispatch";
import { markContentConversion } from "@/lib/analytics/content-attribution.server";
import { allowedPredecessors } from "@/lib/payments/deposit-state";

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Fail loudly instead of silently verifying against "" — a missing secret
    // is a deployment error, not a bad request. 500 keeps Stripe retrying so
    // no events are lost while ops fixes the env.
    logger.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET is not set — rejecting webhook");
    return new NextResponse("Webhook not configured", { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig ?? "", webhookSecret);
  } catch {
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
        const { buyerId, type } = pi.metadata;

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

            // Transition matrix (deposit-state.ts): only advance to PAID from a
            // permitted predecessor (PENDING). A terminal REFUNDED/FAILED, or an
            // already-PAID row, is left untouched — the WHERE clause enforces the
            // allowed edge at the DB level, so a late/out-of-order success can
            // never resurrect a settled deposit.
            await tx.deposit.updateMany({
              where: { stripePaymentIntentId: pi.id, status: { in: allowedPredecessors("PAID") } },
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
            if (!deposit) return { deposit: null, createdAuction: null, isNewAuction: false };

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
            return { deposit, createdAuction, isNewAuction: !existingAuction };
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

          const { deposit, createdAuction, isNewAuction } = outcome;
          const existingAuction = isNewAuction ? null : createdAuction;
          if (deposit) {
            // Post-commit effects: idempotent or best-effort; failures are
            // alerted via logger.error → Sentry rather than retried by Stripe
            // (the money state above has already committed).

            // BUG1 FIX: Launch auction and invite dealers (was missing — dealers were never notified)
            if (createdAuction && !existingAuction) {
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

              // QStash — auction-live sequence (immediate + midpoint/closing checks).
              if (createdAuction) {
                dispatch({
                  path: "/api/jobs/auction-active",
                  body: {
                    buyerId: deposit.buyerId,
                    firstName: deposit.buyer?.firstName ?? "there",
                    email: buyerEmail,
                    auctionId: createdAuction.id,
                  },
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
          if (feeDeal) {
            // Net of the $99 deposit credit — the amount actually captured.
            const feeData = { feePaidAt: new Date(), feeAmountCents: PREMIUM_FEE_REMAINING_CENTS, stripeFeePIId: pi.id };
            if (feeDeal.status === "FEE_PENDING") {
              await advanceDealStatus(feeDeal.id, "FEE_PAID", { actorRole: "SYSTEM", force: true, data: feeData });
              await advanceDealStatus(feeDeal.id, "INSURANCE_PENDING", { actorRole: "SYSTEM", force: true });
            } else if (feeDeal.status === "FEE_PAID") {
              await advanceDealStatus(feeDeal.id, "INSURANCE_PENDING", { actorRole: "SYSTEM", force: true, data: feeData });
            } else {
              // Already at/after INSURANCE_PENDING — record fee fields, do not regress status.
              await prisma.deal.update({ where: { id: feeDeal.id }, data: feeData });
            }
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

          // Trigger affiliate commissions — idempotent (commission service checks qualifyingEventId before creating)
          // Safe: a commission failure must never roll back the deal status update above.
          try {
            if (metaDealId && metaBuyerId) {
              const buyer = await prisma.buyer.findUnique({
                where: { id: metaBuyerId },
                select: { userId: true },
              });
              if (buyer) {
                const referral = await prisma.affiliateReferral.findFirst({
                  where: { referredUserId: buyer.userId },
                  select: { affiliateId: true },
                });
                if (referral) {
                  // F-004 — base commissions on the actual fee paid (this PI),
                  // not a hardcoded constant. amount_received is the captured
                  // amount in cents; fall back to amount if unset.
                  const feeBasisCents = pi.amount_received || pi.amount || 0;
                  await walkCommissionTree(metaDealId, referral.affiliateId, pi.id, feeBasisCents);
                }
              }
            }
          } catch (commissionErr) {
            logger.error("[stripe/webhook] commission walk failed (non-fatal):", commissionErr);
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;

        if (pi.metadata.type === "deposit") {
          // Transition matrix: FAILED is reachable only from PENDING, so a late
          // failure event can never downgrade a PAID or REFUNDED deposit.
          await prisma.deposit.updateMany({
            where: { stripePaymentIntentId: pi.id, status: { in: allowedPredecessors("FAILED") } },
            data:  { status: "FAILED" },
          });
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

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const piId   = typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;

        if (!piId) break;

        const deposit = await prisma.deposit.findFirst({
          where:  { stripePaymentIntentId: piId },
          select: { id: true, status: true, buyerId: true },
        });

        // Transition matrix: REFUNDED is reachable only from PAID. The updateMany
        // WHERE enforces the edge atomically (count 1 = we performed the refund,
        // count 0 = disallowed/already-settled → skip side effects). This closes
        // the check-then-write race a findFirst+update leaves open.
        const refundApplied = deposit
          ? (await prisma.deposit.updateMany({
              where: { id: deposit.id, status: { in: allowedPredecessors("REFUNDED") } },
              data:  { status: "REFUNDED", refundedAt: new Date() },
            })).count === 1
          : false;

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
