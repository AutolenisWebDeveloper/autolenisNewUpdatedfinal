import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
import { dispatch } from "@/lib/qstash/dispatch";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";
import { hasSelectedOffer } from "@/lib/qstash/state";

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
    const { buyerId, firstName, email } = (await request.json()) as Payload;

    if (await hasSelectedOffer(buyerId)) {
      return NextResponse.json({ success: true, stopped: "offer_selected" });
    }

    await notifyContact({
      entityType: "buyer",
      entityId: buyerId,
      email,
      sms: `${firstName}, your AutoLenis auction is halfway done and dealers are still bidding. See the latest offers: autolenis.com/buyer/dashboard`,
      emailSubject: "Your auction is halfway done",
      emailHtml: renderEmail({
        heading: "Your auction is halfway done",
        bodyHtml: `<p>Hi ${firstName},</p><p>Your auction is at its midpoint and dealers are still competing. Check in to see how the offers are shaping up.</p>`,
        ctaText: "See current offers",
        ctaUrl: `${NOTIFY_APP_URL}/buyer/dashboard`,
      }),
    });

    await dispatch({
      path: "/api/jobs/auction-closing",
      body: { buyerId, firstName, email },
      delaySeconds: 43200,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
