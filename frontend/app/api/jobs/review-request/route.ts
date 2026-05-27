import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
import { dispatch } from "@/lib/qstash/dispatch";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";

export const dynamic = "force-dynamic";

interface Payload {
  buyerId: string;
  firstName: string;
  email: string;
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
      sms: `${firstName}, how was your AutoLenis experience? We'd love your feedback: autolenis.com/feedback`,
      emailSubject: "How was your AutoLenis experience?",
      emailHtml: renderEmail({
        heading: "How was your AutoLenis experience?",
        bodyHtml: `<p>Hi ${firstName},</p><p>Now that your deal is done, we'd love to hear how it went. Your feedback helps us make dealers compete even harder for the next buyer.</p>`,
        ctaText: "Leave a review",
        ctaUrl: `${NOTIFY_APP_URL}/feedback`,
      }),
    });

    // Day 60 — refinance outreach via OpenRoad Lending (lead provider only).
    // leadId falls back to buyerId; the Buyer model has no separate lead id.
    dispatch({
      path: "/api/jobs/refinance-outreach",
      body: {
        buyerId,
        firstName,
        email,
        leadId: buyerId,
      },
      delaySeconds: 5184000,
    }).catch(() => {});

    await dispatch({
      path: "/api/jobs/referral-nudge",
      body: { buyerId, firstName, email },
      delaySeconds: 2332800,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
