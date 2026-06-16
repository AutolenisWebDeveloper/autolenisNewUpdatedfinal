import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
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
      // The "Reply STOP to opt out." suffix is appended by the notify layer.
      sms: `Hi ${firstName} — did you know you can earn commissions by referring friends to AutoLenis? Get your referral link: autolenis.com/buyer/referral`,
      emailSubject: "Earn money by referring friends",
      emailHtml: renderEmail({
        heading: "Earn money by referring friends",
        bodyHtml: `<p>Hi ${firstName},</p><p>Loved letting dealers compete for your business? You can earn commissions every time a friend you refer completes a deal on AutoLenis.</p><p>Grab your personal referral link and start sharing.</p>`,
        ctaText: "Get my referral link",
        ctaUrl: `${NOTIFY_APP_URL}/buyer/referral`,
      }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Job failed:", err);
    // Return 500 so QStash retries.
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
