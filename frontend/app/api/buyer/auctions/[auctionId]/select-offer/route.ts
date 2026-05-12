import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import {
  sendDealSelectedEmail,
  sendDealerOfferWonEmail,
  sendDealerOfferLostEmail,
} from "@/lib/services/email/resend.service";

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
  let buyerFirstName = "";
  let buyerLastName = "";
  try {
    const buyerWithEmail = await prisma.buyer.findUnique({
      where: { id: buyer.id },
      include: { user: { select: { email: true } } },
    });
    buyerFirstName = buyerWithEmail?.firstName ?? "";
    buyerLastName = buyerWithEmail?.lastName ?? "";
    if (buyerWithEmail?.user?.email) {
      await sendDealSelectedEmail(buyerWithEmail.user.email, buyerWithEmail.firstName, deal.id);
    }
  } catch (e) {
    console.error("[select-offer] deal selected email failed:", e);
  }

  // Notify all dealers in the auction — one "won" + N "lost" emails.
  try {
    const allOffers = await prisma.offer.findMany({
      where: { auctionId },
      include: { dealer: { include: { user: { select: { email: true } } } } },
    });
    const buyerLastInitial = buyerLastName ? buyerLastName.charAt(0).toUpperCase() : "";
    const totalOffers = allOffers.length;
    const vehicleRef = `Auction ${auctionId.slice(0, 8)}`;

    for (const off of allOffers) {
      const email = off.dealer?.user?.email;
      if (!email) continue;

      if (off.id === offer.id) {
        await sendDealerOfferWonEmail({
          to: email,
          contactName: off.dealer.dealershipName,
          vehicleRef,
          buyerFirstName,
          buyerLastInitial,
          dealUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dealer/deals/${deal.id}`,
          dealId: deal.id,
        }).catch((err) => console.error("[select-offer] won email failed:", err));
      } else {
        // Use rankCash if available, otherwise default to "2" (runner-up)
        const yourPosition = off.rankCash ?? 2;
        await sendDealerOfferLostEmail({
          to: email,
          contactName: off.dealer.dealershipName,
          vehicleRef,
          yourPosition,
          totalOffers,
          insightsUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dealer/auctions/${auctionId}/insights`,
          auctionId,
        }).catch((err) => console.error("[select-offer] lost email failed:", err));
      }
    }
  } catch (err) {
    console.error("[select-offer] dealer outcome email broadcast failed:", err);
  }

  return successResponse({ deal: { id: deal.id } });
}
