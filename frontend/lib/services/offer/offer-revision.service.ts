// lib/services/offer/offer-revision.service.ts — wraps offer revision logic
import { prisma } from "@/lib/prisma";
import { reviseOffer } from "./offer.service";
import type { OfferInput } from "./offer.service";

export async function canRevise(offerId: string, dealerId: string): Promise<boolean> {
  const offer = await prisma.offer.findFirst({ where: { id: offerId, dealerId, status: "SUBMITTED" } });
  if (!offer) return false;
  const auction = await prisma.auction.findUnique({ where: { id: offer.auctionId } });
  if (!auction || auction.status !== "ACTIVE") return false;
  if ((offer.version ?? 1) >= 2) return false; // Max 1 revision
  return true;
}

export async function submitRevision(offerId: string, dealerId: string, changes: Partial<OfferInput>) {
  const canDo = await canRevise(offerId, dealerId);
  if (!canDo) throw new Error("This offer cannot be revised");
  return reviseOffer(offerId, dealerId, changes);
}
