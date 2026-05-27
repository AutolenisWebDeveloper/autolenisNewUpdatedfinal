import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
import { dispatch } from "@/lib/qstash/dispatch";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";

export const dynamic = "force-dynamic";

interface Payload {
  buyerId: string;
  firstName: string;
  email: string;
  offerId: string;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { buyerId, firstName, email } = (await request.json()) as Payload;

    await notifyContact({
      entityType: "buyer",
      entityId: buyerId,
      email,
      sms: `${firstName} — a dealer just submitted an offer for your vehicle! Compare now: autolenis.com/buyer/dashboard`,
      emailSubject: "A dealer submitted an offer for you",
      emailHtml: renderEmail({
        heading: "A dealer submitted an offer for you",
        bodyHtml: `<p>Hi ${firstName},</p><p>Great news — a dealer just submitted an offer for your vehicle. Review the details and see how it stacks up.</p>`,
        ctaText: "Compare the offer",
        ctaUrl: `${NOTIFY_APP_URL}/buyer/dashboard`,
      }),
    });

    await dispatch({
      path: "/api/jobs/offer-follow-up",
      body: { buyerId, firstName, email, touchNumber: 1 },
      delaySeconds: 14400,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
