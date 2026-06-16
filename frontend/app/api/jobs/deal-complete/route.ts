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
  dealId: string;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { buyerId, firstName, email } = (await request.json()) as Payload;

    const referralUrl = `${NOTIFY_APP_URL}/auth/signup?ref=`;

    await notifyContact({
      entityType: "buyer",
      entityId: buyerId,
      email,
      sms: `Congratulations ${firstName}! Your AutoLenis deal is complete. Know someone car shopping? Share AutoLenis: autolenis.com`,
      emailSubject: "Congratulations — your deal is complete",
      emailHtml: renderEmail({
        heading: "Congratulations — your deal is complete!",
        bodyHtml: `<p>Hi ${firstName},</p><p>Your AutoLenis deal is complete — enjoy your new vehicle!</p><p>Know someone else who's car shopping? Share your referral link and help them let dealers compete too.</p>`,
        ctaText: "Share your referral link",
        ctaUrl: referralUrl,
      }),
    });

    await dispatch({
      path: "/api/jobs/review-request",
      body: { buyerId, firstName, email },
      delaySeconds: 259200,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
