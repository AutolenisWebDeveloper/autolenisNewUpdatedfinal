// lib/services/notifications/notification.service.ts — F13 + all 15 buyer triggers

import { prisma } from "@/lib/prisma";
import { NotificationType } from "@prisma/client";
import * as emailService from "@/lib/services/email/resend.service";
import { DEPOSIT_AMOUNT_USD } from "@/lib/constants";

// 15 buyer notification trigger points
export const BuyerTriggers = {
  async auctionStarted(buyerId: string, auctionId: string) {
    await prisma.notification.create({ data: { buyerId, type: NotificationType.AUCTION_STARTED, title: "Your auction is live", body: "Dealers are receiving your auction invitation. Offers will appear within your 48-hour window.", actionUrl: `/buyer/auction/${auctionId}` } });
  },
  async offerReceived(buyerId: string, auctionId: string, count: number) {
    await prisma.notification.create({ data: { buyerId, type: NotificationType.OFFER_RECEIVED, title: `${count} offer${count !== 1 ? "s" : ""} received`, body: "Dealers have submitted offers. You will see all ranked offers when the auction closes.", actionUrl: `/buyer/auction/${auctionId}` } });
  },
  async auctionClosingSoon(buyerId: string, auctionId: string, hoursLeft: number) {
    await prisma.notification.create({ data: { buyerId, type: NotificationType.AUCTION_CLOSING_SOON, title: `Auction closes in ${hoursLeft} hours`, body: "Your auction window is closing. Prepare to review your offers.", actionUrl: `/buyer/auction/${auctionId}` } });
  },
  async dealSelected(buyerId: string, dealId: string) {
    await prisma.notification.create({ data: { buyerId, type: NotificationType.DEAL_SELECTED, title: "Deal created — next step: financing", body: "Your deal is confirmed. Choose your financing path to continue.", actionUrl: `/buyer/deal` } });
  },
  async dealStageChanged(buyerId: string, dealId: string, stage: string) {
    await prisma.notification.create({ data: { buyerId, type: NotificationType.DEAL_STAGE_CHANGED, title: `Deal update: ${stage.replace(/_/g, " ").toLowerCase()}`, body: "Your deal has moved to the next stage.", actionUrl: `/buyer/deal` } });
  },
  async contractReady(buyerId: string, dealId: string) {
    await prisma.notification.create({ data: { buyerId, type: NotificationType.CONTRACT_READY, title: "Contract Shield review ready", body: "Your contract has been reviewed. Check your Contract Shield report.", actionUrl: `/buyer/contract-shield` } });
  },
  async signingReady(buyerId: string) {
    await prisma.notification.create({ data: { buyerId, type: NotificationType.SIGNING_READY, title: "Documents ready to sign", body: "Your signing package is ready. Complete e-signing from your dashboard.", actionUrl: `/buyer/esign` } });
  },
  async pickupScheduled(buyerId: string, date: string) {
    await prisma.notification.create({ data: { buyerId, type: NotificationType.PICKUP_SCHEDULED, title: "Pickup scheduled", body: `Your vehicle pickup is scheduled for ${date}. Your QR code is ready.`, actionUrl: `/buyer/pickup` } });
  },
  async depositConfirmed(buyerId: string) {
    await prisma.notification.create({ data: { buyerId, type: NotificationType.DEPOSIT_CONFIRMED, title: `${DEPOSIT_AMOUNT_USD} deposit confirmed`, body: "Your auction is being prepared. Dealers will be invited shortly.", actionUrl: `/buyer/auctions` } });
  },
  async prequalApproved(buyerId: string, maxOtd: number) {
    await prisma.notification.create({ data: { buyerId, type: NotificationType.PREQUAL_APPROVED, title: "Pre-qualification approved", body: `Your approved budget is $${(maxOtd / 100).toLocaleString()}. Start browsing vehicles.`, actionUrl: `/buyer/prequal` } });
  },
  async prequalDeclined(buyerId: string) {
    await prisma.notification.create({ data: { buyerId, type: NotificationType.PREQUAL_DECLINED, title: "Application update", body: "We were unable to pre-qualify you at this time. You have the right to dispute this decision.", actionUrl: `/buyer/prequal/declined` } });
  },
  async insuranceBound(buyerId: string) {
    await prisma.notification.create({ data: { buyerId, type: NotificationType.INSURANCE_BOUND, title: "Insurance confirmed", body: "Your insurance is verified. Continue with your deal.", actionUrl: `/buyer/deal` } });
  },
};

// 9 dealer notification trigger points
export const DealerTriggers = {
  async auctionInvitation(dealerId: string, auctionId: string) {
    await prisma.notification.create({ data: { dealerId, type: NotificationType.AUCTION_STARTED, title: "New auction invitation", body: "A qualified buyer is waiting for offers. Submit within 48 hours.", actionUrl: `/dealer/auctions/${auctionId}` } });
  },
  async offerAccepted(dealerId: string, dealId: string) {
    await prisma.notification.create({ data: { dealerId, type: NotificationType.DEAL_SELECTED, title: "Your offer was selected", body: "A buyer selected your offer. Proceed with contract submission.", actionUrl: `/dealer/auctions` } });
  },
};

export async function markAllRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { buyerId: userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { buyerId: userId, readAt: null } });
}
