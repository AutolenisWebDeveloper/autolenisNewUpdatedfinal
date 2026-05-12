import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import {
  sendDealSelectedEmail,
  sendDealerOfferWonEmail,
  sendDealerOfferLostEmail,
} from "@/lib/services/email/resend.service";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";

interface Props { params: Promise<{ auctionId: string }> }

// POST /api/buyer/auctions/[auctionId]/select-offer — select a deal
export async function POST(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { offerId } = await request.json() as { offerId: string };

  const auction = await prisma.auction.findFirst({ where: { id: auctionId, buyerId: buyer.id } });
  if (!auction) return errorResponse("NOT_FOUND", "Auction not found", 404);

  const offer = await prisma.offer.findFirst({
    where: { id: offerId, auctionId, status: "SUBMITTED" },
  });
  if (!offer) return errorResponse("NOT_FOUND", "Offer not found", 404);

  const deal = await prisma.deal.create({
    data: {
      buyerId: buyer.id,
      offerId: offer.id,
      status: "FINANCING_PENDING",
    },
  });

  await prisma.offer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
  await prisma.auction.update({ where: { id: auctionId }, data: { status: "CLOSED", closedAt: new Date() } });

  await prisma.notification.create({
    data: { buyerId: buyer.id, title: "Deal created!", body: "You selected your best deal. Continue to financing.", type: "DEAL_SELECTED" },
  });

  // Send deal selected email — non-blocking
  const buyerWithEmail = await prisma.buyer.findUnique({
    where: { id: buyer.id },
    include: { user: { select: { email: true } } },
  }).catch(() => null);
  try {
    if (buyerWithEmail?.user?.email) {
      await sendDealSelectedEmail(buyerWithEmail.user.email, buyerWithEmail.firstName, deal.id);
    }
  } catch (e) {
    console.error("[select-offer] deal selected email failed:", e);
  }

  // Notify every dealer that submitted an offer — winner vs lost — non-blocking.
  const allOffers = await prisma.offer.findMany({
    where: { auctionId },
    include: { dealer: { include: { user: { select: { email: true } } } } },
  }).catch(() => []);
  const vehicleRef = `Auction ${auctionId.slice(0, 8)}`;
  const buyerFirstName = buyerWithEmail?.firstName ?? "Buyer";
  const buyerLastInitial = (buyerWithEmail?.lastName ?? "").charAt(0) || "";
  const totalOffers = allOffers.length;
  // Position assigned by rank in submitted offers (1 = lowest OTD).
  const sortedByOtd = [...allOffers].sort((a, b) => a.otdPriceCents - b.otdPriceCents);
  for (let i = 0; i < sortedByOtd.length; i++) {
    const offerRow = sortedByOtd[i];
    const dealerEmail = offerRow.dealer?.user?.email;
    if (!dealerEmail) continue;
    const dealershipName = offerRow.dealer.dealershipName;
    if (offerRow.id === offer.id) {
      await sendDealerOfferWonEmail({
        to: dealerEmail,
        contactName: dealershipName,
        vehicleRef,
        buyerFirstName,
        buyerLastInitial,
        dealUrl: `${APP_URL}/dealer/deals/${deal.id}`,
        dealId: deal.id,
      }).catch(err => console.error("[select-offer] dealer won email failed:", err));
    } else {
      await sendDealerOfferLostEmail({
        to: dealerEmail,
        contactName: dealershipName,
        vehicleRef,
        yourPosition: i + 1,
        totalOffers,
        insightsUrl: `${APP_URL}/dealer/opportunities`,
        auctionId,
      }).catch(err => console.error("[select-offer] dealer lost email failed:", err));
    }
  }

  return successResponse({ deal: { id: deal.id } });
}
