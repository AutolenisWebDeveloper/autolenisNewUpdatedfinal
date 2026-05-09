// lib/services/auction/auction.service.ts
// System 3 — Auction lifecycle management

import { prisma } from "@/lib/prisma";
import { AuctionStatus, Prisma } from "@prisma/client";
import { AUCTION_DURATION_HOURS } from "@/lib/constants";

export async function createAuction(buyerId: string, depositId: string) {
  return prisma.auction.create({
    data: {
      buyerId,
      depositId,
      status: AuctionStatus.PENDING,
    },
  });
}

export async function launchAuction(auctionId: string) {
  const now = new Date();
  const endsAt = new Date(now.getTime() + AUCTION_DURATION_HOURS * 3600000);
  return prisma.auction.update({
    where: { id: auctionId },
    data: { status: AuctionStatus.ACTIVE, startedAt: now, endsAt },
  });
}

export async function closeAuction(auctionId: string) {
  return prisma.auction.update({
    where: { id: auctionId },
    data: { status: AuctionStatus.CLOSED, closedAt: new Date() },
  });
}

export async function extendAuction(auctionId: string, hours: number, extendedBy: string, reason: string) {
  const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
  if (!auction || !auction.endsAt) throw new Error("Auction not found or not active");
  const newEnd = new Date(auction.endsAt.getTime() + hours * 3600000);
  return prisma.auction.update({
    where: { id: auctionId },
    data: { endsAt: newEnd, extendedAt: new Date(), extendedBy, extendReason: reason },
  });
}

// Close all expired auctions — called by auction-close cron
export async function closeExpiredAuctions(): Promise<number> {
  const now = new Date();
  const result = await prisma.auction.updateMany({
    where: { status: AuctionStatus.ACTIVE, endsAt: { lte: now } },
    data: { status: AuctionStatus.CLOSED, closedAt: now },
  });
  return result.count;
}

export async function getActiveAuctions() {
  return prisma.auction.findMany({
    where: { status: AuctionStatus.ACTIVE },
    include: { buyer: true, _count: { select: { offers: true } } },
  });
}

export async function getAuctionWithOffers(auctionId: string) {
  return prisma.auction.findUnique({
    where: { id: auctionId },
    include: {
      buyer: { include: { preQualification: true } },
      offers: { include: { dealer: true }, orderBy: { otdPriceCents: "asc" } },
      invitations: { include: { dealer: true } },
    },
  });
}

// Check if auction is holding deposit — for refund eligibility
export async function hasSubmittedOffers(auctionId: string): Promise<boolean> {
  const count = await prisma.offer.count({ where: { auctionId, status: "SUBMITTED" } });
  return count > 0;
}
