import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
import { dispatch } from "@/lib/qstash/dispatch";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";

export const dynamic = "force-dynamic";

interface Payload {
  buyerId: string;
  firstName: string;
  email: string;
  auctionId: string;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { buyerId, firstName, email, auctionId } = (await request.json()) as Payload;

    await notifyContact({
      entityType: "buyer",
      entityId: buyerId,
      email,
      sms: `Your auction is LIVE ${firstName}! Dealers are competing for your vehicle. Check offers: autolenis.com/buyer/dashboard`,
      emailSubject: "Your dealer auction is live",
      emailHtml: renderEmail({
        heading: "Your dealer auction is live",
        bodyHtml: `<p>Hi ${firstName},</p><p>Your private auction is now live and dealers are competing for your vehicle. Offers will appear on your dashboard as they come in.</p>`,
        ctaText: "View live offers",
        ctaUrl: `${NOTIFY_APP_URL}/buyer/dashboard`,
      }),
    });

    await dispatch({
      path: "/api/jobs/auction-midpoint",
      body: { buyerId, firstName, email, auctionId },
      delaySeconds: 43200,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
