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
  phone?: string | null;
  campaign?: string;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { buyerId, firstName, email, phone } = (await request.json()) as Payload;

    // `submitted=1` is what lets /thank-you say "Request Received!" — the page no
    // longer asserts it from a bare query string. This job only runs for a buyer
    // whose request WAS created (it is triggered by the persistence itself), so
    // the flag is true here; without it the recipient would open a link saying
    // "your vehicle request was received" onto a page saying it was not confirmed.
    const completeUrl = `${NOTIFY_APP_URL}/thank-you?submitted=1&email=${encodeURIComponent(email)}&complete=true`;

    await notifyContact({
      entityType: "buyer",
      entityId: buyerId,
      phone,
      email,
      sms: `Hey ${firstName}! Thanks for reaching out to AutoLenis. Your vehicle request was received. Complete your vehicle details so dealers can compete: ${completeUrl}`,
      emailSubject: "Welcome to AutoLenis — your request is in",
      emailHtml: renderEmail({
        heading: `Welcome to AutoLenis, ${firstName}`,
        bodyHtml: `<p>Thanks for reaching out — your vehicle request is in.</p><p>Complete your vehicle details here to help dealers submit their best offers:</p><p><a href="${completeUrl}" style="color:#0B5FD1;font-weight:600">${completeUrl}</a></p><p>The next step after that is to activate your private dealer auction so local dealers can start competing for your business.</p>`,
        ctaText: "Complete your vehicle details",
        ctaUrl: completeUrl,
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
    logger.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
