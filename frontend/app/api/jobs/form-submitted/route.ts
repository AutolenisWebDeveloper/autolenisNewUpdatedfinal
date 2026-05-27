import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
import { dispatch } from "@/lib/qstash/dispatch";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";

export const dynamic = "force-dynamic";

interface Payload {
  buyerId: string;
  firstName: string;
  email: string;
  phone?: string | null;
  campaign?: string;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { buyerId, firstName, email, phone } = (await request.json()) as Payload;

    await notifyContact({
      entityType: "buyer",
      entityId: buyerId,
      phone,
      email,
      sms: `Hey ${firstName}! Thanks for reaching out to AutoLenis. Your vehicle request was received. Complete your activation here: autolenis.com`,
      emailSubject: "Welcome to AutoLenis — your request is in",
      emailHtml: renderEmail({
        heading: `Welcome to AutoLenis, ${firstName}`,
        bodyHtml: `<p>Thanks for reaching out — your vehicle request is in.</p><p>The next step is to activate your private dealer auction so local dealers can start competing for your business.</p>`,
        ctaText: "Complete your activation",
        ctaUrl: `${NOTIFY_APP_URL}/buyer/dashboard`,
      }),
    });

    // Begin the abandonment-recovery sequence one hour out; the completion
    // check stops it the moment the buyer activates.
    await dispatch({
      path: "/api/jobs/check-form-completion",
      body: { buyerId, touchNumber: 1 },
      delaySeconds: 3600,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
