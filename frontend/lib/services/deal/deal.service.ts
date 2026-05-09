// lib/services/deal/deal.service.ts
// System 5 — Deal state machine
// Contract Shield IS a workflow gate:
// CONTRACT_PENDING → CONTRACT_REVIEW → CONTRACT_APPROVED → SIGNING_PENDING

import { prisma } from "@/lib/prisma";
import { DealStatus, Prisma } from "@prisma/client";

// Valid state transitions
const TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  PENDING: ["ACTIVE"],
  ACTIVE: ["FINANCING_PENDING"],
  FINANCING_PENDING: ["FEE_PENDING"],
  FEE_PENDING: ["FEE_PAID"],
  FEE_PAID: ["INSURANCE_PENDING"],
  INSURANCE_PENDING: ["CONTRACT_PENDING"],
  CONTRACT_PENDING: ["CONTRACT_REVIEW"],
  CONTRACT_REVIEW: ["CONTRACT_APPROVED", "CONTRACT_PENDING"], // Can re-submit
  CONTRACT_APPROVED: ["SIGNING_PENDING"],
  SIGNING_PENDING: ["SIGNED"],
  SIGNED: ["PICKUP_SCHEDULED"],
  PICKUP_SCHEDULED: ["PICKUP_COMPLETE"],
  PICKUP_COMPLETE: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransition(from: DealStatus, to: DealStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export async function advanceDealStatus(dealId: string, newStatus: DealStatus, actorId?: string): Promise<void> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) throw new Error("Deal not found");

  if (!canTransition(deal.status, newStatus)) {
    throw new Error(`Invalid transition: ${deal.status} → ${newStatus}`);
  }

  await prisma.deal.update({ where: { id: dealId }, data: { status: newStatus } });

  // Log activity
  await prisma.buyerActivityEvent.create({
    data: {
      buyerId: deal.buyerId,
      eventType: "DEAL_STAGE_CHANGED",
      title: `Deal moved to ${newStatus.replace(/_/g, " ").toLowerCase()}`,
      metadata: { from: deal.status, to: newStatus },
    },
  }).catch(() => {});
}

export async function createDealFromOffer(buyerId: string, offerId: string) {
  const deal = await prisma.deal.create({
    data: { buyerId, offerId, status: DealStatus.FINANCING_PENDING },
  });

  await prisma.offer.update({ where: { id: offerId }, data: { status: "ACCEPTED" } });

  await prisma.buyerActivityEvent.create({
    data: {
      buyerId,
      eventType: "DEAL_CREATED",
      title: "You selected your best deal",
      metadata: { offerId, dealId: deal.id },
    },
  }).catch(() => {});

  return deal;
}

export async function getDealForBuyer(buyerId: string, dealId?: string) {
  if (dealId) {
    return prisma.deal.findFirst({
      where: { id: dealId, buyerId },
      include: { offer: { include: { dealer: true } }, contractScans: { orderBy: { scannedAt: "desc" }, take: 1 }, eSignEnvelope: true, pickup: true },
    });
  }
  return prisma.deal.findFirst({
    where: { buyerId, status: { notIn: [DealStatus.COMPLETED, DealStatus.CANCELLED, DealStatus.REFUNDED] } },
    include: { offer: { include: { dealer: true } }, contractScans: { orderBy: { scannedAt: "desc" }, take: 1 }, eSignEnvelope: true, pickup: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function cancelDeal(dealId: string, reason: string): Promise<void> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) throw new Error("Deal not found");

  await prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.CANCELLED } });

  await prisma.buyerActivityEvent.create({
    data: { buyerId: deal.buyerId, eventType: "DEAL_CANCELLED", title: "Deal cancelled", metadata: { reason } },
  }).catch(() => {});
}
