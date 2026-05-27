import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
import { dispatch } from "@/lib/qstash/dispatch";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";

export const dynamic = "force-dynamic";

interface Payload {
  dealerId: string;
  firstName: string;
  email: string;
  auctionId: string;
  expiresAt?: string | null;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { dealerId, firstName, email, auctionId } = (await request.json()) as Payload;

    await notifyContact({
      entityType: "dealer",
      entityId: dealerId,
      email,
      sms: `New auction invitation ${firstName}! A buyer needs a vehicle matching your inventory. Submit your offer: autolenis.com/dealer/auctions`,
      emailSubject: "New buyer auction invitation",
      emailHtml: renderEmail({
        heading: "New buyer auction invitation",
        bodyHtml: `<p>Hi ${firstName},</p><p>A buyer needs a vehicle matching your inventory and you've been invited to compete. Submit your best offer before the auction closes.</p>`,
        ctaText: "Submit your offer",
        ctaUrl: `${NOTIFY_APP_URL}/dealer/auctions`,
      }),
    });

    await dispatch({
      path: "/api/jobs/dealer-bid-reminder",
      body: { dealerId, firstName, email, auctionId, touchNumber: 1 },
      delaySeconds: 86400,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
