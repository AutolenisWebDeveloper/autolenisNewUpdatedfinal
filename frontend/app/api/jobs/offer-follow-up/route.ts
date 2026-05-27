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
  touchNumber: number;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { buyerId, firstName, email, touchNumber } = (await request.json()) as Payload;

    if (await hasSelectedOffer(buyerId)) {
      return NextResponse.json({ success: true, stopped: "offer_selected" });
    }

    const dashboardUrl = `${NOTIFY_APP_URL}/buyer/dashboard`;

    if (touchNumber === 1) {
      await notifyContact({
        entityType: "buyer",
        entityId: buyerId,
        email,
        sms: `${firstName}, your dealer offer is waiting. Review it before it expires: autolenis.com/buyer/dashboard`,
        emailSubject: "Your dealer offer is waiting",
        emailHtml: renderEmail({
          heading: "Your dealer offer is waiting",
          bodyHtml: `<p>Hi ${firstName},</p><p>You have a dealer offer waiting for review. Take a look so you don't miss out.</p>`,
          ctaText: "Review your offer",
          ctaUrl: dashboardUrl,
        }),
      });
      await dispatch({
        path: "/api/jobs/offer-follow-up",
        body: { buyerId, firstName, email, touchNumber: 2 },
        delaySeconds: 72000,
      });
    } else {
      await notifyContact({
        entityType: "buyer",
        entityId: buyerId,
        email,
        sms: `${firstName}, last chance to review your dealer offer before it expires: autolenis.com/buyer/dashboard`,
        emailSubject: "Last chance to review your offer",
        emailHtml: renderEmail({
          heading: "Last chance to review your offer",
          bodyHtml: `<p>Hi ${firstName},</p><p>This is your final reminder — your dealer offer is about to expire. Review it now to lock in your decision.</p>`,
          ctaText: "Review before it expires",
          ctaUrl: dashboardUrl,
        }),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
