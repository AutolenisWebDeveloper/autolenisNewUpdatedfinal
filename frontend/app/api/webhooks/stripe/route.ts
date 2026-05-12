import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_CENTS } from "@/lib/constants";
import {
  sendDepositConfirmationEmail,
  sendAuctionActivatedEmail,
} from "@/lib/services/email/resend.service";
import { walkCommissionTree } from "@/lib/services/affiliate/commission.service";
import { launchAuction } from "@/lib/services/auction/auction.service";
import { inviteDealersToAuction } from "@/lib/services/auction/dealer-invitation.service";

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

  // D3: Check PaymentProviderEvent.eventId FIRST — return 200 on duplicate without processing side effects
  const existing = await prisma.paymentProviderEvent.findUnique({
    where: { eventId: event.id },
  });
  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Record event BEFORE processing (idempotency)
  await prisma.paymentProviderEvent.create({
    data: { eventId: event.id, eventType: event.type, payload: JSON.parse(JSON.stringify(event)), processed: false },
  });

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
            const createdAuction = await prisma.auction.create({
              data: {
                buyerId: deposit.buyerId,
                depositId: deposit.id,
                status: "PENDING",
              },
            });
            // Notify buyer in-app
            await prisma.notification.create({
              data: { buyerId: deposit.buyerId, title: "Auction activated!", body: "Your $99 deposit was received. Your private auction is being prepared.", type: "AUCTION_STARTED" },
            });

            // BUG1 FIX: Launch auction and invite dealers (was missing — dealers were never notified)
            if (createdAuction) {
              await launchAuction(createdAuction.id).catch((err: unknown) =>
                console.error("[stripe/webhook] launchAuction failed:", err)
              );
              await inviteDealersToAuction(createdAuction.id, deposit.buyerId).catch((err: unknown) =>
                console.error("[stripe/webhook] inviteDealersToAuction failed:", err)
              );
            }

            // Send deposit confirmation and auction activated emails
            // buyer is fetched via nullable Prisma include, so firstName may be absent
            const buyerEmail = deposit.buyer?.user?.email;
            const buyerName = deposit.buyer?.firstName?.trim() || "valued customer";
            if (buyerEmail) {
              try {
                await sendDepositConfirmationEmail(buyerEmail, buyerName, deposit.id);
              } catch (e) {
                console.error("[stripe/webhook] deposit confirmation email failed:", e);
              }
              try {
                if (createdAuction) {
                  await sendAuctionActivatedEmail(buyerEmail, buyerName, createdAuction.id);
                }
              } catch (e) {
                console.error("[stripe/webhook] auction activated email failed:", e);
              }
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

          await prisma.deal.updateMany({
            where: whereClause,
            data: {
              status: "INSURANCE_PENDING",
              feePaidAt: new Date(),
              feeAmountCents: PREMIUM_FEE_CENTS,
              stripeFeePIId: pi.id, // Always record the PI ID for future webhook dedup
            },
          });

          // Send the buyer a confirmation that their service fee was received.
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
                const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);
                await resend.emails.send({
                  from: "AutoLenis <noreply@autolenis.com>",
                  to: buyerEmail,
                  subject: "Your AutoLenis Service Fee Is Confirmed",
                  text: [
                    `Hi ${buyerName},`,
                    "",
                    "Your AutoLenis Service Fee has been received. Thank you!",
                    "",
                    "What happens next:",
                    "1. We will review your financing details (if applicable)",
                    "2. Your purchase contract will be prepared",
                    "3. You will receive a DocuSign link to e-sign your agreement",
                    "4. Once signed, we coordinate vehicle pickup",
                    "",
                    `Track your deal: ${appUrl}/buyer/deal`,
                    "",
                    "— The AutoLenis Team",
                  ].join("\n"),
                });
              }
            }
          } catch (err) {
            console.error("[stripe/webhook] service fee email failed:", err);
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
            console.error("[stripe/webhook] commission walk failed (non-fatal):", commissionErr);
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
        }).catch((err: unknown) => console.error("[stripe/webhook] dispute audit log failed:", err));
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
    console.error("Webhook processing error:", err);
    return new NextResponse("Processing error", { status: 500 });
  }
}
