// holds — release deposits for expired auctions with no offers
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX, DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { refundDeposit } from "@/lib/services/deposit/deposit.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Find closed auctions with no offers and paid deposit not yet refunded
  const auctionsNoOffers = await prisma.auction.findMany({
    where: { status: "CLOSED" },
    include: { deposit: true, _count: { select: { offers: { where: { status: "SUBMITTED" } } } } },
  });

  let released = 0;
  for (const auction of auctionsNoOffers) {
    if (auction._count.offers === 0 && auction.deposit?.status === "PAID") {
      await refundDeposit(auction.deposit.id, "No offers received").catch(err => logger.error("Refund error:", err));
      released++;
    }
  }

  return NextResponse.json({ success: true, data: { released, timestamp: new Date().toISOString() } });
}
