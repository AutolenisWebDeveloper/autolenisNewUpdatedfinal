// lib/services/pickup/pickup-notifications.service.ts
// D2a — the pickup round-trip notification rail. Every transactional email goes
// through the durable Inngest spine (enqueueTransactionalEmail → autolenis/email.send),
// NOT the legacy direct-Resend path. In-app Notification rows are written for the
// party whose turn it now is.
//
// Dealer isolation: dealer-facing messages expose the vehicle reference + buyer
// city/state ONLY — never buyer name, email, phone, or address.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { enqueueTransactionalEmail } from "../email/transactional-dispatch";
import {
  renderDealerPickupProposedEmail,
  DEALER_PICKUP_PROPOSED_SUBJECT,
} from "../email/templates/dealer-pickup-proposed";
import {
  renderBuyerPickupCounteredEmail,
  BUYER_PICKUP_COUNTERED_SUBJECT,
} from "../email/templates/buyer-pickup-countered";
import {
  renderDealerPickupScheduledEmail,
  DEALER_PICKUP_SCHEDULED_SUBJECT,
} from "../email/templates/dealer-pickup-scheduled";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

function vehicleRefFor(dealId: string): string {
  return `Deal ${dealId.slice(0, 8)}`;
}

function formatWindow(when: Date | null): string {
  if (!when) return "a proposed time";
  return when.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type Parties = {
  buyerId: string | null;
  buyerFirstName: string;
  buyerCity: string;
  buyerState: string;
  buyerEmail: string | null;
  dealerId: string | null;
  dealerName: string;
  dealerEmail: string | null;
  proposedTime: Date | null;
  proposedAt: Date | null;
};

async function loadParties(dealId: string): Promise<Parties | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      buyerId: true,
      buyer: { select: { firstName: true, city: true, state: true, user: { select: { email: true } } } },
      offer: { select: { dealerId: true, dealer: { select: { dealershipName: true, user: { select: { email: true } } } } } },
      pickup: { select: { proposedTime: true, proposedAt: true } },
    },
  });
  if (!deal) return null;
  return {
    buyerId: deal.buyerId,
    buyerFirstName: deal.buyer?.firstName ?? "there",
    buyerCity: deal.buyer?.city ?? "",
    buyerState: deal.buyer?.state ?? "",
    buyerEmail: deal.buyer?.user?.email ?? null,
    dealerId: deal.offer?.dealerId ?? null,
    dealerName: deal.offer?.dealer?.dealershipName ?? "there",
    dealerEmail: deal.offer?.dealer?.user?.email ?? null,
    proposedTime: deal.pickup?.proposedTime ?? null,
    proposedAt: deal.pickup?.proposedAt ?? null,
  };
}

const roundKey = (p: Parties) => p.proposedAt?.toISOString() ?? "0";

/** Buyer proposed (or re-proposed) a time → tell the dealer to confirm/counter. */
export async function notifyDealerProposed(dealId: string): Promise<void> {
  const p = await loadParties(dealId);
  if (!p) return;

  if (p.dealerId) {
    await prisma.notification
      .create({
        data: {
          dealerId: p.dealerId,
          type: "PICKUP_PROPOSED",
          title: "Confirm a pickup time",
          body: "A buyer proposed a pickup time. Confirm it or propose an alternative.",
          actionUrl: "/dealer/pickups",
        },
      })
      .catch((e: unknown) => logger.error("[pickup-notif] dealer in-app (proposed):", e));
  }

  if (p.dealerEmail) {
    const vehicleRef = vehicleRefFor(dealId);
    await enqueueTransactionalEmail({
      to: p.dealerEmail,
      templateId: "dealer-pickup-proposed",
      subject: DEALER_PICKUP_PROPOSED_SUBJECT(vehicleRef),
      html: renderDealerPickupProposedEmail({
        contactName: p.dealerName,
        vehicleRef,
        buyerCity: p.buyerCity,
        buyerState: p.buyerState,
        proposedWindow: formatWindow(p.proposedTime),
        dealUrl: `${APP_URL}/dealer/pickups`,
      }),
      idempotencyKey: `pickup-proposed-${dealId}-${roundKey(p)}`,
    }).catch((e: unknown) => logger.error("[pickup-notif] dealer email (proposed):", e));
  }
}

/** Dealer countered → tell the buyer to accept/counter. */
export async function notifyBuyerCountered(dealId: string): Promise<void> {
  const p = await loadParties(dealId);
  if (!p) return;

  if (p.buyerId) {
    await prisma.notification
      .create({
        data: {
          buyerId: p.buyerId,
          type: "PICKUP_COUNTERED",
          title: "New pickup time proposed",
          body: "The dealership proposed a different pickup time. Accept it or suggest another.",
          actionUrl: "/buyer/pickup",
        },
      })
      .catch((e: unknown) => logger.error("[pickup-notif] buyer in-app (countered):", e));
  }

  if (p.buyerEmail) {
    await enqueueTransactionalEmail({
      to: p.buyerEmail,
      templateId: "buyer-pickup-countered",
      subject: BUYER_PICKUP_COUNTERED_SUBJECT,
      html: renderBuyerPickupCounteredEmail({
        firstName: p.buyerFirstName,
        proposedWindow: formatWindow(p.proposedTime),
        pickupUrl: `${APP_URL}/buyer/pickup`,
      }),
      idempotencyKey: `pickup-countered-${dealId}-${roundKey(p)}`,
    }).catch((e: unknown) => logger.error("[pickup-notif] buyer email (countered):", e));
  }
}

/** Buyer accepted the dealer's counter → tell the dealer it's confirmed. */
export async function notifyDealerConfirmed(dealId: string): Promise<void> {
  const p = await loadParties(dealId);
  if (!p) return;

  if (p.dealerId) {
    await prisma.notification
      .create({
        data: {
          dealerId: p.dealerId,
          type: "PICKUP_SCHEDULED",
          title: "Pickup confirmed",
          body: "The buyer accepted your proposed pickup time. Please prepare the vehicle.",
          actionUrl: "/dealer/pickups",
        },
      })
      .catch((e: unknown) => logger.error("[pickup-notif] dealer in-app (confirmed):", e));
  }

  if (p.dealerEmail) {
    const vehicleRef = vehicleRefFor(dealId);
    await enqueueTransactionalEmail({
      to: p.dealerEmail,
      templateId: "dealer-pickup-scheduled",
      subject: DEALER_PICKUP_SCHEDULED_SUBJECT(vehicleRef),
      html: renderDealerPickupScheduledEmail({
        contactName: p.dealerName,
        vehicleRef,
        buyerCity: p.buyerCity,
        buyerState: p.buyerState,
        pickupWindow: formatWindow(p.proposedTime),
        dealUrl: `${APP_URL}/dealer/deals/${dealId}`,
      }),
      idempotencyKey: `dealer-pickup-scheduled-${dealId}`,
    }).catch((e: unknown) => logger.error("[pickup-notif] dealer email (confirmed):", e));
  }
}

/** SLA nudge: the dealer still hasn't confirmed the buyer's proposal. */
export async function notifyDealerProposalReminder(dealId: string): Promise<void> {
  const p = await loadParties(dealId);
  if (!p) return;

  if (p.dealerId) {
    await prisma.notification
      .create({
        data: {
          dealerId: p.dealerId,
          type: "PICKUP_PROPOSED",
          title: "Reminder: confirm a pickup time",
          body: "A buyer is still waiting for you to confirm or counter a proposed pickup time.",
          actionUrl: "/dealer/pickups",
        },
      })
      .catch((e: unknown) => logger.error("[pickup-notif] dealer in-app (reminder):", e));
  }

  if (p.dealerEmail) {
    const vehicleRef = vehicleRefFor(dealId);
    await enqueueTransactionalEmail({
      to: p.dealerEmail,
      templateId: "dealer-pickup-proposed",
      subject: `Reminder — ${DEALER_PICKUP_PROPOSED_SUBJECT(vehicleRef)}`,
      html: renderDealerPickupProposedEmail({
        contactName: p.dealerName,
        vehicleRef,
        buyerCity: p.buyerCity,
        buyerState: p.buyerState,
        proposedWindow: formatWindow(p.proposedTime),
        dealUrl: `${APP_URL}/dealer/pickups`,
      }),
      // Distinct key from the initial send so the reminder is NOT deduped against it.
      idempotencyKey: `pickup-proposed-reminder-${dealId}-${roundKey(p)}`,
    }).catch((e: unknown) => logger.error("[pickup-notif] dealer email (reminder):", e));
  }
}

/** SLA nudge: the buyer still hasn't accepted/countered the dealer's counter. */
export async function notifyBuyerCounterReminder(dealId: string): Promise<void> {
  const p = await loadParties(dealId);
  if (!p) return;

  if (p.buyerId) {
    await prisma.notification
      .create({
        data: {
          buyerId: p.buyerId,
          type: "PICKUP_COUNTERED",
          title: "Reminder: a pickup time is waiting for you",
          body: "The dealership proposed a pickup time. Accept it or suggest another.",
          actionUrl: "/buyer/pickup",
        },
      })
      .catch((e: unknown) => logger.error("[pickup-notif] buyer in-app (reminder):", e));
  }

  if (p.buyerEmail) {
    await enqueueTransactionalEmail({
      to: p.buyerEmail,
      templateId: "buyer-pickup-countered",
      subject: `Reminder — ${BUYER_PICKUP_COUNTERED_SUBJECT}`,
      html: renderBuyerPickupCounteredEmail({
        firstName: p.buyerFirstName,
        proposedWindow: formatWindow(p.proposedTime),
        pickupUrl: `${APP_URL}/buyer/pickup`,
      }),
      idempotencyKey: `pickup-countered-reminder-${dealId}-${roundKey(p)}`,
    }).catch((e: unknown) => logger.error("[pickup-notif] buyer email (reminder):", e));
  }
}

/** Counter cap reached → raise a SYSTEM_ALERT for admin follow-up. */
export async function notifyPickupEscalated(dealId: string): Promise<void> {
  await prisma.notification
    .create({
      data: {
        type: "SYSTEM_ALERT",
        title: "Pickup coordination escalation",
        body: `Pickup for deal ${dealId.slice(0, 8)} reached the counter-proposal cap and needs an admin to finalize the time.`,
        actionUrl: `/admin/deals/${dealId}`,
      },
    })
    .catch((e: unknown) => logger.error("[pickup-notif] escalation alert:", e));
  logger.warn(`[pickup-coord] deal=${dealId} escalated to admin — counter cap reached`);
}
