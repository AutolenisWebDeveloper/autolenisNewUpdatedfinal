import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
import { dispatch } from "@/lib/qstash/dispatch";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";

export const dynamic = "force-dynamic";

interface Payload {
  affiliateId: string;
  firstName: string;
  email: string;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { affiliateId, firstName, email } = (await request.json()) as Payload;

    await notifyContact({
      entityType: "affiliate",
      entityId: affiliateId,
      email,
      sms: `${firstName}, your AutoLenis affiliate account is still active. Start sharing your link to earn again: autolenis.com/affiliate/portal/dashboard`,
      emailSubject: "Your AutoLenis affiliate account is still active",
      emailHtml: renderEmail({
        heading: "Your AutoLenis affiliate account is still active",
        bodyHtml: `<p>Hi ${firstName},</p><p>It's been a while! Your affiliate account is still active and ready to earn. Share your referral link with anyone car shopping and start earning commissions again.</p>`,
        ctaText: "Go to my dashboard",
        ctaUrl: `${NOTIFY_APP_URL}/affiliate/portal/dashboard`,
      }),
    });

    await dispatch({
      path: "/api/jobs/affiliate-reengagement-2",
      body: { affiliateId, firstName, email },
      delaySeconds: 1209600,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
