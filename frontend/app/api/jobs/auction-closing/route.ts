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
      sms: `${firstName} — your auction closes soon. Compare your dealer offers now: autolenis.com/buyer/dashboard`,
      emailSubject: "Your auction results are ready",
      emailHtml: renderEmail({
        heading: "Your auction results are ready",
        bodyHtml: `<p>Hi ${firstName},</p><p>Your auction is wrapping up. Review and compare your dealer offers now so you can pick the best one before it closes.</p>`,
        ctaText: "Compare dealer offers",
        ctaUrl: `${NOTIFY_APP_URL}/buyer/dashboard`,
      }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
