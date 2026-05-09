// lib/services/auction/auction-extension.service.ts
import { prisma } from "@/lib/prisma";
import { extendAuction } from "./auction.service";

export async function requestExtension(auctionId: string, hours: number, adminId: string, reason: string) {
  const auction = await extendAuction(auctionId, hours, adminId, reason);
  await prisma.auctionExtensionLog.create({
    data: { auctionId, extendedBy: adminId, hoursAdded: hours, originalEnd: new Date(auction.endsAt!.getTime() - hours * 3600000), newEnd: auction.endsAt!, reason },
  });
  return auction;
}

export async function getExtensionHistory(auctionId: string) {
  return prisma.auctionExtensionLog.findMany({ where: { auctionId }, orderBy: { createdAt: "asc" } });
}
