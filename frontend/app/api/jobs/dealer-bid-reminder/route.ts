import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
import { dispatch } from "@/lib/qstash/dispatch";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";
import { hasDealerBid } from "@/lib/qstash/state";

export const dynamic = "force-dynamic";

interface Payload {
  dealerId: string;
  firstName: string;
  email: string;
  auctionId: string;
  touchNumber: number;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { dealerId, firstName, email, auctionId, touchNumber } =
      (await request.json()) as Payload;

    if (await hasDealerBid(auctionId, dealerId)) {
      return NextResponse.json({ success: true, stopped: "bid_submitted" });
    }

    const auctionsUrl = `${NOTIFY_APP_URL}/dealer/auctions`;

    if (touchNumber === 1) {
      await notifyContact({
        entityType: "dealer",
        entityId: dealerId,
        email,
        sms: `${firstName}, 24 hours left to bid on this AutoLenis auction. Submit your offer: autolenis.com/dealer/auctions`,
        emailSubject: "Auction deadline reminder — 24 hours left",
        emailHtml: renderEmail({
          heading: "Auction deadline reminder — 24 hours left",
          bodyHtml: `<p>Hi ${firstName},</p><p>There are 24 hours left to submit your offer on this buyer auction. Don't miss the chance to win the deal.</p>`,
          ctaText: "Submit your offer",
          ctaUrl: auctionsUrl,
        }),
      });
      await dispatch({
        path: "/api/jobs/dealer-bid-reminder",
        body: { dealerId, firstName, email, auctionId, touchNumber: 2 },
        delaySeconds: 64800,
      });
    } else {
      await notifyContact({
        entityType: "dealer",
        entityId: dealerId,
        email,
        sms: `Final reminder ${firstName} — auction closes in 6 hours. Last chance: autolenis.com/dealer/auctions`,
        emailSubject: "Final reminder — auction closes in 6 hours",
        emailHtml: renderEmail({
          heading: "Final reminder — auction closes in 6 hours",
          bodyHtml: `<p>Hi ${firstName},</p><p>This auction closes in just 6 hours. Submit your offer now — this is your last chance to compete for the deal.</p>`,
          ctaText: "Submit before it closes",
          ctaUrl: auctionsUrl,
        }),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
