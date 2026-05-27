import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
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
      // The "Reply STOP to opt out." suffix is appended by the notify layer.
      sms: `${firstName}, we've added fresh marketing assets to your AutoLenis affiliate toolkit. Put them to work and start earning again: autolenis.com/affiliate/portal/dashboard`,
      emailSubject: "New marketing assets available for AutoLenis affiliates",
      emailHtml: renderEmail({
        heading: "New marketing assets are ready for you",
        bodyHtml: `<p>Hi ${firstName},</p><p>We've just published a fresh set of banners, social posts, and link templates to your affiliate toolkit — built to convert. They make it easier than ever to share AutoLenis and earn commissions.</p><p>Log in to grab the new assets and your referral link.</p>`,
        ctaText: "View my toolkit",
        ctaUrl: `${NOTIFY_APP_URL}/affiliate/portal/dashboard`,
      }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Job failed:", err);
    // Return 500 so QStash retries.
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
