import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_CENTS } from "@/lib/constants";
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

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig ?? "", webhookSecret);
  } catch {
    return new NextResponse("Webhook signature invalid", { status: 400 });
  }

  // D3: Idempotency — atomic claim on PaymentProviderEvent.eventId.
  // Two concurrent Stripe retries can both pass a findUnique check, so we
  // rely on the unique-index error from create() to detect duplicates. The
  // first writer wins; the loser returns 200 so Stripe stops retrying.
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
      if (code === "P2002") {
        // Another retry won the race. Ack so Stripe stops retrying — the
        // winner is responsible for the side effects.
        return NextResponse.json({ received: true, duplicate: true });
      }
      throw err;
    }
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const { buyerId, type } = pi.metadata;

        if (type === "deposit") {
          // BUG2 FIX: Admin send-link creates Checkout Session — PI metadata is empty unless
          // payment_intent_data.metadata is set. Support both paths:
          // 1. Buyer-initiated: pi.metadata.buyerId present, deposit already has stripePaymentIntentId
          // 2. Admin send-link: pi.metadata.depositId present, deposit has no PI ID yet — link it first
          const depositIdFromMeta = pi.metadata?.depositId;
          if (depositIdFromMeta) {
            // Link PI to deposit created by admin send-link (which had no PI ID yet)
            await prisma.deposit.updateMany({
              where: { id: depositIdFromMeta, stripePaymentIntentId: null },
              data: { stripePaymentIntentId: pi.id },
            });
          }

          await prisma.deposit.updateMany({
            where: { stripePaymentIntentId: pi.id },
            data: { status: "PAID" },
          });
          // Create auction after deposit paid
          const deposit = await prisma.deposit.findFirst({
            where: { stripePaymentIntentId: pi.id },
            include: {
              buyer: {
                include: { user: { select: { email: true } } },
              },
            },
          });
          if (deposit) {
            // Auction.depositId is unique. Use upsert so a webhook retry (e.g.
            // after a transient 5xx from a downstream side-effect) does not
            // throw P2002 and trap the event in a permanent failure loop.
            const existingAuction = await prisma.auction.findUnique({
              where: { depositId: deposit.id },
              select: { id: true },
            });
            const createdAuction = existingAuction
              ? existingAuction
              : await prisma.auction.create({
                  data: {
                    buyerId: deposit.buyerId,
                    depositId: deposit.id,
                    status: "PENDING",
                  },
                });
            // Notify buyer in-app — only on the first time we create the auction
            // so retries don't spam duplicate in-app notifications.
            if (!existingAuction) {
              await prisma.notification.create({
                data: { buyerId: deposit.buyerId, title: "Auction activated!", body: "Your $99 deposit was received. Your private auction is being prepared.", type: "AUCTION_STARTED" },
              });
            }

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
            const feeData = { feePaidAt: new Date(), feeAmountCents: PREMIUM_FEE_CENTS, stripeFeePIId: pi.id };
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
                  await walkCommissionTree(metaDealId, referral.affiliateId, pi.id);
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
          await prisma.deposit.updateMany({
            where: { stripePaymentIntentId: pi.id },
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

        if (deposit && deposit.status !== "REFUNDED") {
          await prisma.deposit.update({
            where: { id: deposit.id },
            data:  { status: "REFUNDED", refundedAt: new Date() },
          });
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

    // Mark as processed
    await prisma.paymentProviderEvent.update({
      where: { eventId: event.id },
      data: { processed: true, processedAt: new Date() },
    });

    return NextResponse.json({ received: true });
  } catch (err) {
    logger.error("Webhook processing error:", err);
    return new NextResponse("Processing error", { status: 500 });
  }
}
